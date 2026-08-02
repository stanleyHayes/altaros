package finance

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/payments"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Publisher emits domain events.
type Publisher interface {
	Publish(ctx context.Context, topic, key string, payload any) error
}

// Event topics.
const (
	TopicGivingCompleted = "altar.giving.completed.v1"
	TopicGivingFailed    = "altar.giving.failed.v1"
)

// ChurchPayout is what finance needs to know about a church to charge on its
// behalf. It is an interface rather than a dependency on the church service so
// the two stay separable under ADR-004.
type ChurchPayout struct {
	SubaccountCode string
	Currency       string
	// CommissionBasisPoints is the platform's cut for this church. Per-church
	// so a launch-partner denomination can be given different terms without a
	// code change. Resolved by the directory from the platform rate and any
	// per-church override (Q-7).
	CommissionBasisPoints int64
	Name                  string
	// FeeBearer is who absorbs the payment provider's fee — the giver or the
	// church (Q-4). Already resolved against the platform default, so finance
	// never has to know there was one.
	FeeBearer money.FeeBearer
}

// ChurchDirectory resolves the payout configuration of a church.
type ChurchDirectory interface {
	PayoutFor(ctx context.Context, churchID string) (*ChurchPayout, error)
	// FeeScheduleFor is separate from PayoutFor because the rate card depends
	// on the CHANNEL, and PayoutFor is also called on the settlement path
	// where no channel choice is being made.
	FeeScheduleFor(ctx context.Context, channel string) (money.FeeSchedule, error)
}

// Service is the giving and ledger domain.
type Service struct {
	coll      *mongodb.TenantCollection
	campaigns *mongodb.TenantCollection
	global    *mongo.Collection
	gateway   payments.Gateway
	pub       Publisher
	dir       ChurchDirectory
	now       func() time.Time
}

// NewService builds the finance service.
func NewService(db *mongodb.DB, gw payments.Gateway, dir ChurchDirectory, pub Publisher) *Service {
	return &Service{
		coll:      db.Tenant(Collection),
		campaigns: db.Tenant(CampaignCollection),
		// A webhook arrives from the provider with no session and therefore no
		// tenant, so the transaction it refers to has to be found before the
		// church is known. This is the one place finance reads across tenants,
		// it is used only to resolve a reference into its church, and every
		// subsequent operation runs inside that church's scope.
		global:  db.Global(Collection),
		gateway: gw,
		dir:     dir,
		pub:     pub,
		now:     time.Now,
	}
}

// EnsureIndexes creates the constraints the ledger depends on.
//
// The two unique indexes are not optimisations. They are what makes a retried
// payment safe: without them, two concurrent deliveries of the same webhook
// both see no existing row and both insert one.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.coll.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// §5.2 uq_idempotency. Deliberately NOT scoped by church: an
			// idempotency key is globally unique, and scoping it per church
			// would let a key collide across churches and silently record a
			// second gift.
			Keys:    bson.D{{Key: "idempotencyKey", Value: 1}},
			Options: options.Index().SetName("uq_idempotency").SetUnique(true),
		},
		{
			// §5.2 uq_provider_ref.
			Keys: bson.D{
				{Key: "provider", Value: 1},
				{Key: "providerRef", Value: 1},
			},
			Options: options.Index().
				SetName("uq_provider_ref").
				SetUnique(true).
				// Partial, not sparse: cash transactions have neither field,
				// and a compound sparse index would index them all as null and
				// let the second cash offering collide with the first.
				SetPartialFilterExpression(bson.M{
					"provider":    bson.M{"$exists": true},
					"providerRef": bson.M{"$exists": true},
				}),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "occurredAt", Value: -1},
			},
			Options: options.Index().SetName("church_occurred"),
		},
		{
			// The analytics covering index (WP-25).
			//
			// COVERING: every field the giving aggregations touch is in the
			// key, so a trend or a consolidation is answered from the index
			// without fetching a single document. Measured on 100k
			// transactions across five branches: 66ms without it, 25ms with.
			//
			// That measurement is why this codebase does NOT carry the
			// materialised rollups the plan called for. A rollup is a second
			// copy of the truth about money, and it is the right answer only
			// once an index cannot do the job — see the analytics package
			// comment.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "status", Value: 1},
				{Key: "direction", Value: 1},
				{Key: "occurredAt", Value: -1},
				{Key: "grossMinor", Value: 1},
			},
			Options: options.Index().SetName("church_giving_covering"),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "type", Value: 1},
				{Key: "status", Value: 1},
			},
			Options: options.Index().SetName("church_type_status"),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
				{Key: "occurredAt", Value: -1},
			},
			Options: options.Index().SetName("church_member_occurred"),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "initiatedBy", Value: 1},
				{Key: "occurredAt", Value: -1},
			},
			Options: options.Index().SetName("church_initiator_occurred"),
		},
	})
	if err != nil {
		return fmt.Errorf("finance: create indexes: %w", err)
	}
	return nil
}

