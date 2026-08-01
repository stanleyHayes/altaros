package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/payments"
	"github.com/hayfordstanley/altar-os/internal/platform/payments/paystack"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// DefaultCommissionBasisPoints is the platform's cut when a church has no
// negotiated rate. 150 = 1.5%. See §10 Q-7 — this is a business decision that
// is written into each church's subaccount at creation.
const DefaultCommissionBasisPoints int64 = 150

// buildFinance mounts the giving and ledger routes (WP-14).
func buildFinance(d *deps.Deps) http.Handler { return standalone(financeRoutes(d)) }

// financeRoutes registers the giving and ledger endpoints onto a router.
func financeRoutes(d *deps.Deps) routeSet {
	gateway := paystack.New(paystack.Config{
		SecretKey:                    d.Config.Paystack.SecretKey,
		CallbackURL:                  d.Config.Paystack.CallbackURL,
		WebhookSecret:                d.Config.Paystack.WebhookSecret,
		DefaultCommissionBasisPoints: DefaultCommissionBasisPoints,
	})
	directory := &churchDirectory{churches: church.NewService(d.Mongo)}
	// d.Events, not nil: this is what makes giving.completed actually reach
	// the notification service. It was nil until now, so the receipt half of
	// WP-15 could never fire however correct both halves were in isolation.
	svc := finance.NewService(d.Mongo, gateway, directory, d.Events)

	return func(r chi.Router) {
		// The webhook is registered OUTSIDE the auth middleware on purpose:
		// Paystack has no session and cannot present a bearer token. Its
		// authentication is the HMAC signature over the raw body, checked
		// before anything is read from it.
		r.Post("/finance/webhooks/paystack", handlePaystackWebhook(svc, gateway))

		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))

			// Any signed-in member may give.
			r.Post("/finance/give/quote", handleGivingQuote(svc))
			r.Post("/finance/give", handleStartGiving(svc))
			r.Get("/finance/transactions/{reference}", handleGetTransaction(svc))
			r.Post("/finance/transactions/{reference}/settle", handleSettle(svc))
			r.Get("/finance/me/giving", handleMyGiving(svc))

			// The church's books are a leadership view.
			r.Group(func(r chi.Router) {
				r.Use(requireRole(RoleOrgAdmin, RoleChurchAdmin))
				r.Get("/finance/summary", handleSummary(svc))
				r.Get("/finance/transactions", handleListTransactions(svc))
				r.Post("/finance/cash", handleRecordCash(svc))
				r.Get("/finance/members/{memberId}/giving", handleMemberGiving(svc))
			})
		})
	}
}

// handleGivingQuote is the non-mutating first half of checkout. The mobile
// client must be able to show the exact debit before it creates a pending
// transaction or sends the member to Paystack.
func handleGivingQuote(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Amount    string `json:"amount"`
			Currency  string `json:"currency"`
			Channel   string `json:"channel"`
			Anonymous bool   `json:"anonymous"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		currency := req.Currency
		if currency == "" {
			currency = "GHS"
		}
		amount, err := money.Parse(req.Amount, currency)
		if err != nil || amount.Minor <= 0 {
			httpx.Error(w, http.StatusBadRequest, "That amount is not valid.")
			return
		}
		if !money.ValidChannel(req.Channel) || req.Channel == money.ChannelCash {
			httpx.Error(w, http.StatusBadRequest, "That payment channel is not valid.")
			return
		}
		scope, err := callerScope(r)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		var priorToday int64
		if !req.Anonymous {
			priorToday, _ = svc.GivenTodayMinor(r.Context(), scope.UserID, time.Now())
		}
		httpx.JSON(w, http.StatusOK, money.QuoteELevy(amount, req.Channel, priorToday))
	}
}

// churchDirectory adapts the church service to what finance needs. The
// adapter exists so the two services stay separable under ADR-004 — finance
// depends on an interface it declares, not on the church package's shape.
type churchDirectory struct {
	churches *church.Service
}

func (c *churchDirectory) PayoutFor(ctx context.Context, churchID string) (*finance.ChurchPayout, error) {
	ch, err := c.churches.ByID(ctx, churchID)
	if err != nil {
		return nil, err
	}
	currency := ch.Currency
	if currency == "" {
		currency = "GHS"
	}
	return &finance.ChurchPayout{
		SubaccountCode:        ch.PayoutSubaccount,
		Currency:              currency,
		CommissionBasisPoints: DefaultCommissionBasisPoints,
		Name:                  ch.Name,
	}, nil
}

func handleStartGiving(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Type string `json:"type"`
			// AmountMinor is the gift in minor units. A decimal string is
			// accepted too, for clients that would otherwise send a float —
			// see the note on Amount below.
			AmountMinor        int64  `json:"amountMinor"`
			Amount             string `json:"amount"`
			Currency           string `json:"currency"`
			Channel            string `json:"channel"`
			Email              string `json:"email"`
			CampaignID         string `json:"campaignId"`
			Note               string `json:"note"`
			Anonymous          bool   `json:"anonymous"`
			CallbackURL        string `json:"callbackUrl"`
			AcceptedTotalMinor int64  `json:"acceptedTotalMinor"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		scope, err := callerScope(r)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}

		currency := req.Currency
		if currency == "" {
			currency = "GHS"
		}

		// Amount is accepted as minor units or as a decimal STRING, never as a
		// JSON number. A JSON number decodes through float64, and 0.10 as a
		// float64 times 100 is 10.000000000000002 — the pesewa this whole
		// money model exists to protect.
		var amount money.Amount
		switch {
		case req.AmountMinor > 0:
			amount, err = money.New(req.AmountMinor, currency)
		case req.Amount != "":
			amount, err = money.Parse(req.Amount, currency)
		default:
			httpx.Error(w, http.StatusBadRequest, "An amount is required.")
			return
		}
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "That amount is not valid.")
			return
		}

		memberID := scope.UserID
		if req.Anonymous {
			memberID = ""
		}

		// Quote the levy against what this giver has already transferred
		// today: the threshold is cumulative, so charging per transaction
		// under-quotes exactly the member who gives most often.
		var priorToday int64
		if memberID != "" {
			priorToday, _ = svc.GivenTodayMinor(r.Context(), memberID, time.Now())
		}
		quote := money.QuoteELevy(amount, req.Channel, priorToday)
		if req.AcceptedTotalMinor <= 0 || req.AcceptedTotalMinor != quote.Total.Minor {
			httpx.Error(w, http.StatusConflict, "The total changed. Review the latest quote before continuing.")
			return
		}

		result, err := svc.StartGiving(r.Context(), finance.GiveRequest{
			MemberID:        memberID,
			Type:            finance.Type(req.Type),
			Amount:          amount,
			Channel:         req.Channel,
			Email:           req.Email,
			PriorTodayMinor: priorToday,
			CampaignID:      req.CampaignID,
			Note:            req.Note,
			CallbackURL:     req.CallbackURL,
		})
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, result)
	}
}

