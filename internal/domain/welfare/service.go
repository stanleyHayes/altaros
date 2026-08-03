package welfare

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/audit"
	"github.com/hayfordstanley/altar-os/internal/platform/fieldcrypt"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Auditor records who touched what. Satisfied by platform/audit.
type Auditor interface {
	Record(ctx context.Context, action audit.Action, resource audit.ResourceType, resourceID, reason string)
	RecordRead(ctx context.Context, resource audit.ResourceType, resourceID string)
	RecordDenied(ctx context.Context, resource audit.ResourceType, resourceID, reason string)
}

// Service is welfare case management.
type Service struct {
	cases  *mongodb.TenantCollection
	crypto *fieldcrypt.Cipher
	audit  Auditor
	now    func() time.Time
}

// NewService builds the welfare service.
//
// The cipher may be nil, and that is not a silent degradation: every write
// refuses with ErrNotEncrypted. A deployment that has not set a welfare key
// cannot store welfare cases, which is the correct outcome — the alternative is
// a church recording safeguarding disclosures in plaintext while believing they
// are protected.
func NewService(db *mongodb.DB, crypto *fieldcrypt.Cipher, auditor Auditor) *Service {
	return &Service{
		cases:  db.Tenant(Collection),
		crypto: crypto,
		audit:  auditor,
		now:    time.Now,
	}
}

// EnsureIndexes creates what cases are found by.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.cases.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "status", Value: 1},
				{Key: "urgency", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_welfare_queue"),
		},
		{
			// A person's own history, which a case worker needs before
			// deciding on a new request.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "memberId", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_welfare_member"),
		},
	})
	if err != nil {
		return fmt.Errorf("welfare: create indexes: %w", err)
	}
	return nil
}

// Input is a case as submitted.
type Input struct {
	MemberID    string
	Category    Category
	Urgency     Urgency
	Summary     string
	Detail      string
	AmountMinor int64
	Currency    string
	AssignedTo  string
	IsAnonymous bool
}

func (in Input) normalise() (Input, error) {
	out := in
	out.MemberID = strings.TrimSpace(in.MemberID)
	out.Summary = strings.TrimSpace(in.Summary)
	out.Detail = strings.TrimSpace(in.Detail)
	out.AssignedTo = strings.TrimSpace(in.AssignedTo)

	if out.MemberID == "" {
		return out, ErrMemberRequired
	}
	if out.Summary == "" {
		return out, ErrSummaryRequired
	}
	if out.Category == "" {
		out.Category = CategoryOther
	}
	if !out.Category.Valid() {
		return out, fmt.Errorf("%w: %q", ErrCategoryInvalid, out.Category)
	}
	if out.Urgency == "" {
		out.Urgency = UrgencyRoutine
	}
	if !out.Urgency.Valid() {
		return out, fmt.Errorf("welfare: %q is not a recognised urgency", out.Urgency)
	}
	// A safeguarding case is never routine. Somebody filing one in a hurry
	// should not be able to leave it at the bottom of a queue by accepting a
	// default, and this is the one place the product overrides what was typed.
	if out.Category.Safeguarding() && out.Urgency == UrgencyRoutine {
		out.Urgency = UrgencyElevated
	}
	if out.AmountMinor > 0 && out.Currency == "" {
		out.Currency = "GHS"
	}
	return out, nil
}

// Open records a new case.
func (s *Service) Open(ctx context.Context, in Input) (*Case, error) {
	clean, err := in.normalise()
	if err != nil {
		return nil, err
	}
	if s.crypto == nil {
		// Refusing rather than storing plaintext. A church recording a
		// safeguarding disclosure in the clear while believing it is protected
		// is the worst outcome available here.
		return nil, ErrNotEncrypted
	}

	summary, err := s.crypto.Encrypt(clean.Summary)
	if err != nil {
		return nil, fmt.Errorf("welfare: encrypt summary: %w", err)
	}
	detail, err := s.crypto.Encrypt(clean.Detail)
	if err != nil {
		return nil, fmt.Errorf("welfare: encrypt detail: %w", err)
	}

	scope, _ := tenancy.FromContext(ctx)
	now := s.now().UTC()
	doc := bson.M{
		"memberId":    clean.MemberID,
		"category":    string(clean.Category),
		"urgency":     string(clean.Urgency),
		"status":      string(StatusOpen),
		"isAnonymous": clean.IsAnonymous,
		"summary":     summary,
		"createdAt":   now,
		"updatedAt":   now,
	}
	if detail != "" {
		doc["detail"] = detail
	}
	if clean.AssignedTo != "" {
		doc["assignedTo"] = clean.AssignedTo
	}
	if clean.AmountMinor > 0 {
		doc["amountMinor"] = clean.AmountMinor
		doc["currency"] = clean.Currency
	}
	if scope.UserID != "" {
		doc["raisedBy"] = mongodb.ID(scope.UserID)
	}

	res, err := s.cases.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("welfare: open case: %w", err)
	}
	id := res.InsertedID.(bson.ObjectID)

	s.audit.Record(ctx, audit.ActionCreate, audit.ResourceWelfare, id.Hex(),
		"welfare case opened")
	return s.read(ctx, id)
}

