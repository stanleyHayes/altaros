package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/ratelimit"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

// buildAuth mounts the auth routes (WP-10).
//
// Paths match what the existing TypeScript frontends already call, so the
// dashboard, web and admin apps can be pointed at the Go gateway without
// changing their service layers.
func buildAuth(d *deps.Deps) http.Handler { return standalone(authRoutes(d)) }

// authRoutes registers the auth endpoints onto a router.
func authRoutes(d *deps.Deps) routeSet {
	svc := auth.NewService(d.Mongo, d.Tokens, d.Redis, smsSenderFor(d))
	notifications := newNotificationService(d)

	limiter := ratelimit.New(d.Redis)

	return func(r chi.Router) {
		// Nothing on this router was throttled at all, which left unlimited
		// credential stuffing against a platform holding giving records — and
		// bcrypt made that worse rather than better, since each attempt costs
		// ~100ms of CPU by design and a few hundred concurrent ones saturate
		// the pod before any of them succeeds.
		r.With(throttle(d, ratelimit.Register)).
			Post("/auth/register", handleRegister(svc))

		r.With(throttle(d, ratelimit.Login)).
			Post("/auth/login", handleLogin(svc, limiter, d))

		// request-otp costs real money per call. The domain throttles one phone
		// number to a code a minute (WP-10), which cannot see one caller
		// cycling through many numbers — that is what this catches.
		r.With(throttle(d, ratelimit.RequestOTP)).
			Post("/auth/request-otp", handleRequestOTP(svc))

		r.With(throttle(d, ratelimit.VerifyOTP)).
			Post("/auth/verify-otp", handleVerifyOTP(svc))

		r.With(throttle(d, ratelimit.Login)).
			Post("/auth/refresh-token", handleRefresh(svc))

		// Signing out is not worth throttling: it is authenticated, idempotent,
		// and a limit here would strand someone trying to end a session they
		// have reason to think is compromised.
		r.Post("/auth/logout", handleLogout(d, svc, notifications))
		r.Post("/auth/logout-all", handleLogoutEverywhere(d, svc, notifications))
		r.Get("/auth/me", handleMe(svc))
	}
}

func handleRegister(svc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ChurchID string `json:"churchId"`
			Email    string `json:"email"`
			Phone    string `json:"phone"`
			Name     string `json:"name"`
			Password string `json:"password"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		user, err := svc.Register(r.Context(), auth.RegisterRequest{
			ChurchID: req.ChurchID, Email: req.Email, Phone: req.Phone,
			Name: req.Name, Password: req.Password,
		})
		if err != nil {
			writeAuthError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, map[string]any{
			"user":    user,
			"message": "Account created. Verify your phone to continue.",
		})
	}
}

type loginRequest struct {
	// Workspace is the church slug — which church this sign-in is for (WP-35).
	//
	// Optional on the wire during the migration window, and the API accepts the
	// three names clients have grown: `workspace` is canonical, `churchSlug`
	// and `slug` are tolerated so the mobile app and the legacy web client keep
	// working through the rollout rather than all being cut over on one day.
	Workspace  string `json:"workspace"`
	ChurchSlug string `json:"churchSlug"`
	Slug       string `json:"slug"`

	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Password string `json:"password"`
	Method   string `json:"method"`
}

// workspace returns whichever spelling the client used.
func (r loginRequest) workspace() string {
	for _, candidate := range []string{r.Workspace, r.ChurchSlug, r.Slug} {
		if strings.TrimSpace(candidate) != "" {
			return candidate
		}
	}
	return ""
}

// handleLogin authenticates, subject to a second limit keyed on the account.
//
// Per-IP alone is trivially evaded: a distributed attack on one account arrives
// from a thousand addresses and never trips it. Per-account alone misses one
// host spraying many accounts. Both are needed, and the account limit can only
// live here because the account is not known until the body is read.
func handleLogin(svc *auth.Service, limiter *ratelimit.Limiter, d *deps.Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		if account := strings.ToLower(strings.TrimSpace(req.Email)); account != "" {
			decision, err := limiter.Allow(r.Context(), ratelimit.LoginPerAccount, account)
			if err != nil {
				d.Log.Warn("per-account rate limiting unavailable",
					slog.String("error", err.Error()))
			} else if !decision.Allowed {
				// Deliberately the same status and wording as the per-IP
				// refusal. Only a real account accumulates failed attempts, so
				// a distinct message here would turn the limiter into an
				// account oracle — the thing writeAuthError exists to avoid.
				httpx.Error(w, http.StatusTooManyRequests,
					"Too many attempts. Try again in 15 minutes.")
				return
			}
		}

		// PHONE means "send me a code" — it is not a password login.
		if strings.EqualFold(req.Method, "PHONE") {
			if err := svc.RequestOTP(r.Context(), req.workspace(), req.Phone); err != nil {
				writeAuthError(w, err)
				return
			}
			httpx.JSON(w, http.StatusOK, map[string]any{
				"message": "If that number belongs to a member, a code has been sent.",
			})
			return
		}

		result, err := svc.LoginWithPassword(r.Context(), req.workspace(), req.Email, req.Password)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, result)
	}
}

func handleRequestOTP(svc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Workspace  string `json:"workspace"`
			ChurchSlug string `json:"churchSlug"`
			Slug       string `json:"slug"`
			Phone      string `json:"phone"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		workspace := firstNonEmpty(req.Workspace, req.ChurchSlug, req.Slug)
		if err := svc.RequestOTP(r.Context(), workspace, req.Phone); err != nil {
			writeAuthError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"message": "If that number belongs to a member, a code has been sent.",
		})
	}
}