// handlePaystackWebhook authenticates and processes a provider callback.
//
// Paystack retries until it sees a 2xx, so this endpoint answers 200 for
// anything it has correctly handled — including a replay it deliberately did
// nothing about. Returning an error for a duplicate would make the provider
// retry forever.
func handlePaystackWebhook(svc *finance.Service, gateway payments.Gateway) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const maxWebhook = 1 << 20
		body, err := io.ReadAll(io.LimitReader(r.Body, maxWebhook))
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "Could not read request body")
			return
		}

		// The signature covers the exact bytes received, so it is verified
		// against the raw body before anything is parsed out of it.
		event, err := gateway.ParseWebhook(r.Header.Get(paystack.SignatureHeader), body)
		if err != nil {
			switch {
			case errors.Is(err, payments.ErrInvalidSignature):
				// 401, not 400: this did not come from Paystack. Saying more
				// would help someone calibrate a forgery.
				httpx.Error(w, http.StatusUnauthorized, "Invalid signature")

			case errors.Is(err, payments.ErrNotConfigured):
				// We cannot verify anything without a signing key, so nothing
				// here is safe to act on. 503 rather than 400 because the
				// fault is ours: telling Paystack its request was malformed
				// would send someone debugging the wrong system, and Paystack
				// retries a 503 once the key is in place.
				httpx.Error(w, http.StatusServiceUnavailable,
					"Payment webhooks are not configured on this deployment.")

			default:
				httpx.Error(w, http.StatusBadRequest, "Could not read webhook")
			}
			return
		}

		// Only charge outcomes settle a transaction. Anything else is
		// acknowledged so the provider stops retrying, and ignored.
		if event.Type != payments.EventChargeSuccess && event.Type != payments.EventChargeFailed {
			httpx.JSON(w, http.StatusOK, map[string]any{"received": true, "handled": false})
			return
		}

		tx, err := svc.SettleFromWebhook(r.Context(), event)
		if err != nil {
			if errors.Is(err, finance.ErrNotFound) {
				// A reference we never issued is not ours. Acknowledge so the
				// provider stops retrying something we can never handle.
				httpx.JSON(w, http.StatusOK, map[string]any{"received": true, "handled": false})
				return
			}
			// A mismatch or a wrong settlement needs a human. Return 500 so
			// the provider retries and the failure is visible, rather than
			// being acknowledged into silence.
			httpx.Error(w, http.StatusInternalServerError, "Could not settle transaction")
			return
		}

		httpx.JSON(w, http.StatusOK, map[string]any{
			"received": true,
			"handled":  true,
			"status":   string(tx.Status),
		})
	}
}

func handleSettle(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// The callback path: the giver returned to the app before the webhook
		// arrived. Same settlement code, so whichever wins the race the
		// transaction settles exactly once.
		tx, err := svc.Settle(r.Context(), chi.URLParam(r, "reference"))
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, tx)
	}
}

