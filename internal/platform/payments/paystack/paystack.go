// Package paystack implements the payments.Gateway port against Paystack.
//
// This replaces the StubPaymentGateway whose verifyCharge() returned success
// unconditionally — a stub that green-lit every payment, and the reason WP-05
// makes a missing PAYSTACK_SECRET_KEY fail the boot in production (§9, R-5).
//
// # The split, and the direction that matters
//
// Paystack's subaccount field `percentage_charge` is "the percentage the MAIN
// account receives from each payment made to the subaccount". It is not the
// percentage the subaccount keeps. Reading it the intuitive way round — as the
// church's share — would send 98.5% of every tithe to ALTAR OS and 1.5% to the
// church, on every transaction, silently.
//
// This adapter avoids depending on that reading at all. Every charge passes an
// explicit `transaction_charge`: a flat amount in minor units that goes to the
// main account regardless of the subaccount's configured split. We compute it
// ourselves in integer basis points, so our ledger and Paystack's split are the
// same number rather than two roundings of the same percentage.
package paystack

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/payments"
)

// DefaultBaseURL is Paystack's API root.
const DefaultBaseURL = "https://api.paystack.co"

// SignatureHeader carries the webhook HMAC.
const SignatureHeader = "x-paystack-signature"

// Config configures the gateway.
type Config struct {
	SecretKey   string
	CallbackURL string
	// WebhookSecret verifies inbound webhooks. Paystack signs with the SECRET
	// KEY itself, so for Paystack this should either be left empty (the secret
	// key is then used) or set to the same value. It exists as a separate knob
	// so a key rotation can be staged, and so tests can sign with a throwaway
	// key. Setting it to some other value silently rejects every real webhook.
	WebhookSecret string
	// BaseURL overrides the API root for tests.
	BaseURL string
	// HTTPClient overrides the default client.
	HTTPClient *http.Client
	// DefaultCommissionBasisPoints is the platform's cut when a charge does
	// not carry an explicit fee. 150 = 1.5%.
	DefaultCommissionBasisPoints int64
	// FeeBearer decides who pays Paystack's own processing fee: "subaccount"
	// (the church) or "account" (ALTAR OS). Defaults to subaccount, because
	// under ADR-002 the church is the merchant and the fee is a cost of its
	// own collection, not a platform expense.
	FeeBearer string
}

// Gateway is the Paystack implementation of payments.Gateway.
type Gateway struct {
	secretKey     string
	webhookKey    string
	callbackURL   string
	baseURL       string
	http          *http.Client
	defaultBPS    int64
	feeBearer     string
	configuredErr error
}

// Compile-time proof that the adapter satisfies the port.
var _ payments.Gateway = (*Gateway)(nil)

// New builds a Paystack gateway.
//
// A gateway with no secret key is returned in a refusing state rather than as
// an error, so that a deployment which genuinely has no payments configured
// (a development gateway, say) still boots — but every call fails loudly
// instead of quietly pretending to succeed the way the stub did.
func New(cfg Config) *Gateway {
	g := &Gateway{
		secretKey:   strings.TrimSpace(cfg.SecretKey),
		webhookKey:  strings.TrimSpace(cfg.WebhookSecret),
		callbackURL: cfg.CallbackURL,
		baseURL:     strings.TrimRight(cfg.BaseURL, "/"),
		http:        cfg.HTTPClient,
		defaultBPS:  cfg.DefaultCommissionBasisPoints,
		feeBearer:   cfg.FeeBearer,
	}
	if g.baseURL == "" {
		g.baseURL = DefaultBaseURL
	}
	if g.http == nil {
		g.http = &http.Client{Timeout: 30 * time.Second}
	}
	if g.webhookKey == "" {
		// Paystack signs with the secret key.
		g.webhookKey = g.secretKey
	}
	if g.feeBearer == "" {
		g.feeBearer = "subaccount"
	}
	if g.secretKey == "" {
		g.configuredErr = fmt.Errorf("%w: PAYSTACK_SECRET_KEY is empty", payments.ErrNotConfigured)
	}
	return g
}

// Name identifies the provider on stored transactions.
func (g *Gateway) Name() string { return "paystack" }

