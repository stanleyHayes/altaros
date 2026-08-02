// Package consent records what each member has agreed to, per purpose (WP-06).
//
// Church membership data reveals religious belief, which is special-category
// personal data under Ghana's Act 843, Nigeria's NDPA and Kenya's DPA alike.
// Ghana's Data Protection Commission moved from awareness to enforcement in
// 2026, with exposure up to GHS 3 million or 5% of turnover. Consent therefore
// has to be a first-class, queryable record with history — not a boolean on
// the member document that the last write silently overwrites.
//
// Design notes:
//
//   - Consent is per-purpose and independently revocable. Revoking marketing
//     messages must not revoke the ability to record someone's giving.
//   - Records are append-only. A revoke does not delete the prior grant; it
//     supersedes it. "Prove this member consented on that date" is a question
//     the regulator can ask, and deletion would make it unanswerable.
//   - Communications and AI processing require an explicit opt-in: absence of
//     a record means NOT granted. Failing closed is the only safe default when
//     the downside is an unlawful broadcast.
package consent

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Collection holding consent records.
const Collection = "consents"

// Purpose is a distinct reason for processing personal data. Consent to one
// purpose never implies consent to another.
type Purpose string

const (
	// PurposeMembership covers holding the member record itself. Necessary to
	// provide the service a church signed up for.
	PurposeMembership Purpose = "membership"
	// PurposeGiving covers recording contributions. Necessary to perform the
	// giving the member initiated, and retained for financial record-keeping.
	PurposeGiving Purpose = "giving"
	// PurposeCommunications covers SMS, email, WhatsApp and push messaging.
	// Requires explicit opt-in.
	PurposeCommunications Purpose = "communications"
	// PurposeAIProcessing covers sending member data to an AI model for
	// insights. Requires explicit opt-in, and never includes prayer requests
	// or welfare cases regardless of consent.
	PurposeAIProcessing Purpose = "ai_processing"
)

// AllPurposes is the full set, for building consent UIs and export bundles.
var AllPurposes = []Purpose{
	PurposeMembership, PurposeGiving, PurposeCommunications, PurposeAIProcessing,
}

// requiresExplicitOptIn reports whether absence of a record means "not
// granted".
//
// Membership and giving are necessary to deliver the service the member asked
// for, so they are not gated on a separate opt-in. Communications and AI
// processing are not necessary, so they fail closed.
//
// NOTE: this is a legal determination as much as a technical one. Confirm it
// with counsel before launch (§10 of agent_plan.md).
func (p Purpose) requiresExplicitOptIn() bool {
	switch p {
	case PurposeCommunications, PurposeAIProcessing:
		return true
	default:
		return false
	}
}

// Valid reports whether the purpose is one this system knows about. An
// unrecognised purpose must never be treated as granted.
func (p Purpose) Valid() bool {
	for _, known := range AllPurposes {
		if p == known {
			return true
		}
	}
	return false
}

// ErrUnknownPurpose is returned when a caller supplies a purpose that is not
// part of the consent vocabulary.
var ErrUnknownPurpose = errors.New("consent: unknown purpose")

// Source records how consent was captured, which is what makes a grant
// defensible when a member disputes it.
type Source string

const (
	SourceSignup     Source = "signup"
	SourceMemberApp  Source = "member_app"
	SourceAdminEntry Source = "admin_entry"
	SourceImport     Source = "import"
	SourceWithdrawal Source = "withdrawal"
)

// Record is one consent decision. Records are append-only; the current state
// for a (member, purpose) is the most recent record.
type Record struct {
	ID bson.ObjectID `bson:"_id,omitempty"       json:"id"`
	// mongodb.ID, not string. TenantCollection stamps churchId as a BSON
	// ObjectId so that documents stay readable by the legacy Mongoose schema
	// (ADR-005), and a plain string field cannot decode one — the driver
	// refuses with "decoding an object ID into a string is not supported".
	//
	// That failure was invisible for months because the only caller that reads
	// a Record is the consent check, and the only messages that reach it are
	// announcements and pastoral notes. Transactional messages — receipts, OTPs
	// — skip the consent check by design, so every path anybody had exercised
	// worked, and the first broadcast would have failed for the whole
	// congregation with an error about BSON decoding.
	ChurchID mongodb.ID `bson:"churchId"            json:"churchId"`
	MemberID string     `bson:"memberId"            json:"memberId"`
	Purpose  Purpose    `bson:"purpose"             json:"purpose"`
	Granted  bool       `bson:"granted"             json:"granted"`
	Source   Source     `bson:"source"              json:"source"`
	// PolicyVersion ties the decision to the wording the member actually saw.
	// Without it, "they consented" is unprovable once the policy changes.
	PolicyVersion string    `bson:"policyVersion"       json:"policyVersion"`
	RecordedBy    string    `bson:"recordedBy,omitempty" json:"recordedBy,omitempty"`
	CreatedAt     time.Time `bson:"createdAt"           json:"createdAt"`
	UpdatedAt     time.Time `bson:"updatedAt"           json:"updatedAt"`
}

// Publisher emits domain events. Consent changes must reach the comms
// service's suppression list promptly, so revocation takes effect.
type Publisher interface {
	Publish(ctx context.Context, topic string, key string, payload any) error
}

// TopicConsentChanged carries grant/revoke transitions.
const TopicConsentChanged = "altar.consent.changed.v1"

// Service reads and writes consent.
type Service struct {
	coll *mongodb.TenantCollection
	pub  Publisher
}

// NewService builds the consent service. pub may be nil in tests.
func NewService(db *mongodb.DB, pub Publisher) *Service {
	return &Service{coll: db.Tenant(Collection), pub: pub}
}