// GiveRequest is a member's intent to give.
type GiveRequest struct {
	// MemberID is optional. Anonymous giving must stay possible.
	MemberID string
	// InitiatorID is the authenticated account starting the checkout. It stays
	// private even when MemberID is omitted for an anonymous church record.
	InitiatorID string
	Type        Type
	Amount      money.Amount
	Channel     string
	// Email receives the provider's receipt.
	Email string
	// PriorTodayMinor is what this giver has already transferred today, used
	// to quote the E-Levy against its cumulative daily threshold.
	PriorTodayMinor int64
	CampaignID      string
	Note            string
	CallbackURL     string
}

// GiveResult is what the giver needs to complete the payment.
type GiveResult struct {
	Transaction *Transaction `json:"transaction"`
	// AuthorizationURL is where the giver authorises the debit.
	AuthorizationURL string `json:"authorizationUrl,omitempty"`
	AccessCode       string `json:"accessCode,omitempty"`
	// Quote is the full pricing shown before confirmation — gift, provider
	// fee, levy and the single total the giver is debited. They must see this
	// before authorising: a flow that debits more than it displayed destroys
	// trust faster than any bug (§2.3), and with the giver bearing the provider
	// fee (Q-4's default) the amount charged is BY DEFINITION not the amount
	// typed.
	Quote money.GivingQuote `json:"quote"`
	// Levy is kept alongside Quote for the clients that already read it.
	Levy money.LevyQuote `json:"levy"`
}