// Mine returns the signed-in member's own requests, including the narrative
// they submitted but never pastoral notes. The HTTP layer derives memberID
// from the authenticated user; accepting it from a query or request body would
// turn this into a cross-member disclosure.
func (s *Service) Mine(ctx context.Context, memberID string, limit int64) ([]Case, error) {
	return s.MinePage(ctx, memberID, limit, 0)
}

// MinePage returns one private, notes-free page of the member's own requests.
func (s *Service) MinePage(ctx context.Context, memberID string, limit, offset int64) ([]Case, error) {
	memberID = strings.TrimSpace(memberID)
	if memberID == "" {
		return nil, ErrMemberRequired
	}
	if limit < 1 || limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	var cases []Case
	err := s.cases.Find(ctx, bson.M{"memberId": memberID}, &cases,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}, {Key: "_id", Value: -1}}).SetLimit(limit).SetSkip(offset).
			SetProjection(bson.M{"notes": 0}))
	if err != nil {
		return nil, fmt.Errorf("welfare: list member requests: %w", err)
	}
	for i := range cases {
		if err := s.decrypt(&cases[i]); err != nil {
			return nil, err
		}
		s.audit.RecordRead(ctx, audit.ResourceWelfare, cases[i].ID.Hex())
	}
	return cases, nil
}

// MineCount returns the authoritative size of the member's tenant-scoped history.
func (s *Service) MineCount(ctx context.Context, memberID string) (int64, error) {
	memberID = strings.TrimSpace(memberID)
	if memberID == "" {
		return 0, ErrMemberRequired
	}
	total, err := s.cases.CountDocuments(ctx, bson.M{"memberId": memberID})
	if err != nil {
		return 0, fmt.Errorf("welfare: count member requests: %w", err)
	}
	return total, nil
}

// ByID returns one case, decrypted.
//
// Every call is AUDITED as a read, because §3.4(3) requires it and because the
// audit trail is the only after-the-fact answer to "who looked at this". The
// permission check happens above this, in the HTTP layer — but a denial is
// recorded there too, and the two together are what make the trail complete.
func (s *Service) ByID(ctx context.Context, id string) (*Case, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrNotFound
	}
	found, err := s.read(ctx, oid)
	if err != nil {
		return nil, err
	}
	s.audit.RecordRead(ctx, audit.ResourceWelfare, id)
	return found, nil
}

// read fetches and decrypts without auditing. Internal only — every exported
// path that returns case CONTENTS records a read.
func (s *Service) read(ctx context.Context, oid bson.ObjectID) (*Case, error) {
	var found Case
	err := s.cases.FindOne(ctx, bson.M{"_id": oid}, &found)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("welfare: read case: %w", err)
	}
	if err := s.decrypt(&found); err != nil {
		return nil, err
	}
	return &found, nil
}

func (s *Service) decrypt(c *Case) error {
	if s.crypto == nil {
		return ErrNotEncrypted
	}
	var err error
	if c.Summary, err = s.crypto.Decrypt(c.Summary); err != nil {
		return fmt.Errorf("welfare: decrypt summary: %w", err)
	}
	if c.Detail, err = s.crypto.Decrypt(c.Detail); err != nil {
		return fmt.Errorf("welfare: decrypt detail: %w", err)
	}
	for i := range c.Notes {
		if c.Notes[i].Body, err = s.crypto.Decrypt(c.Notes[i].Body); err != nil {
			return fmt.Errorf("welfare: decrypt note: %w", err)
		}
	}
	return nil
}