// CreateSubaccount registers a church as its own merchant.
func (g *Gateway) CreateSubaccount(ctx context.Context, req payments.SubaccountRequest) (*payments.Subaccount, error) {
	if g.configuredErr != nil {
		return nil, g.configuredErr
	}
	if strings.TrimSpace(req.BusinessName) == "" {
		return nil, fmt.Errorf("%w: business name is required", payments.ErrProvider)
	}
	if strings.TrimSpace(req.SettlementBank) == "" || strings.TrimSpace(req.AccountNumber) == "" {
		return nil, fmt.Errorf("%w: settlement bank and account number are required", payments.ErrProvider)
	}

	bps := req.CommissionBasisPoints
	if bps == 0 {
		bps = g.defaultBPS
	}
	if bps < 0 || bps > 10000 {
		return nil, fmt.Errorf("%w: commission of %d bps is out of range", payments.ErrProvider, bps)
	}

	body := map[string]any{
		"business_name":   req.BusinessName,
		"settlement_bank": req.SettlementBank,
		"account_number":  req.AccountNumber,
		// The main account's share, per Paystack's definition. Sent as a
		// percentage because that is the field's unit; computed from basis
		// points so the stored intent stays integral.
		"percentage_charge": bpsToPercent(bps),
		"metadata": map[string]any{
			"churchId": req.ChurchID,
			"platform": "altar-os",
		},
	}
	if req.PrimaryContactEmail != "" {
		body["primary_contact_email"] = req.PrimaryContactEmail
	}
	if req.PrimaryContactPhone != "" {
		body["primary_contact_phone"] = req.PrimaryContactPhone
	}

	var out struct {
		Data struct {
			SubaccountCode   string  `json:"subaccount_code"`
			BusinessName     string  `json:"business_name"`
			SettlementBank   string  `json:"settlement_bank"`
			AccountNumber    string  `json:"account_number"`
			PercentageCharge float64 `json:"percentage_charge"`
			Active           bool    `json:"active"`
		} `json:"data"`
	}
	if err := g.do(ctx, http.MethodPost, "/subaccount", body, &out); err != nil {
		return nil, err
	}
	if out.Data.SubaccountCode == "" {
		return nil, fmt.Errorf("%w: subaccount created without a code", payments.ErrProvider)
	}

	return &payments.Subaccount{
		Code:                  out.Data.SubaccountCode,
		BusinessName:          out.Data.BusinessName,
		SettlementBank:        out.Data.SettlementBank,
		AccountNumber:         out.Data.AccountNumber,
		CommissionBasisPoints: percentToBPS(out.Data.PercentageCharge),
		Active:                out.Data.Active,
	}, nil
}

// UpdateSubaccountCommission rewrites the split stored on an existing
// subaccount.
//
// Idempotent by construction: it sets an absolute value rather than applying a
// delta, so a request that times out after the provider already applied it can
// simply be sent again. That property is what makes a backfill over hundreds of
// churches safe to re-run, and it is the reason this takes a rate rather than a
// change.
func (g *Gateway) UpdateSubaccountCommission(ctx context.Context, code string, bps int64) error {
	if g.configuredErr != nil {
		return g.configuredErr
	}
	if strings.TrimSpace(code) == "" {
		return fmt.Errorf("%w: no subaccount code", payments.ErrProvider)
	}
	if bps < 0 || bps > 10000 {
		return fmt.Errorf("%w: commission of %d bps is out of range", payments.ErrProvider, bps)
	}

	var out struct {
		Data struct {
			SubaccountCode   string  `json:"subaccount_code"`
			PercentageCharge float64 `json:"percentage_charge"`
		} `json:"data"`
	}
	body := map[string]any{"percentage_charge": bpsToPercent(bps)}
	if err := g.do(ctx, http.MethodPut, "/subaccount/"+url.PathEscape(code), body, &out); err != nil {
		return err
	}

	// The provider echoes what it stored. Checking it rather than trusting a
	// 200 is the difference between "we asked" and "it is set" — and the whole
	// point of a backfill is being able to say the second.
	if got := percentToBPS(out.Data.PercentageCharge); got != bps {
		return fmt.Errorf("%w: asked for %d bps, provider stored %d",
			payments.ErrProvider, bps, got)
	}
	return nil
}