// StartGiving records a pending transaction and initialises the charge.
//
// The transaction is written BEFORE the provider is called. If the provider
// call then fails we have an orphaned pending row, which is recoverable and
// visible. The other order loses the record of a charge that may already have
// been created, which is money moving with nothing to reconcile it against.
func (s *Service) StartGiving(ctx context.Context, req GiveRequest) (*GiveResult, error) {
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}
	if !req.Type.Valid() || req.Type == TypeExpense {
		return nil, fmt.Errorf("%w: %q", ErrInvalidType, req.Type)
	}
	if !money.ValidChannel(req.Channel) {
		return nil, fmt.Errorf("%w: %q", ErrInvalidChannel, req.Channel)
	}
	if req.Channel == money.ChannelCash {
		return nil, fmt.Errorf("%w: cash is recorded with RecordCash, not charged", ErrInvalidChannel)
	}
	if req.Amount.Minor <= 0 {
		return nil, ErrAmountRequired
	}

	payout, err := s.dir.PayoutFor(ctx, churchID)
	if err != nil {
		return nil, fmt.Errorf("finance: resolve church payout: %w", err)
	}
	if payout == nil || strings.TrimSpace(payout.SubaccountCode) == "" {
		// ADR-002: without a subaccount the money would settle to ALTAR OS.
		// Refusing the gift is the correct outcome; taking custody is not.
		return nil, ErrNoSubaccount
	}
	if payout.Currency != "" && payout.Currency != req.Amount.Currency {
		return nil, fmt.Errorf("%w: church settles in %s but the gift is in %s",
			money.ErrCurrencyMismatch, payout.Currency, req.Amount.Currency)
	}

	schedule, err := s.dir.FeeScheduleFor(ctx, req.Channel)
	if err != nil {
		return nil, fmt.Errorf("finance: resolve provider fee: %w", err)
	}
	quote := money.QuoteGiving(req.Amount, req.Channel, req.PriorTodayMinor,
		schedule, payout.FeeBearer)
	levy := quote.Levy

	// The platform's commission is taken on the GIFT, never on the total.
	//
	// Charging it on gift+fee would mean the platform earns a cut of the
	// payment processor's fee, which is not a service the platform performed
	// and is not what a church agreed a commission rate on.
	platformFee := req.Amount.PercentBasisPoints(payout.CommissionBasisPoints)

	key, err := newIdempotencyKey()
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	doc := bson.M{
		"type":       string(req.Type),
		"direction":  string(DirectionIncome),
		"channel":    req.Channel,
		"grossMinor": req.Amount.Minor,
		"levyMinor":  levy.Levy.Minor,
		// The ESTIMATE, replaced by the provider's actual figure on settlement.
		// Recorded rather than left zero because with the giver bearing it this
		// is money the giver was actually charged, and a pending row showing a
		// zero fee misstates what left their account.
		"providerFeeMinor": quote.Fee.ProviderFee.Minor,
		"platformFeeMinor": platformFee.Minor,
		// What the giver is debited, which differs from the gift whenever they
		// bear the fee. Stored so a support question about a bank statement can
		// be answered from the record rather than by re-deriving a rate card
		// that has since changed.
		"chargedMinor": quote.Fee.Charged.Minor,
		"feeBearer":    string(quote.Fee.Bearer),
		// Net is provisional until the provider reports its actual fee.
		// Recording the optimistic figure now and correcting it on settlement
		// is better than leaving it zero, which would read as "this gift was
		// worth nothing" on any report run against pending rows.
		"netMinor":       req.Amount.Minor - platformFee.Minor,
		"currency":       req.Amount.Currency,
		"status":         string(StatusPending),
		"provider":       s.gateway.Name(),
		"idempotencyKey": key,
		// reference mirrors idempotencyKey because the legacy Mongoose schema
		// declares `reference` unique and required on this same collection
		// (ADR-005: both writers share one database during the migration). A
		// Go document that omitted it would be indexed as null, and the second
		// such insert would collide with the first — every transaction after
		// the first failing as a duplicate.
		"reference":  key,
		"occurredAt": now,
		"createdAt":  now,
		"updatedAt":  now,
	}
	if req.MemberID != "" {
		doc["memberId"] = req.MemberID
	}
	if req.InitiatorID != "" {
		doc["initiatedBy"] = req.InitiatorID
	}
	if req.CampaignID != "" {
		doc["campaignId"] = req.CampaignID
	}
	if req.Note != "" {
		doc["note"] = strings.TrimSpace(req.Note)
	}

	res, err := s.coll.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrDuplicate
		}
		return nil, fmt.Errorf("finance: record pending transaction: %w", err)
	}
	txID := res.InsertedID.(bson.ObjectID)

	charge, err := s.gateway.Initialize(ctx, payments.ChargeRequest{
		// The idempotency key is the provider reference. One string means the
		// webhook can be matched without a second lookup table, and a retried
		// initialise is rejected by the provider rather than charging twice.
		Reference: key,
		// The CHARGED amount, not the gift. When the giver bears the provider
		// fee (Q-4's default) these differ, and charging the gift would leave
		// the church short by the fee on every single transaction — silently,
		// because every other number in the flow would still look right.
		Amount:         quote.Fee.Charged,
		SubaccountCode: payout.SubaccountCode,
		PlatformFee:    platformFee,
		Channel:        req.Channel,
		Email:          req.Email,
		CallbackURL:    req.CallbackURL,
		Metadata: map[string]string{
			"churchId":      churchID,
			"memberId":      req.MemberID,
			"transactionId": txID.Hex(),
			"type":          string(req.Type),
		},
	})
	if err != nil {
		// Mark the row failed so it is not left pending forever, but return
		// the provider's error: the giver needs to know the charge did not
		// start.
		s.markFailedBestEffort(ctx, txID, err.Error())
		return nil, fmt.Errorf("finance: initialise charge: %w", err)
	}

	tx, err := s.ByID(ctx, txID.Hex())
	if err != nil {
		return nil, err
	}
	return &GiveResult{
		Transaction:      tx,
		AuthorizationURL: charge.AuthorizationURL,
		AccessCode:       charge.AccessCode,
		Quote:            quote,
		Levy:             levy,
	}, nil
}

