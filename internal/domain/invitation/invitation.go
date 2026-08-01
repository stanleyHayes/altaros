// Package invitation brings staff and members into a church (WP-37).
//
// Invitation rather than self-signup is the default, and that is a security
// decision as much as a product one: an open signup on a church's subdomain
// lets anyone create an account inside that church's workspace, where they can
// then see whatever the Member role sees. A church's congregation list is not
// public information.
//
// Three properties matter and are structural rather than remembered:
//
//   - The token is HASHED at rest, like the OTP codes in WP-10. An invitation
//     link sitting in a leaked database backup is otherwise a working account.
//   - It is single-use and expiring. An invitation that never expires is a
//     permanent unauthenticated path into a church's data.
//   - The church comes from the TOKEN, never from the request. An invitation
//     cannot be redirected at another church by editing a field.
package invitation

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collection holding invitations.
const Collection = "invitations"

// Lifetime is how long an invitation stays valid.
//
// Seven days: long enough for someone who was invited on a Sunday and opens
// their email the following weekend, short enough that a link forwarded around
// a WhatsApp group stops working before it circulates widely.
const Lifetime = 7 * 24 * time.Hour

// tokenBytes is the entropy in an invitation token. 32 bytes is well beyond
// guessing; the limit on brute force is the rate limiter, not the length.
const tokenBytes = 32

// Status is where an invitation is in its life.
type Status string

const (
	StatusPending  Status = "pending"
	StatusAccepted Status = "accepted"
	StatusRevoked  Status = "revoked"
	StatusExpired  Status = "expired"
)

var (
	// ErrNotFound means no invitation matched. Deliberately also returned for
	// an expired, revoked or already-accepted token: a caller holding a dead
	// link must not be able to tell WHICH kind of dead it is, or the endpoint
	// becomes a way to probe which invitations were issued.
	ErrNotFound = errors.New("invitation: not found or no longer valid")
	// ErrAlreadyMember means the person already has an account in this church.
	ErrAlreadyMember = errors.New("invitation: that person is already in this church")
	// ErrContactRequired means neither an email nor a phone was supplied.
	ErrContactRequired = errors.New("invitation: an email address or phone number is required")
	// ErrRoleRequired means no role was chosen for the invitee.
	ErrRoleRequired = errors.New("invitation: a role is required")
)

// Invitation is a pending membership.
type Invitation struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	Email    string        `bson:"email,omitempty" json:"email,omitempty"`
	Phone    string        `bson:"phone,omitempty" json:"phone,omitempty"`
	Name     string        `bson:"name,omitempty"  json:"name,omitempty"`
	// RoleID is what they get on acceptance (requirement 4: the role's
	// permissions are assigned at invitation time).
	RoleID   string `bson:"roleId"   json:"roleId"`
	RoleName string `bson:"roleName,omitempty" json:"roleName,omitempty"`
	// TokenHash is SHA-256 of the raw token. The raw token exists only in the
	// link that was sent, never at rest.
	TokenHash string `bson:"tokenHash" json:"-"`
	Status    Status `bson:"status"    json:"status"`

	InvitedBy    mongodb.ID `bson:"invitedBy,omitempty" json:"invitedBy,omitempty"`
	InvitedAt    time.Time  `bson:"invitedAt"  json:"invitedAt"`
	ExpiresAt    time.Time  `bson:"expiresAt"  json:"expiresAt"`
	AcceptedAt   *time.Time `bson:"acceptedAt,omitempty" json:"acceptedAt,omitempty"`
	AcceptedUser mongodb.ID `bson:"acceptedUserId,omitempty" json:"acceptedUserId,omitempty"`
	RevokedAt    *time.Time `bson:"revokedAt,omitempty" json:"revokedAt,omitempty"`
	// Message is an optional note from the person inviting, shown on the
	// acceptance page. A bare "you have been invited" from a system nobody
	// recognises reads as phishing.
	Message string `bson:"message,omitempty" json:"message,omitempty"`
}

// Live reports whether an invitation can still be accepted.
func (i *Invitation) Live(now time.Time) bool {
	return i != nil && i.Status == StatusPending && now.Before(i.ExpiresAt)
}

// Contact returns the address the invitation was sent to.
func (i *Invitation) Contact() string {
	if i.Email != "" {
		return i.Email
	}
	return i.Phone
}

// newToken generates an invitation token and its hash.
//
// The raw token is returned once, for the link. Only the hash is stored — the
// same shape as the OTP codes in WP-10, and for the same reason: a database
// backup should not contain working credentials.
func newToken() (raw, hashed string, err error) {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("invitation: generate token: %w", err)
	}
	// URL-safe and unpadded, so the token survives being pasted into a
	// WhatsApp message or an SMS without being mangled.
	raw = base64.RawURLEncoding.EncodeToString(buf)
	return raw, hashToken(raw), nil
}

// hashToken is the one-way function stored tokens go through.
func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(sum[:])
}

// tokensMatch compares in constant time.
//
// The lookup is by hash so a timing difference here is not obviously
// exploitable, but comparing secrets with == is the habit that eventually is.
func tokensMatch(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
