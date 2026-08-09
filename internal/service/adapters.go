package service

import (
	"context"
	"errors"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/consent"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// The adapters here connect domains that must not import each other.
//
// notification declares narrow interfaces for what it needs — a Directory to
// resolve a member's contact details, a ConsentChecker to ask whether it may
// communicate — and this is where the real services are attached to them.
// Until now both were nil at every construction site, which made the whole
// notification service dead code however well tested it was.

// memberDirectory resolves a member into contact details for notification.
type memberDirectory struct {
	members  *member.Service
	accounts *mongo.Collection
}

var _ notification.Directory = (*memberDirectory)(nil)

// RecipientFor returns a member's contact details.
//
// A missing member is (nil, nil), not an error: notification treats a
// recipient it cannot reach as a suppression rather than a failure, and a
// message addressed to a deleted member should be recorded as unsendable, not
// retried until it exhausts its attempts.
func (d *memberDirectory) RecipientFor(ctx context.Context, memberID string) (*notification.Recipient, error) {
	m, err := d.members.ByID(ctx, memberID)
	if errors.Is(err, member.ErrNotFound) {
		oid, idErr := bson.ObjectIDFromHex(memberID)
		churchID, scopeErr := tenancy.MustChurchID(ctx)
		if idErr != nil || scopeErr != nil {
			return nil, nil
		}
		var account auth.User
		err = d.accounts.FindOne(ctx, bson.M{
			"_id": oid, "churchId": mongodb.ID(churchID), "isActive": true,
		}).Decode(&account)
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &notification.Recipient{
			MemberID: account.ID.Hex(), Name: account.Name,
			PhoneE164: account.Phone, Email: account.Email,
		}, nil
	}
	if err != nil {
		return nil, err
	}
	return &notification.Recipient{
		MemberID:  m.ID.Hex(),
		Name:      m.FullName(),
		PhoneE164: m.PhoneE164,
		Email:     m.Email,
	}, nil
}

// consentGate answers whether a member may be contacted.
type consentGate struct{ consents *consent.Service }

var _ notification.ConsentChecker = (*consentGate)(nil)

// IsGranted delegates to the consent service, which fails closed for
// communications: no record means no consent (WP-06).
func (g *consentGate) IsGranted(ctx context.Context, memberID string, p consent.Purpose) (bool, error) {
	return g.consents.IsGranted(ctx, memberID, p)
}

// newNotificationService builds a notification service with everything wired.
//
// Every argument here was previously nil. The transports come from WP-15 and
// refuse to send when unconfigured rather than pretending — so a deployment
// without SMS credentials records suppressed messages with a
// reason, instead of reporting success for messages nobody received.
func newNotificationService(d *deps.Deps) *notification.Service {
	members := member.NewService(d.Mongo, d.Events, d.Config.DataRegion)
	consents := consent.NewService(d.Mongo, d.Events)

	return notification.NewService(
		d.Mongo,
		&consentGate{consents: consents},
		&memberDirectory{members: members, accounts: d.Mongo.Global(auth.Collection)},
		d.Transports()...,
	).WithLocation(d.Location())
}

// memberNames resolves a signed-in caller into a display name and avatar.
//
// Used by the feed (WP-24), which denormalises the author's name onto every
// post. The name is looked up rather than trusted from the request body,
// because a client that supplies its own display name can post as somebody
// else — and on a church feed, a post appearing under the pastor's name is the
// whole attack rather than a cosmetic problem.
type memberNames struct {
	accounts *mongo.Collection
}

func newMemberNames(d *deps.Deps) *memberNames {
	return &memberNames{accounts: d.Mongo.Global(auth.Collection)}
}

// lookup returns a caller's display name and avatar, or empty strings.
//
// Read from the ACCOUNT rather than the member record: the avatar only exists
// there, the name is the one the person set on their own profile, and an
// authenticated caller always has an account whereas they may not yet have
// been linked to a member.
//
// A miss is not an error. The worst case is a post attributed to an id rather
// than a name, which is better than refusing to let somebody post because
// their profile could not be read.
func (n *memberNames) lookup(ctx context.Context, userID string) (name, avatar string) {
	if n == nil || n.accounts == nil {
		return "", ""
	}
	oid, err := bson.ObjectIDFromHex(userID)
	if err != nil {
		return "", ""
	}
	churchID, err := tenancy.MustChurchID(ctx)
	if err != nil {
		return "", ""
	}

	var account auth.User
	// Scoped by church as well as id: users are a GLOBAL collection, so an id
	// alone would read across churches.
	if err := n.accounts.FindOne(ctx, bson.M{
		"_id": oid, "churchId": mongodb.ID(churchID),
	}).Decode(&account); err != nil {
		return "", ""
	}
	return account.Name, account.AvatarURL
}
