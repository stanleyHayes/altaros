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
	"github.com/hayfordstanley/altar-os/internal/domain/platformsetting"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/payments"
	"github.com/hayfordstanley/altar-os/internal/platform/payments/paystack"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// DefaultCommissionBasisPoints is the fallback when nothing has been entered
// on the platform dashboard.
//
// Q-7 is answered (2 Aug 2026): the rate is a value an operator sets, not a
// constant a developer sets. This is what applies before they have — see
// platformsetting, which is the real source and which a church may override
// per-subaccount for a negotiated rate.
const DefaultCommissionBasisPoints = platformsetting.DefaultCommissionBasisPoints

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
	directory := &churchDirectory{
		churches: church.NewService(d.Mongo),
		settings: platformsetting.NewService(d.Mongo),
	}
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
			// Without this every requirePermission below reads an empty set and
			// refuses everyone. permissionsFrom deliberately returns an empty
			// set rather than an error, so the failure is a silent 404 on the
			// church books rather than anything that looks like a wiring bug.
			r.Use(resolvePermissions(d))

			// Any signed-in member may give, and these routes deliberately keep
			// NO finance permission.
			//
			// The Member system role holds none — see the comment on it in
			// rbac/role.go — because a member's access to their own giving is
			// ownership, not a permission over the congregation's records.
			// Guarding these with finance:read would stop the congregation
			// giving, which is the product, and would leave members with no way
			// to see their own receipts.
			r.Post("/finance/give/quote", handleGivingQuote(svc, directory))
			r.Post("/finance/give", handleStartGiving(svc, directory))
			// Ownership-checked inside the handler via selfOr, which is
			// the only guard here and has to stay that way: a member reading
			// their own receipt holds nothing that would satisfy a permission.
			r.Get("/finance/transactions/{reference}", handleGetTransaction(svc))
			// A WRITE performed by ordinary members — the callback half of the
			// settle race, when the giver returns to the app before Paystack's
			// webhook lands. Any finance write permission would be wrong twice:
			// members do not hold one, and requiring one would leave a paid
			// transaction pending until the webhook arrived.
			r.Post("/finance/transactions/{reference}/settle", handleSettle(svc))
			// The query IS the ownership check — it filters on the caller's own
			// id. This is the route the whole "a member reads their own giving"
			// guarantee rests on.
			r.Get("/finance/me/giving", handleMyGiving(svc))

			// The church's books. Guarded by PERMISSION rather than role name,
			// which is what lets a church invent a Treasurer role and have it
			// work — a hard-coded allowlist cannot express a role that did not
			// exist when the allowlist was written.
			r.With(requirePermission(rbac.ResourceFinance, rbac.ActionRead)).
				Get("/finance/summary", handleSummary(svc))

			// Not a list endpoint wearing its own clothes: ?memberId= makes
			// this a congregation-wide giving reader, and there is no ownership
			// check on it at all.
			r.With(requirePermission(rbac.ResourceFinance, rbac.ActionRead)).
				Get("/finance/transactions", handleListTransactions(svc))

			// CREATE, not read. This mints ledger entries and accepts an
			// arbitrary memberId in the body, so it must not collapse into the
			// same permission as the three read routes — otherwise anyone who
			// can view the books can also record cash against another member's
			// name. (Write implies read, so finance:create subsumes what it
			// needs to display the result.)
			r.With(requirePermission(rbac.ResourceFinance, rbac.ActionCreate)).
				Post("/finance/cash", handleRecordCash(svc))

			// finance:read OR the member themselves — an OR, not an AND.
			// The handler's ownership check was previously dead code, since
			// the enclosing role allowlist admitted only leaders and it could
			// never deny. Guarding this with requirePermission alone would deny
			// a member their own giving history; requiring both would do the
			// same. The handler decides.
			r.Get("/finance/members/{memberId}/giving", handleMemberGiving(svc))
		})
	}
}

// handleGivingQuote is the non-mutating first half of checkout. The mobile
// client must be able to show the exact debit before it creates a pending
// transaction or sends the member to Paystack.
func handleGivingQuote(svc *finance.Service, dir *churchDirectory) http.HandlerFunc {
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
		// Anonymous controls what the church sees; it must not reset the
		// signed-in giver's cumulative transfer allowance.
		priorToday, _ := svc.GivenTodayMinor(r.Context(), scope.UserID, time.Now())

		quote, err := givingQuoteFor(r.Context(), dir, scope.ChurchID, amount,
			req.Channel, priorToday)
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		// The levy is spread at the top level as well as nested, because
		// existing clients read `total`, `levy` and `exempt` from this
		// response. Removing them would break a shipped mobile app to tidy a
		// shape; `quote.total` is the field new clients should read, and it is
		// the same number.
		httpx.JSON(w, http.StatusOK, map[string]any{
			"quote":  quote,
			"levy":   quote.Levy.Levy,
			"total":  quote.Total,
			"exempt": quote.Levy.Exempt,
			"reason": quote.Levy.Reason,
			"fee":    quote.Fee,
		})
	}
}