// Initialize starts a charge that settles to the church's subaccount.
func (g *Gateway) Initialize(ctx context.Context, req payments.ChargeRequest) (*payments.Charge, error) {
	if g.configuredErr != nil {
		return nil, g.configuredErr
	}
	if strings.TrimSpace(req.Reference) == "" {
		return nil, fmt.Errorf("%w: reference is required for idempotency", payments.ErrProvider)
	}
	// ADR-002: a charge with no subaccount settles to ALTAR OS, which is the
	// custody this whole design exists to avoid. Refuse rather than default.
	if strings.TrimSpace(req.SubaccountCode) == "" {
		return nil, fmt.Errorf("%w: a charge must settle to the church's subaccount (ADR-002)",
			payments.ErrProvider)
	}
	if req.Amount.Minor <= 0 {
		return nil, fmt.Errorf("%w: amount must be positive", payments.ErrProvider)
	}
	if req.PlatformFee.Minor < 0 {
		return nil, fmt.Errorf("%w: platform fee cannot be negative", payments.ErrProvider)
	}
	if req.PlatformFee.Minor > 0 && req.PlatformFee.Currency != req.Amount.Currency {
		return nil, fmt.Errorf("%w: platform fee is in %s but the charge is in %s",
			payments.ErrProvider, req.PlatformFee.Currency, req.Amount.Currency)
	}
	if req.PlatformFee.Minor >= req.Amount.Minor {
		return nil, fmt.Errorf("%w: platform fee %s would consume the whole gift of %s",
			payments.ErrProvider, req.PlatformFee, req.Amount)
	}

	email := strings.TrimSpace(req.Email)
	if email == "" {
		return nil, fmt.Errorf("%w: email is required by the provider", payments.ErrProvider)
	}

	callback := req.CallbackURL
	if callback == "" {
		callback = g.callbackURL
	}

	body := map[string]any{
		// Paystack speaks minor units, which is what we store, so no
		// conversion happens here. The old TS draft did amount * 100 on a
		// float, which loses a pesewa on amounts like 0.10.
		"amount":     strconv.FormatInt(req.Amount.Minor, 10),
		"currency":   req.Amount.Currency,
		"email":      email,
		"reference":  req.Reference,
		"subaccount": req.SubaccountCode,
		// transaction_charge overrides the subaccount's configured split for
		// this transaction: this exact flat amount goes to the main account.
		// Passing it explicitly means our ledger and the split are the same
		// integer rather than two independent roundings of a percentage.
		"transaction_charge": req.PlatformFee.Minor,
		"bearer":             g.feeBearer,
	}
	if callback != "" {
		body["callback_url"] = callback
	}
	if req.Channel != "" {
		body["channels"] = paystackChannels(req.Channel)
	}
	if len(req.Metadata) > 0 {
		body["metadata"] = req.Metadata
	}

	var out struct {
		Data struct {
			AuthorizationURL string `json:"authorization_url"`
			AccessCode       string `json:"access_code"`
			Reference        string `json:"reference"`
		} `json:"data"`
	}
	if err := g.do(ctx, http.MethodPost, "/transaction/initialize", body, &out); err != nil {
		return nil, err
	}

	ref := out.Data.Reference
	if ref == "" {
		ref = req.Reference
	}
	return &payments.Charge{
		Reference:        ref,
		AuthorizationURL: out.Data.AuthorizationURL,
		AccessCode:       out.Data.AccessCode,
		Status:           payments.StatusPending,
	}, nil
}

// Verify asks Paystack what actually happened to a charge.
func (g *Gateway) Verify(ctx context.Context, reference string) (*payments.Verification, error) {
	if g.configuredErr != nil {
		return nil, g.configuredErr
	}
	ref := strings.TrimSpace(reference)
	if ref == "" {
		return nil, fmt.Errorf("%w: reference is required", payments.ErrProvider)
	}

	var out struct {
		Data struct {
			ID        json.Number `json:"id"`
			Reference string      `json:"reference"`
			Status    string      `json:"status"`
			Amount    int64       `json:"amount"`
			Currency  string      `json:"currency"`
			Fees      int64       `json:"fees"`
			Channel   string      `json:"channel"`
			PaidAt    string      `json:"paid_at"`
			Message   string      `json:"message"`
			// GatewayResponse is Paystack's human-readable outcome, which is
			// what a giver should be shown on failure.
			GatewayResponse string `json:"gateway_response"`
			Subaccount      struct {
				SubaccountCode string `json:"subaccount_code"`
			} `json:"subaccount"`
			// FeesSplit reports how the fee was apportioned when a split
			// applied; the main account's share is our commission.
			FeesSplit *struct {
				Paystack    int64 `json:"paystack"`
				Integration int64 `json:"integration"`
				Subaccount  int64 `json:"subaccount"`
			} `json:"fees_split"`
			// RequestedAmount is what was asked for; Amount is what was paid.
			RequestedAmount int64           `json:"requested_amount"`
			Metadata        json.RawMessage `json:"metadata"`
			Split           map[string]any  `json:"split"`
		} `json:"data"`
	}
	if err := g.do(ctx, http.MethodGet, "/transaction/verify/"+urlEscape(ref), nil, &out); err != nil {
		return nil, err
	}

	currency := out.Data.Currency
	if currency == "" {
		currency = "GHS"
	}
	amount, err := money.New(out.Data.Amount, currency)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payments.ErrProvider, err)
	}

	// Paystack's `fees` is its own processing fee. When a split applied,
	// fees_split.integration is the main account's share — our commission.
	providerFee := money.Amount{Minor: out.Data.Fees, Currency: currency}
	platformFee := money.Zero(currency)
	if out.Data.FeesSplit != nil {
		providerFee = money.Amount{Minor: out.Data.FeesSplit.Paystack, Currency: currency}
		platformFee = money.Amount{Minor: out.Data.FeesSplit.Integration, Currency: currency}
	}

	v := &payments.Verification{
		Reference:   out.Data.Reference,
		Status:      normalizeStatus(out.Data.Status),
		Amount:      amount,
		ProviderFee: providerFee,
		PlatformFee: platformFee,
		SettledTo:   out.Data.Subaccount.SubaccountCode,
		Channel:     normalizeChannel(out.Data.Channel),
		PaidAt:      out.Data.PaidAt,
		ProviderRef: out.Data.ID.String(),
		Metadata:    decodeMetadata(out.Data.Metadata),
	}
	if v.Reference == "" {
		v.Reference = ref
	}
	if v.Status != payments.StatusSuccess {
		v.FailureReason = firstNonEmpty(out.Data.GatewayResponse, out.Data.Message)
	}
	return v, nil
}