// Queue lists cases WITHOUT their contents.
//
// A church needs to see it has eleven open cases, three urgent, without putting
// eleven people's circumstances on a screen somebody walks past. Opening one is
// a separate act with its own audit entry — which is also what makes the trail
// meaningful, since a listing that returned everything would make every read
// look identical.
func (s *Service) Queue(ctx context.Context, status Status, openOnly bool) ([]CaseSummary, error) {
	filter := bson.M{}
	switch {
	case status != "":
		if !status.Valid() {
			return nil, fmt.Errorf("%w: %q", ErrStatusInvalid, status)
		}
		filter["status"] = string(status)
	case openOnly:
		open := []string{}
		for _, s := range AllStatuses {
			if s.Open() {
				open = append(open, string(s))
			}
		}
		filter["status"] = bson.M{"$in": open}
	}

	var cases []Case
	err := s.cases.Find(ctx, filter, &cases,
		options.Find().
			SetSort(bson.D{{Key: "urgency", Value: 1}, {Key: "createdAt", Value: -1}}).
			SetLimit(200).
			// The encrypted fields are not even fetched. A listing has no use
			// for them, and not loading them means a bug in this function
			// cannot leak them.
			SetProjection(bson.M{"summary": 0, "detail": 0, "notes.body": 0}))
	if err != nil {
		return nil, fmt.Errorf("welfare: list queue: %w", err)
	}

	out := make([]CaseSummary, 0, len(cases))
	for i := range cases {
		out = append(out, cases[i].Summarise())
	}
	return out, nil
}

// AddNote appends to a case's running record.
func (s *Service) AddNote(ctx context.Context, id, body string) (*Case, error) {
	if s.crypto == nil {
		return nil, ErrNotEncrypted
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, ErrSummaryRequired
	}
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrNotFound
	}

	sealed, err := s.crypto.Encrypt(body)
	if err != nil {
		return nil, fmt.Errorf("welfare: encrypt note: %w", err)
	}
	scope, _ := tenancy.FromContext(ctx)

	res, err := s.cases.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{
		"$push": bson.M{"notes": bson.M{
			"body": sealed, "authorId": mongodb.ID(scope.UserID), "at": s.now().UTC(),
		}},
	})
	if err != nil {
		return nil, fmt.Errorf("welfare: add note: %w", err)
	}
	if res.MatchedCount == 0 {
		return nil, ErrNotFound
	}

	s.audit.Record(ctx, audit.ActionUpdate, audit.ResourceWelfare, id, "note added")
	return s.read(ctx, oid)
}

// SetStatus moves a case along.
func (s *Service) SetStatus(ctx context.Context, id string, to Status) (*Case, error) {
	if !to.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrStatusInvalid, to)
	}
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrNotFound
	}

	set := bson.M{"status": string(to)}
	if to == StatusResolved || to == StatusClosed {
		set["resolvedAt"] = s.now().UTC()
	}
	res, err := s.cases.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": set})
	if err != nil {
		return nil, fmt.Errorf("welfare: set status: %w", err)
	}
	if res.MatchedCount == 0 {
		return nil, ErrNotFound
	}

	s.audit.Record(ctx, audit.ActionUpdate, audit.ResourceWelfare, id,
		"status set to "+string(to))
	return s.read(ctx, oid)
}

// Assign hands a case to a case worker.
func (s *Service) Assign(ctx context.Context, id, memberID string) (*Case, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrNotFound
	}
	memberID = strings.TrimSpace(memberID)

	update := bson.M{"$set": bson.M{"assignedTo": memberID, "status": string(StatusInProgress)}}
	if memberID == "" {
		update = bson.M{"$unset": bson.M{"assignedTo": ""}}
	}
	res, err := s.cases.UpdateOne(ctx, bson.M{"_id": oid}, update)
	if err != nil {
		return nil, fmt.Errorf("welfare: assign: %w", err)
	}
	if res.MatchedCount == 0 {
		return nil, ErrNotFound
	}

	s.audit.Record(ctx, audit.ActionUpdate, audit.ResourceWelfare, id,
		"assigned to "+memberID)
	return s.read(ctx, oid)
}

// Denied records a refused attempt to reach a case.
//
// Called by the HTTP layer when the ACL refuses. It is the entry that matters
// most in this package's audit trail: a church's after-the-fact answer to
// "did anybody go looking at this" is only as good as its record of the people
// who tried and could not.
func (s *Service) Denied(ctx context.Context, id, reason string) {
	s.audit.RecordDenied(ctx, audit.ResourceWelfare, id, reason)
}