func handleVerifyOTP(svc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Workspace  string `json:"workspace"`
			ChurchSlug string `json:"churchSlug"`
			Slug       string `json:"slug"`
			Phone      string `json:"phone"`
			// `otp` is the canonical field: it is what shared-types'
			// OtpVerifyRequest declares and what the legacy API validates.
			OTP string `json:"otp"`
			// `code` is accepted as well because clients drifted onto it while
			// this endpoint was a stub. Tolerating both costs nothing and
			// removes a class of "which field?" failures during the migration;
			// it can be dropped once every client is on `otp`.
			Code string `json:"code"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		code := req.OTP
		if code == "" {
			code = req.Code
		}
		result, err := svc.VerifyOTP(r.Context(),
			firstNonEmpty(req.Workspace, req.ChurchSlug, req.Slug), req.Phone, code)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, result)
	}
}

func handleRefresh(svc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			RefreshToken string `json:"refreshToken"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		result, err := svc.Refresh(r.Context(), req.RefreshToken)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, result)
	}
}

func handleLogout(d *deps.Deps, svc *auth.Service, notifications *notification.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw := bearer(r)
		claims, claimsErr := d.Tokens.Verify(r.Context(), raw, token.KindAccess)
		var deviceErr error
		if claimsErr == nil {
			deviceErr = notifications.RemoveDevices(notificationContext(r, claims), claims.UserID, claims.Family)
		}
		if err := svc.Logout(r.Context(), raw); err != nil {
			writeAuthError(w, err)
			return
		}
		if deviceErr != nil {
			d.Log.Error("signed-out session device cleanup failed",
				slog.String("user_id", claims.UserID), slog.String("error", deviceErr.Error()))
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"message": "Signed out.", "deviceCleanupConfirmed": deviceErr == nil,
		})
	}
}

func handleLogoutEverywhere(d *deps.Deps, svc *auth.Service, notifications *notification.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw := bearer(r)
		claims, claimsErr := d.Tokens.Verify(r.Context(), raw, token.KindAccess)
		var deviceErr error
		if claimsErr == nil {
			deviceErr = notifications.RemoveDevices(notificationContext(r, claims), claims.UserID, "")
		}
		if err := svc.LogoutEverywhere(r.Context(), raw); err != nil {
			writeAuthError(w, err)
			return
		}
		if deviceErr != nil {
			d.Log.Error("global sign-out device cleanup failed",
				slog.String("user_id", claims.UserID), slog.String("error", deviceErr.Error()))
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"message": "Signed out on all devices.", "deviceCleanupConfirmed": deviceErr == nil,
		})
	}
}