// do performs a request and unwraps Paystack's envelope.
func (g *Gateway) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("paystack: encode request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, g.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("paystack: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+g.secretKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := g.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", payments.ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// Cap the read: a provider that starts streaming gigabytes must not take
	// the service down with it.
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return fmt.Errorf("%w: reading response: %v", payments.ErrUnavailable, err)
	}

	var envelope struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
	}
	// A non-JSON body means a proxy or outage page, not a Paystack answer.
	if jsonErr := json.Unmarshal(raw, &envelope); jsonErr != nil {
		if resp.StatusCode >= 500 {
			return fmt.Errorf("%w: HTTP %d", payments.ErrUnavailable, resp.StatusCode)
		}
		return fmt.Errorf("%w: HTTP %d with a non-JSON body", payments.ErrProvider, resp.StatusCode)
	}

	if resp.StatusCode >= 500 {
		return fmt.Errorf("%w: HTTP %d: %s", payments.ErrUnavailable, resp.StatusCode, envelope.Message)
	}
	if !envelope.Status || resp.StatusCode >= 400 {
		return classifyError(resp.StatusCode, envelope.Message)
	}

	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("%w: decoding response: %v", payments.ErrProvider, err)
		}
	}
	return nil
}

// classifyError turns Paystack's message into an error the caller can branch
// on. Duplicate references matter most: a retried initialise is a success for
// idempotency, not a failure to surface to the giver.
func classifyError(statusCode int, message string) error {
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "duplicate transaction reference"),
		strings.Contains(lower, "reference") && strings.Contains(lower, "already"):
		return fmt.Errorf("%w: %s", payments.ErrDuplicateReference, message)
	case statusCode == http.StatusNotFound,
		strings.Contains(lower, "transaction not found"):
		return fmt.Errorf("%w: %s", payments.ErrNotFound, message)
	case statusCode == http.StatusUnauthorized:
		return fmt.Errorf("%w: credentials rejected: %s", payments.ErrNotConfigured, message)
	default:
		if message == "" {
			message = "HTTP " + strconv.Itoa(statusCode)
		}
		return fmt.Errorf("%w: %s", payments.ErrProvider, message)
	}
}

