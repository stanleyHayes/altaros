package privacy

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Service answers and executes data subject requests.
type Service struct {
	db       *mongodb.DB
	receipts *mongodb.TenantCollection
	now      func() time.Time
}

// NewService builds the service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		db:       db,
		receipts: db.Tenant(ReceiptCollection),
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// EnsureIndexes creates what the receipts need.
func (s *Service) EnsureIndexes(ctx context.Context) error { return nil }

// matcher builds the filter that finds one person's rows in a collection.
//
// Both storage forms, always. Under ADR-005 the legacy TypeScript API writes
// memberId as an ObjectId while parts of the Go side write a string, and a
// deletion that matches only one form leaves half the person behind — which is
// the worst possible bug in this file, because it reports success.
func matcher(field, id string) bson.M {
	values := bson.A{id}
	if oid, err := bson.ObjectIDFromHex(id); err == nil {
		values = append(values, oid)
	}
	return bson.M{field: bson.M{"$in": values}}
}

// idFor picks the right identifier for a category.
func idFor(h Holding, memberID, userID string) string {
	if h.Subject == SubjectUser {
		return userID
	}
	return memberID
}

// ExportFor assembles everything held about a person (Act 843 s.32).
func (s *Service) ExportFor(ctx context.Context, memberID, userID string) (*Export, error) {
	memberID = strings.TrimSpace(memberID)
	if memberID == "" {
		return nil, ErrMemberRequired
	}
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}

	out := &Export{
		GeneratedAt: s.now(), Church: churchID,
		About:      map[string]any{},
		Sections:   map[string][]map[string]any{},
		WhatWeHold: Holdings,
	}

	for _, h := range Holdings {
		id := idFor(h, memberID, strings.TrimSpace(userID))
		if id == "" {
			continue
		}
		coll := s.db.Tenant(h.Collection)

		var rows []map[string]any
		if err := coll.Find(ctx, matcher(h.Field, id), &rows); err != nil {
			// A collection that does not exist yet is not an error: it means
			// we hold nothing there, which is a legitimate answer.
			continue
		}
		cleaned := make([]map[string]any, 0, len(rows))
		for _, r := range rows {
			delete(r, "churchId")
			cleaned = append(cleaned, r)
		}
		if h.Collection == "members" && len(cleaned) == 1 {
			out.About = cleaned[0]
			continue
		}
		if len(cleaned) > 0 {
			out.Sections[h.Label] = cleaned
		}
	}
	return out, nil
}

// DeleteRequest is a request to delete an account.
type DeleteRequest struct {
	// MemberID is the member record. Nearly every church record points here.
	MemberID string
	// UserID is the login. Required, and NOT the same identifier — see Subject.
	UserID string
	// Confirmed must be true. The UI has to collect an explicit confirmation
	// after showing what is kept — see Holdings — because "I did not realise
	// my giving history would survive" is exactly the complaint Act 843 s.32
	// exists to prevent.
	Confirmed bool
	// SelfService is true when the person is deleting their own account, which
	// is the case both app stores require to exist.
	SelfService bool
	// ActorID is who performed it, for the audit trail.
	ActorID string
}

// DeleteAccount erases a person and anonymises what must survive.
//
// Returns a receipt that says exactly what happened. Apple 5.1.1(v) permits
// retention where the law requires it, PROVIDED the person is told — so the
// receipt is not a courtesy, it is the thing that makes the retention lawful
// and the review passable.
func (s *Service) DeleteAccount(ctx context.Context, req DeleteRequest) (*Receipt, error) {
	memberID := strings.TrimSpace(req.MemberID)
	userID := strings.TrimSpace(req.UserID)
	if memberID == "" || userID == "" {
		// Both, always. One without the other silently half-deletes.
		return nil, ErrMemberRequired
	}
	if !req.Confirmed {
		return nil, ErrConfirmationRequired
	}
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return nil, err
	}

	started := s.now()
	receipt := &Receipt{
		ChurchID:    mongodb.ID(churchID),
		Reference:   newReference(),
		RequestedAt: started,
		SelfService: req.SelfService,
		Erased:      map[string]int64{},
		Anonymised:  map[string]int64{},
	}

	for _, h := range Holdings {
		coll := s.db.Tenant(h.Collection)
		filter := matcher(h.Field, idFor(h, memberID, userID))

		switch h.Disposition {
		case Retained:
			receipt.Retained = append(receipt.Retained,
				RetentionNote{Label: h.Label, Because: h.Because})

		case Anonymised:
			// Severed, not tokenised. The id is UNSET rather than replaced,
			// because any stable replacement — a hash, a pseudonym — is a
			// re-identification key and would make "anonymised" untrue.
			unset := bson.M{}
			for _, f := range h.IdentityFields {
				unset[f] = ""
			}
			res, err := coll.UpdateMany(ctx, filter, bson.M{
				"$unset": unset,
				"$set":   bson.M{"anonymisedAt": started},
			})
			if err != nil {
				return nil, fmt.Errorf("privacy: anonymise %s: %w", h.Collection, err)
			}
			if res.ModifiedCount > 0 {
				receipt.Anonymised[h.Label] = res.ModifiedCount
			}
			receipt.Retained = append(receipt.Retained,
				RetentionNote{Label: h.Label, Because: h.Because})

		case Erased:
			res, err := coll.DeleteMany(ctx, filter)
			if err != nil {
				return nil, fmt.Errorf("privacy: erase %s: %w", h.Collection, err)
			}
			if res.DeletedCount > 0 {
				receipt.Erased[h.Label] = res.DeletedCount
			}
		}
	}

	receipt.CompletedAt = s.now()

	// The receipt is written LAST and holds nothing identifying. If the run
	// died earlier the person still exists and the request can be retried;
	// a receipt written first would claim a deletion that had not happened.
	doc := bson.M{
		"reference": receipt.Reference, "requestedAt": receipt.RequestedAt,
		"selfService": receipt.SelfService, "completedAt": receipt.CompletedAt,
		"erased": receipt.Erased, "anonymised": receipt.Anonymised,
		"retained": receipt.Retained,
	}
	res, err := s.receipts.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("privacy: write receipt: %w", err)
	}
	if oid, ok := res.InsertedID.(bson.ObjectID); ok {
		receipt.ID = oid
	}
	return receipt, nil
}

// ReceiptByReference finds a deletion receipt.
//
// The only lookup offered, because a receipt holds no member id — there is
// deliberately no way to ask "was this person deleted", which would
// re-identify somebody who exercised their right to be forgotten.
func (s *Service) ReceiptByReference(ctx context.Context, reference string) (*Receipt, error) {
	var out Receipt
	err := s.receipts.FindOne(ctx, bson.M{"reference": strings.TrimSpace(reference)}, &out)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("privacy: read receipt: %w", err)
	}
	return &out, nil
}

// newReference is a random handle for a deletion.
//
// Random rather than derived: anything computed from the member's id or email
// would let somebody test whether a given person had been deleted, which is
// the one question this record must not answer.
func newReference() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "DEL-" + hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405")))
	}
	return "DEL-" + strings.ToUpper(hex.EncodeToString(buf))
}