func notificationContext(r *http.Request, claims *token.Claims) context.Context {
	return tenancy.WithScope(r.Context(), tenancy.Scope{
		ChurchID: claims.ChurchID, OrganizationID: claims.OrganizationID,
		UserID: claims.UserID, Role: claims.Role, CrossBranch: crossBranch(claims.Role),
	})
}

func handleMe(svc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := svc.CurrentUser(r.Context(), bearer(r))
		if err != nil {
			writeAuthError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, user)
	}
}

// writeAuthError maps domain errors to status codes without leaking which
// specific check failed. Every credential failure is a flat 401 with one
// message, so the endpoint cannot be used to enumerate accounts.
func writeAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials),
		errors.Is(err, token.ErrInvalid),
		errors.Is(err, token.ErrWrongKind):
		httpx.Error(w, http.StatusUnauthorized, "Invalid credentials")

	case errors.Is(err, token.ErrRevoked):
		httpx.Error(w, http.StatusUnauthorized, "Session has ended. Please sign in again.")

	case errors.Is(err, auth.ErrAccountDeactivated):
		httpx.Error(w, http.StatusForbidden, "This account has been deactivated.")

	case errors.Is(err, auth.ErrPhoneVerificationRequired):
		httpx.Error(w, http.StatusForbidden,
			"Verify your phone first. Use the phone code sign-in option.")

	case errors.Is(err, auth.ErrOTPNotFound):
		httpx.Error(w, http.StatusBadRequest, "That code has expired. Request a new one.")

	case errors.Is(err, auth.ErrOTPIncorrect):
		httpx.Error(w, http.StatusBadRequest, "That code is not correct.")

	case errors.Is(err, auth.ErrOTPTooManyAttempts):
		httpx.Error(w, http.StatusTooManyRequests, "Too many attempts. Request a new code.")

	case errors.Is(err, auth.ErrOTPTooSoon):
		httpx.Error(w, http.StatusTooManyRequests, "A code was just sent. Please wait a moment.")

	case errors.Is(err, auth.ErrPhoneRequired):
		httpx.Error(w, http.StatusBadRequest, "A phone number is required.")

	case errors.Is(err, auth.ErrPhoneInvalid):
		httpx.Error(w, http.StatusBadRequest, "Enter a valid phone number with its country code.")

	case errors.Is(err, auth.ErrRegistrationInvalid):
		httpx.Error(w, http.StatusBadRequest, "Enter a valid name, email, phone number, and password.")

	case errors.Is(err, auth.ErrChurchUnavailable):
		httpx.Error(w, http.StatusNotFound, "That church is not available for registration.")

	case errors.Is(err, auth.ErrAccountExists):
		httpx.Error(w, http.StatusConflict, "An account with those details already exists.")

	case errors.Is(err, auth.ErrUserNotFound):
		httpx.Error(w, http.StatusNotFound, "User not found")

	default:
		// Never surface an internal error message to the client.
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}

// decode reads a JSON body with a size limit.
//
// Unknown fields are tolerated rather than rejected: the frontends and the Go
// API version independently, and a client sending one extra key should not get
// a 400. The body is read once — retrying a decode after a failed read cannot
// work, because the reader is already consumed.
func decode(r *http.Request, into any) error {
	const maxBody = 1 << 20 // 1 MiB is ample for an auth payload
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBody)).Decode(into)
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if after, ok := strings.CutPrefix(h, "Bearer "); ok {
		return strings.TrimSpace(after)
	}
	return ""
}

// firstNonEmpty returns the first value that is not blank.
//
// Clients spell the workspace three ways during the WP-35 rollout; accepting
// all three is cheaper than coordinating a single cutover across a mobile app,
// three web apps and the legacy API.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