// ParseWebhook authenticates and decodes an inbound webhook.
//
// Paystack signs the raw body with HMAC-SHA512 keyed by the secret key, hex
// encoded, in the x-paystack-signature header. Note SHA-512, not the SHA-256
// most providers use. The comparison is constant time, and the signature is
// computed over the exact bytes received — re-serialising the parsed JSON
// first would produce a different digest for semantically identical input.
func (g *Gateway) ParseWebhook(signature string, body []byte) (*payments.Event, error) {
	if g.webhookKey == "" {
		return nil, fmt.Errorf("%w: no webhook signing key", payments.ErrNotConfigured)
	}
	sig := strings.TrimSpace(signature)
	if sig == "" {
		return nil, fmt.Errorf("%w: no signature header", payments.ErrInvalidSignature)
	}

	mac := hmac.New(sha512.New, []byte(g.webhookKey))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))

	// hmac.Equal is constant time; comparing lowercased hex keeps that
	// property while tolerating case differences in the header.
	if !hmac.Equal([]byte(strings.ToLower(sig)), []byte(expected)) {
		return nil, payments.ErrInvalidSignature
	}

	var payload struct {
		Event string `json:"event"`
		Data  struct {
			ID        json.Number     `json:"id"`
			Reference string          `json:"reference"`
			Status    string          `json:"status"`
			Amount    int64           `json:"amount"`
			Currency  string          `json:"currency"`
			Metadata  json.RawMessage `json:"metadata"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		// The signature proved the sender; a body we cannot read is a contract
		// change, which is worth surfacing as a provider error rather than
		// silently dropping a real payment event.
		return nil, fmt.Errorf("%w: webhook body: %v", payments.ErrProvider, err)
	}
	if payload.Event == "" {
		return nil, fmt.Errorf("%w: webhook has no event type", payments.ErrProvider)
	}

	currency := payload.Data.Currency
	if currency == "" {
		currency = "GHS"
	}

	// Dedupe key: Paystack's transaction id when present, else the reference.
	// The same event can be delivered more than once, so consumers must dedupe
	// on this before granting value.
	id := payload.Data.ID.String()
	if id == "" || id == "0" {
		id = payload.Data.Reference
	}

	return &payments.Event{
		ID:        payload.Event + ":" + id,
		Type:      payload.Event,
		Reference: payload.Data.Reference,
		Status:    normalizeStatus(payload.Data.Status),
		Amount:    money.Amount{Minor: payload.Data.Amount, Currency: currency},
		Meta:      decodeMetadata(payload.Data.Metadata),
	}, nil
}

func normalizeStatus(s string) payments.Status {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "success":
		return payments.StatusSuccess
	case "failed", "abandoned":
		return payments.StatusFailed
	case "reversed", "refunded":
		return payments.StatusReversed
	default:
		return payments.StatusPending
	}
}

func normalizeChannel(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "mobile_money":
		return money.ChannelMobileMoney
	case "card":
		return money.ChannelCard
	case "bank", "bank_transfer", "dedicated_nuban":
		return money.ChannelBankTransfer
	case "ussd":
		return money.ChannelUSSD
	default:
		return s
	}
}

// paystackChannels maps our channel to Paystack's allowlist. Restricting the
// channel matters for MoMo-first giving: offering a card form to someone who
// came to pay by mobile money is the drop-off (§2.3).
func paystackChannels(channel string) []string {
	switch channel {
	case money.ChannelMobileMoney:
		return []string{"mobile_money"}
	case money.ChannelCard:
		return []string{"card"}
	case money.ChannelBankTransfer:
		return []string{"bank", "bank_transfer"}
	case money.ChannelUSSD:
		return []string{"ussd"}
	default:
		return nil
	}
}

// bpsToPercent converts basis points to the percentage Paystack expects.
func bpsToPercent(bps int64) float64 { return float64(bps) / 100 }

// percentToBPS converts back, rounding to the nearest basis point.
func percentToBPS(pct float64) int64 {
	scaled := pct * 100
	if scaled < 0 {
		return int64(scaled - 0.5)
	}
	return int64(scaled + 0.5)
}

// decodeMetadata reads Paystack's metadata, which is sometimes a JSON object
// and sometimes a JSON-encoded string containing one.
func decodeMetadata(raw json.RawMessage) map[string]string {
	if len(raw) == 0 {
		return nil
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		raw = json.RawMessage(asString)
	}

	var generic map[string]any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return nil
	}

	out := make(map[string]string, len(generic))
	for k, v := range generic {
		switch typed := v.(type) {
		case string:
			out[k] = typed
		case float64:
			out[k] = strconv.FormatFloat(typed, 'f', -1, 64)
		case bool:
			out[k] = strconv.FormatBool(typed)
		case nil:
			// omit
		default:
			if encoded, err := json.Marshal(typed); err == nil {
				out[k] = string(encoded)
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// urlEscape escapes a path segment. References are caller-controlled, so a
// reference containing a slash must not be able to reach another endpoint.
func urlEscape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteString(strings.ToUpper(hex.EncodeToString([]byte{c})))
	}
	return b.String()
}

// SignPayload produces the header value Paystack would send for a body. It
// exists so tests and local webhook replays can sign realistically rather than
// disabling verification.
func SignPayload(key string, body []byte) string {
	mac := hmac.New(sha512.New, []byte(key))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// ErrIsRetryable reports whether an error is worth retrying. Provider
// rejections are not; unavailability is.
func ErrIsRetryable(err error) bool {
	return errors.Is(err, payments.ErrUnavailable)
}