// EnsureIndexes creates the indexes consent queries depend on.
// Per ADR-005 every tenant-scoped compound index leads with churchId.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.coll.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// The hot path: current consent for one member and purpose.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
				{Key: "purpose", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_member_purpose_recent"),
		},
		{
			// Broadcast suppression resolves many members for one purpose.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "purpose", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_purpose_recent"),
		},
	})
	if err != nil {
		return fmt.Errorf("consent: create indexes: %w", err)
	}
	return nil
}

// Grant records consent for a purpose.
func (s *Service) Grant(ctx context.Context, memberID string, p Purpose, src Source, policyVersion, recordedBy string) error {
	return s.record(ctx, memberID, p, true, src, policyVersion, recordedBy)
}

// Revoke withdraws consent for a purpose. The prior grant is retained; this
// supersedes it.
func (s *Service) Revoke(ctx context.Context, memberID string, p Purpose, src Source, recordedBy string) error {
	return s.record(ctx, memberID, p, false, src, "", recordedBy)
}

func (s *Service) record(ctx context.Context, memberID string, p Purpose, granted bool, src Source, policyVersion, recordedBy string) error {
	if !p.Valid() {
		return fmt.Errorf("%w: %q", ErrUnknownPurpose, p)
	}
	if memberID == "" {
		return errors.New("consent: memberId is required")
	}

	doc := bson.M{
		"memberId":      memberID,
		"purpose":       string(p),
		"granted":       granted,
		"source":        string(src),
		"policyVersion": policyVersion,
	}
	if recordedBy != "" {
		doc["recordedBy"] = recordedBy
	}

	// TenantCollection stamps churchId and timestamps.
	if _, err := s.coll.InsertOne(ctx, doc); err != nil {
		return fmt.Errorf("consent: record %s for %s: %w", p, memberID, err)
	}

	if s.pub != nil {
		// churchId is required, not decorative. Without it the bus falls back to
		// the memberID as the partition key AND as the envelope subject — so the
		// topic partitions by member instead of church (losing the per-church
		// ordering §6 exists for), and any consumer that scopes by subject would
		// scope to a MEMBER id treated as a church id.
		churchID, err := tenancy.MustChurchID(ctx)
		if err != nil {
			return err
		}
		// Best-effort: a publish failure must not lose the recorded decision,
		// which is already durable. The consumer reconciles from the store.
		_ = s.pub.Publish(ctx, TopicConsentChanged, churchID, map[string]any{
			"memberId": memberID,
			"churchId": churchID,
			"purpose":  string(p),
			"granted":  granted,
		})
	}
	return nil
}

// IsGranted reports whether a member currently consents to a purpose.
//
// Absence of any record means not-granted for purposes that require explicit
// opt-in, and granted for purposes necessary to deliver the service.
func (s *Service) IsGranted(ctx context.Context, memberID string, p Purpose) (bool, error) {
	if !p.Valid() {
		// Unknown purpose is never granted — failing closed.
		return false, fmt.Errorf("%w: %q", ErrUnknownPurpose, p)
	}

	var latest []Record
	err := s.coll.Find(ctx,
		bson.M{"memberId": memberID, "purpose": string(p)},
		&latest,
		// _id breaks ties: BSON datetimes are millisecond-precision, so a
		// grant and a revoke in the same millisecond would otherwise order
		// non-deterministically and "most recent wins" would be a coin flip.
		options.Find().SetSort(bson.D{
			{Key: "createdAt", Value: -1},
			{Key: "_id", Value: -1},
		}).SetLimit(1),
	)
	if err != nil {
		return false, fmt.Errorf("consent: read %s for %s: %w", p, memberID, err)
	}

	if len(latest) == 0 {
		return !p.requiresExplicitOptIn(), nil
	}
	return latest[0].Granted, nil
}

// FilterAllowed returns the subset of memberIDs that may be processed for a
// purpose. This is what a broadcast calls before sending, so a revocation
// actually suppresses delivery.
//
// It resolves the whole audience in one query rather than N, because a
// per-member round trip on a 5,000-member broadcast is both slow and a good
// way to end up skipping the check "just for this one send".
func (s *Service) FilterAllowed(ctx context.Context, memberIDs []string, p Purpose) ([]string, error) {
	if !p.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrUnknownPurpose, p)
	}
	if len(memberIDs) == 0 {
		return nil, nil
	}

	var records []Record
	err := s.coll.Find(ctx,
		bson.M{"memberId": bson.M{"$in": memberIDs}, "purpose": string(p)},
		&records,
		options.Find().SetSort(bson.D{
			{Key: "createdAt", Value: -1},
			{Key: "_id", Value: -1},
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("consent: filter for %s: %w", p, err)
	}

	// Sorted newest-first, so the first record seen per member is current.
	decision := make(map[string]bool, len(records))
	for _, r := range records {
		if _, seen := decision[r.MemberID]; !seen {
			decision[r.MemberID] = r.Granted
		}
	}

	implied := !p.requiresExplicitOptIn()
	allowed := make([]string, 0, len(memberIDs))
	for _, id := range memberIDs {
		granted, hasRecord := decision[id]
		if (hasRecord && granted) || (!hasRecord && implied) {
			allowed = append(allowed, id)
		}
	}
	return allowed, nil
}

// History returns every consent decision for a member, newest first. This
// backs the data-subject access request (what do you hold, and on what basis).
func (s *Service) History(ctx context.Context, memberID string) ([]Record, error) {
	var records []Record
	err := s.coll.Find(ctx,
		bson.M{"memberId": memberID},
		&records,
		options.Find().SetSort(bson.D{
			{Key: "createdAt", Value: -1},
			{Key: "_id", Value: -1},
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("consent: history for %s: %w", memberID, err)
	}
	return records, nil
}