// SettleFromWebhook confirms a payment reported by the provider.
//
// The webhook body is never trusted for granting value. It says a payment
// happened; only Verify says how much, to whom, and whether it succeeded.
// Skipping that step means anyone who can forge a webhook — or replay a real
// one with an edited amount — can write income into a church's books.
//
// This runs without a tenant in context because the provider has no session.
// The reference is resolved to its church first, and everything after that
// happens inside that church's scope.
func (s *Service) SettleFromWebhook(ctx context.Context, event *payments.Event) (*Transaction, error) {
	if event == nil || strings.TrimSpace(event.Reference) == "" {
		return nil, fmt.Errorf("%w: webhook carries no reference", ErrNotFound)
	}

	var stored Transaction
	err := s.global.FindOne(ctx, bson.M{"idempotencyKey": event.Reference}).Decode(&stored)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("finance: resolve webhook reference: %w", err)
	}

	// Replays are the normal case, not the exception — providers retry until
	// they see a 200, and the same event arrives more than once. A settled
	// transaction is returned unchanged so the endpoint can answer 200 without
	// recording anything twice.
	if stored.Status.Terminal() {
		return &stored, nil
	}

	churchID := stored.ChurchID.String()
	scoped := tenancy.WithScope(ctx, tenancy.Scope{
		ChurchID: churchID,
		// The provider acted, not a user. Attributing this to a person would
		// put a false actor in the audit trail.
		UserID: "system:payment-webhook",
		Role:   "SYSTEM",
	})

	return s.settle(scoped, &stored)
}

// Settle re-verifies a transaction with the provider and finalises it. It is
// also the callback path, for when the giver returns to the app before the
// webhook arrives.
func (s *Service) Settle(ctx context.Context, reference string) (*Transaction, error) {
	tx, err := s.ByReference(ctx, reference)
	if err != nil {
		return nil, err
	}
	if tx.Status.Terminal() {
		return tx, nil
	}
	return s.settle(ctx, tx)
}