// churchDirectory adapts the church service to what finance needs. The
// adapter exists so the two services stay separable under ADR-004 — finance
// depends on an interface it declares, not on the church package's shape.
//
// It is also where the platform's commercial terms and the church's own
// settings are RECONCILED, so finance never has to know there were two sources:
// the commission is the church's override or the platform rate (Q-7), and the
// fee bearer is the church's choice or the platform default (Q-4).
type churchDirectory struct {
	churches *church.Service
	settings *platformsetting.Service
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

	// A failure to read the platform settings must not stop a church taking a
	// gift. Defaults() is what a platform with no settings document runs on
	// anyway, so falling back to it degrades to the documented starting state
	// rather than to nothing.
	current, err := c.settings.Current(ctx)
	if err != nil {
		current = platformsetting.Defaults()
	}

	// The per-church override wins, and it is read from a POINTER so that a
	// launch partner on 0% is distinguishable from a church with no override.
	commission := current.CommissionBasisPoints
	if ch.CommissionBasisPoints != nil {
		commission = *ch.CommissionBasisPoints
	}

	// The church's choice wins; an unset one follows the platform default,
	// which is what lets changing the default reach every church that never
	// made a choice.
	bearer := current.DefaultFeeBearer
	if ch.FeeBearer != "" {
		bearer = money.NormaliseFeeBearer(ch.FeeBearer)
	}

	return &finance.ChurchPayout{
		SubaccountCode:        ch.PayoutSubaccount,
		Currency:              currency,
		CommissionBasisPoints: commission,
		Name:                  ch.Name,
		FeeBearer:             bearer,
	}, nil
}

// FeeScheduleFor returns the provider's rate card for a channel.
func (c *churchDirectory) FeeScheduleFor(ctx context.Context, channel string) (money.FeeSchedule, error) {
	current, err := c.settings.Current(ctx)
	if err != nil {
		// An empty schedule quotes a ZERO fee, which means the church absorbs
		// a charge it did not expect. That is the right direction to fail: the
		// alternative is guessing a rate and showing a giver a number nobody
		// entered.
		return money.FeeSchedule{}, nil
	}
	return current.FeeFor(channel), nil
}

func handleStartGiving(svc *finance.Service, directory *churchDirectory) http.HandlerFunc {
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
		priorToday, _ := svc.GivenTodayMinor(r.Context(), scope.UserID, time.Now())

		// The FULL quote, not the levy alone.
		//
		// This check exists so a giver is never debited more than the screen
		// showed them. Comparing against the levy total alone made it blind to
		// exactly the amount Q-4 introduced: with the giver bearing the
		// provider fee, the debit exceeds the levy total by the fee and the
		// guard would have passed without noticing.
		quote, err := givingQuoteFor(r.Context(), directory, scope.ChurchID, amount,
			req.Channel, priorToday)
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		if !acceptedQuoteTotal(req.AcceptedTotalMinor, quote) {
			httpx.Error(w, http.StatusConflict, "The total changed. Review the latest quote before continuing.")
			return
		}

		result, err := svc.StartGiving(r.Context(), finance.GiveRequest{
			MemberID:        memberID,
			InitiatorID:     scope.UserID,
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

func acceptedQuoteTotal(accepted int64, quote money.GivingQuote) bool {
	return accepted > 0 && accepted == quote.Total.Minor
}

// givingQuoteFor prices a gift the way StartGiving will.
//
// Shared by the quote endpoint and the confirmation guard on purpose: two
// independent implementations of the same arithmetic would agree until one of
// them was changed, and the symptom of them disagreeing is a giver being told
// their total changed when it did not.
func givingQuoteFor(ctx context.Context, dir *churchDirectory, churchID string,
	amount money.Amount, channel string, priorTodayMinor int64) (money.GivingQuote, error) {

	payout, err := dir.PayoutFor(ctx, churchID)
	if err != nil {
		return money.GivingQuote{}, err
	}
	schedule, err := dir.FeeScheduleFor(ctx, channel)
	if err != nil {
		return money.GivingQuote{}, err
	}
	return money.QuoteGiving(amount, channel, priorTodayMinor, schedule, payout.FeeBearer), nil
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
		reference := chi.URLParam(r, "reference")
		stored, err := svc.ByReference(r.Context(), reference)
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		if !selfOr(r, transactionOwnerID(stored), rbac.ResourceFinance, rbac.ActionRead) {
			httpx.Error(w, http.StatusForbidden, "You do not have permission to do that.")
			return
		}
		tx, err := svc.Settle(r.Context(), reference)
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
		if !selfOr(r, transactionOwnerID(tx), rbac.ResourceFinance, rbac.ActionRead) {
			httpx.Error(w, http.StatusForbidden, "You do not have permission to do that.")
			return
		}
		httpx.JSON(w, http.StatusOK, tx)
	}
}

func transactionOwnerID(tx *finance.Transaction) string {
	if tx.InitiatedBy.String() != "" {
		return tx.InitiatedBy.String()
	}
	return tx.MemberID.String()
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
		giving, err := svc.List(r.Context(), finance.Query{
			OwnerID: scope.UserID,
			From:    parseTime(r.URL.Query().Get("from")),
			To:      parseTime(r.URL.Query().Get("to")),
			Limit:   500,
		})
		if err != nil {
			writeFinanceError(w, err)
			return
		}
		if giving == nil {
			giving = []finance.Transaction{}
		}
		httpx.JSON(w, http.StatusOK, giving)
	}
}

func handleMemberGiving(svc *finance.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		memberID := chi.URLParam(r, "memberId")
		if !selfOr(r, memberID, rbac.ResourceFinance, rbac.ActionRead) {
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