func handleGetTransaction(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tx, err := svc.ByReference(r.Context(), chi.URLParam(r, "reference"))
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		// A member may only see their own transaction.
		if !selfOrLeader(r, tx.MemberID.String()) {
			httpx.Error(w, http.StatusForbidden, "You do not have permission to do that.")
			return
		}
		httpx.JSON(w, http.StatusOK, tx)
	}
}

func handleListTransactions(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := finance.Query{
			MemberID:  r.URL.Query().Get("memberId"),
			Type:      finance.Type(r.URL.Query().Get("type")),
			Status:    finance.Status(r.URL.Query().Get("status")),
			Direction: finance.Direction(r.URL.Query().Get("direction")),
			From:      parseTime(r.URL.Query().Get("from")),
			To:        parseTime(r.URL.Query().Get("to")),
		}
		txs, err := svc.List(r.Context(), q)
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		if txs == nil {
			txs = []finance.Transaction{}
		}
		httpx.JSON(w, http.StatusOK, txs)
	}
}

func handleSummary(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		summary, err := svc.Summarize(r.Context(),
			parseTime(r.URL.Query().Get("from")),
			parseTime(r.URL.Query().Get("to")),
			r.URL.Query().Get("currency"))
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, summary)
	}
}

func handleRecordCash(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			MemberID    string `json:"memberId"`
			Type        string `json:"type"`
			Direction   string `json:"direction"`
			Amount      string `json:"amount"`
			AmountMinor int64  `json:"amountMinor"`
			Currency    string `json:"currency"`
			Note        string `json:"note"`
			OccurredAt  string `json:"occurredAt"`
		}
		if err := decode(r, &req); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		currency := req.Currency
		if currency == "" {
			currency = "GHS"
		}

		var (
			amount money.Amount
			err    error
		)
		switch {
		case req.AmountMinor > 0:
			amount, err = money.New(req.AmountMinor, currency)
		case req.Amount != "":
			amount, err = money.Parse(req.Amount, currency)
		default:
			httpx.Error(w, http.StatusBadRequest, "An amount is required.")
			return
		}
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "That amount is not valid.")
			return
		}

		tx, err := svc.RecordCash(r.Context(), finance.CashRequest{
			MemberID:   req.MemberID,
			Type:       finance.Type(req.Type),
			Direction:  finance.Direction(req.Direction),
			Amount:     amount,
			Note:       req.Note,
			OccurredAt: parseTime(req.OccurredAt),
		})
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, tx)
	}
}

func handleMyGiving(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		giving, err := svc.GivingFor(r.Context(), scope.UserID,
			parseTime(r.URL.Query().Get("from")), parseTime(r.URL.Query().Get("to")))
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, giving)
	}
}

func handleMemberGiving(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		memberID := chi.URLParam(r, "memberId")
		if !selfOrLeader(r, memberID) {
			httpx.Error(w, http.StatusForbidden, "You do not have permission to do that.")
			return
		}
		giving, err := svc.GivingFor(r.Context(), memberID,
			parseTime(r.URL.Query().Get("from")), parseTime(r.URL.Query().Get("to")))
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, giving)
	}
}

// parseTime reads an RFC-3339 timestamp, returning the zero time for anything
// unparseable — which the query layer treats as "no bound" rather than as an
// error. A malformed date in a report filter should widen the window, not fail
// the page.
func parseTime(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02", raw); err == nil {
		return t
	}
	return time.Time{}
}

func writeFinanceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, finance.ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "Transaction not found")

	case errors.Is(err, finance.ErrNoSubaccount):
		// This is a setup problem the church admin can fix, so say so
		// plainly rather than returning a generic failure.
		httpx.Error(w, http.StatusConflict,
			"This church has no payout account set up yet, so it cannot receive giving.")

	case errors.Is(err, finance.ErrAmountRequired):
		httpx.Error(w, http.StatusBadRequest, "An amount is required.")

	case errors.Is(err, finance.ErrInvalidType):
		httpx.Error(w, http.StatusBadRequest, "That giving type is not recognised.")

	case errors.Is(err, finance.ErrInvalidChannel):
		httpx.Error(w, http.StatusBadRequest, "That payment method is not available.")

	case errors.Is(err, money.ErrCurrencyMismatch):
		httpx.Error(w, http.StatusBadRequest, "This church does not accept that currency.")

	case errors.Is(err, finance.ErrDuplicate):
		httpx.Error(w, http.StatusConflict, "That transaction has already been recorded.")

	case errors.Is(err, finance.ErrAmountMismatch), errors.Is(err, finance.ErrWrongSettlement):
		// Never expose the amounts involved: this is a reconciliation problem
		// for staff, and the detail is in the logs and the audit trail.
		httpx.Error(w, http.StatusConflict,
			"This payment needs review before it can be recorded.")

	case errors.Is(err, payments.ErrNotConfigured):
		httpx.Error(w, http.StatusServiceUnavailable,
			"Giving is not available right now. Please try again shortly.")

	case errors.Is(err, payments.ErrUnavailable):
		httpx.Error(w, http.StatusBadGateway,
			"The payment provider is not responding. Please try again shortly.")

	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")

	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
