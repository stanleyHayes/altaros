package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

// buildAuth mounts the auth routes (WP-10).
//
// Paths match what the existing TypeScript frontends already call, so the
// dashboard, web and admin apps can be pointed at the Go gateway without
// changing their service layers.
func buildAuth(d *deps.Deps) http.Handler {
	svc := auth.NewService(d.Mongo, d.Tokens, d.Redis, smsSenderFor(d))

	r := chi.NewRouter()
	r.Post("/auth/login", handleLogin(svc))
	r.Post("/auth/request-otp", handleRequestOTP(svc))
	r.Post("/auth/verify-otp", handleVerifyOTP(svc))
	r.Post("/auth/refresh-token", handleRefresh(svc))
	r.Post("/auth/logout", handleLogout(svc))
	r.Post("/auth/logout-all", handleLogoutEverywhere(svc))
	r.Get("/auth/me", handleMe(svc))
	return r
}

type loginRequest struct {
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Password string `json:"password"`
	Method   string `json:"method"`
}

func handleLogin(svc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		// PHONE means "send me a code" — it is not a password login.
		if strings.EqualFold(req.Method, "PHONE") {
			if err := svc.RequestOTP(r.Context(), req.Phone); err != nil {
				writeAuthError(w, err)
				return
			}
			httpx.JSON(w, http.StatusOK, map[string]any{
				"message": "If that number belongs to a member, a code has been sent.",
			})
			return
		}

		result, err := svc.LoginWithPassword(r.Context(), req.Email, req.Password)
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
			Phone string `json:"phone"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		if err := svc.RequestOTP(r.Context(), req.Phone); err != nil {
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
			Phone string `json:"phone"`
			Code  string `json:"code"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		result, err := svc.VerifyOTP(r.Context(), req.Phone, req.Code)
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

func handleLogout(svc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.Logout(r.Context(), bearer(r)); err != nil {
			writeAuthError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"message": "Signed out."})
	}
}

func handleLogoutEverywhere(svc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.LogoutEverywhere(r.Context(), bearer(r)); err != nil {
			writeAuthError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"message": "Signed out on all devices."})
	}
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