func (s *Service) settle(ctx context.Context, stored *Transaction) (*Transaction, error) {
	v, err := s.gateway.Verify(ctx, stored.IdempotencyKey)
	if err != nil {
		return nil, fmt.Errorf("finance: verify with provider: %w", err)
	}

	if v.Status != payments.StatusSuccess {
		return s.markFailed(ctx, stored, v.FailureReason)
	}

	// The provider says this succeeded. Two checks before it becomes income.
	if v.Amount.Minor != stored.GrossMinor || v.Amount.Currency != stored.Currency {
		// Never reconcile silently to the provider's figure: either our record
		// is wrong or the payment is not the one we think it is, and both need
		// a human rather than a number quietly changing.
		return nil, fmt.Errorf("%w: recorded %s, provider reported %s",
			ErrAmountMismatch, stored.Gross(), v.Amount)
	}

	payout, err := s.dir.PayoutFor(ctx, stored.ChurchID.String())
	if err != nil {
		return nil, fmt.Errorf("finance: resolve church payout: %w", err)
	}
	if payout != nil && payout.SubaccountCode != "" && v.SettledTo != "" &&
		v.SettledTo != payout.SubaccountCode {
		// Money that reached a different merchant is not this church's income,
		// however successful the payment was.
		return nil, fmt.Errorf("%w: settled to %q, church expects %q",
			ErrWrongSettlement, v.SettledTo, payout.SubaccountCode)
	}

	net, err := v.NetToChurch()
	if err != nil {
		return nil, fmt.Errorf("finance: compute net: %w", err)
	}

	now := s.now().UTC()
	update := bson.M{"$set": bson.M{
		"status":           string(StatusSuccess),
		"providerFeeMinor": v.ProviderFee.Minor,
		"platformFeeMinor": v.PlatformFee.Minor,
		"netMinor":         net.Minor,
		"providerRef":      v.ProviderRef,
		"settledTo":        v.SettledTo,
		"settledAt":        now,
		"updatedAt":        now,
	}}
	if v.Channel != "" {
		update["$set"].(bson.M)["channel"] = v.Channel
	}

	// The status guard makes this a compare-and-set: two deliveries racing
	// each other means exactly one performs the transition, and the loser
	// finds a settled row rather than writing a second one.
	result, err := s.coll.UpdateOne(ctx,
		bson.M{"_id": stored.ID, "status": string(StatusPending)}, update)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			// uq_provider_ref rejected it: this provider reference is already
			// on another row, so the payment is recorded and this is a replay.
			return s.ByID(ctx, stored.ID.Hex())
		}
		return nil, fmt.Errorf("finance: settle: %w", err)
	}

	settled, err := s.ByID(ctx, stored.ID.Hex())
	if err != nil {
		return nil, err
	}
	if result.ModifiedCount == 0 {
		// Someone else settled it first. Return their row without emitting a
		// second completion event.
		return settled, nil
	}

	if s.pub != nil {
		_ = s.pub.Publish(ctx, TopicGivingCompleted, settled.ID.Hex(), map[string]any{
			"transactionId": settled.ID.Hex(),
			"churchId":      settled.ChurchID.String(),
			"memberId":      receiptMemberID(settled),
			"type":          string(settled.Type),
			"channel":       settled.Channel,
			"grossMinor":    settled.GrossMinor,
			"levyMinor":     settled.LevyMinor,
			"netMinor":      settled.NetMinor,
			"currency":      settled.Currency,
			"occurredAt":    settled.OccurredAt,
		})
	}
	return settled, nil
}

func (s *Service) markFailed(ctx context.Context, stored *Transaction, reason string) (*Transaction, error) {
	now := s.now().UTC()
	set := bson.M{
		"status":    string(StatusFailed),
		"updatedAt": now,
	}
	if reason != "" {
		set["failureReason"] = reason
	}
	if _, err := s.coll.UpdateOne(ctx,
		bson.M{"_id": stored.ID, "status": string(StatusPending)},
		bson.M{"$set": set}); err != nil {
		return nil, fmt.Errorf("finance: mark failed: %w", err)
	}

	failed, err := s.ByID(ctx, stored.ID.Hex())
	if err != nil {
		return nil, err
	}
	if s.pub != nil {
		_ = s.pub.Publish(ctx, TopicGivingFailed, failed.ID.Hex(), map[string]any{
			"transactionId": failed.ID.Hex(),
			"churchId":      failed.ChurchID.String(),
			"memberId":      receiptMemberID(failed),
			"reason":        reason,
		})
	}
	return failed, nil
}

func receiptMemberID(tx *Transaction) string {
	if tx.InitiatedBy.String() != "" {
		return tx.InitiatedBy.String()
	}
	return tx.MemberID.String()
}

// markFailedBestEffort is used on the initialise path, where the caller is
// already returning the provider's error and a failure to annotate the row
// must not mask it.
func (s *Service) markFailedBestEffort(ctx context.Context, id bson.ObjectID, reason string) {
	_, _ = s.coll.UpdateOne(ctx,
		bson.M{"_id": id, "status": string(StatusPending)},
		bson.M{"$set": bson.M{
			"status":        string(StatusFailed),
			"failureReason": reason,
			"updatedAt":     s.now().UTC(),
		}})
}

// CashRequest records money counted at a service, or an expense paid out.
type CashRequest struct {
	MemberID  string
	Type      Type
	Direction Direction
	Amount    money.Amount
	Note      string
	// OccurredAt is when the money actually moved, which for a Sunday offering
	// entered on Tuesday is Sunday.
	OccurredAt time.Time
}

// RecordCash books a transaction that involved no payment provider.
//
// Cash bypasses the whole settlement path: there is no charge to verify and no
// fee to deduct, so gross equals net. The counter is recorded on the row —
// money counted at a service needs an attributable human (§8.2).
func (s *Service) RecordCash(ctx context.Context, req CashRequest) (*Transaction, error) {
	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}
	if !req.Type.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrInvalidType, req.Type)
	}
	if req.Amount.Minor <= 0 {
		return nil, ErrAmountRequired
	}

	direction := req.Direction
	if direction == "" {
		direction = DirectionIncome
		if req.Type == TypeExpense {
			direction = DirectionExpense
		}
	}
	if direction == DirectionExpense && req.Type != TypeExpense {
		return nil, fmt.Errorf("%w: %q is not an expense type", ErrInvalidType, req.Type)
	}

	occurred := req.OccurredAt
	if occurred.IsZero() {
		occurred = s.now()
	}

	key, err := newIdempotencyKey()
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	doc := bson.M{
		"type":      string(req.Type),
		"direction": string(direction),
		"channel":   money.ChannelCash,
		// No provider, so no fees: gross is net.
		"grossMinor":       req.Amount.Minor,
		"levyMinor":        int64(0),
		"providerFeeMinor": int64(0),
		"platformFeeMinor": int64(0),
		"netMinor":         req.Amount.Minor,
		"currency":         req.Amount.Currency,
		"status":           string(StatusSuccess),
		"idempotencyKey":   key,
		"reference":        key, // see the note in StartGiving
		"recordedBy":       scope.UserID,
		"occurredAt":       occurred.UTC(),
		"settledAt":        now,
		"createdAt":        now,
		"updatedAt":        now,
	}
	if req.MemberID != "" {
		doc["memberId"] = req.MemberID
	}
	if req.Note != "" {
		doc["note"] = strings.TrimSpace(req.Note)
	}

	res, err := s.coll.InsertOne(ctx, doc)
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrDuplicate
		}
		return nil, fmt.Errorf("finance: record cash: %w", err)
	}

	tx, err := s.ByID(ctx, res.InsertedID.(bson.ObjectID).Hex())
	if err != nil {
		return nil, err
	}
	if s.pub != nil && direction == DirectionIncome {
		_ = s.pub.Publish(ctx, TopicGivingCompleted, tx.ID.Hex(), map[string]any{
			"transactionId": tx.ID.Hex(),
			"churchId":      tx.ChurchID.String(),
			"memberId":      tx.MemberID.String(),
			"type":          string(tx.Type),
			"channel":       tx.Channel,
			"grossMinor":    tx.GrossMinor,
			"netMinor":      tx.NetMinor,
			"currency":      tx.Currency,
			"occurredAt":    tx.OccurredAt,
		})
	}
	return tx, nil
}

// ByID returns one transaction within the caller's church.
func (s *Service) ByID(ctx context.Context, id string) (*Transaction, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	var tx Transaction
	err = s.coll.FindOne(ctx, bson.M{"_id": oid}, &tx)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("finance: read transaction: %w", err)
	}
	return &tx, nil
}

// ByReference finds a transaction by its idempotency key, within the caller's
// church.
func (s *Service) ByReference(ctx context.Context, reference string) (*Transaction, error) {
	var tx Transaction
	err := s.coll.FindOne(ctx, bson.M{"idempotencyKey": reference}, &tx)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("finance: read transaction: %w", err)
	}
	return &tx, nil
}

// newIdempotencyKey generates a collision-resistant reference.
//
// Random rather than derived from the request: two members giving the same
// amount to the same church in the same second is ordinary on a Sunday, and a
// derived key would make the second gift a "duplicate" of the first.
func newIdempotencyKey() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("finance: generate reference: %w", err)
	}
	// Base32 without padding: alphanumeric and case-insensitive, which
	// survives being read aloud over the phone to support.
	return "alt_" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)), nil
}
