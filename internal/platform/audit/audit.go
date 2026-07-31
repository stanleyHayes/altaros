// Package audit records who touched which record, and when (WP-08).
//
// Most audit logs record mutations. This one records READS as well, because
// the sensitive data here is sensitive on access, not on change: prayer
// requests and welfare cases routinely contain health details, financial
// hardship, and disclosures of abuse. "Who read this member's prayer request?"
// is the question that matters after an incident, and a mutation-only log
// cannot answer it.
//
// The log is append-only. There is no Update or Delete, deliberately: an audit
// trail that can be edited by the same system it audits is not evidence.
package audit

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/logging"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Collection holding audit entries.
const Collection = "audit_log"

// Action is what the actor did.
type Action string

const (
	ActionRead   Action = "read"
	ActionList   Action = "list"
	ActionCreate Action = "create"
	ActionUpdate Action = "update"
	ActionDelete Action = "delete"
	ActionExport Action = "export"
	// ActionDenied records a refused attempt. These are the entries that
	// reveal probing, so they matter more than the successful ones.
	ActionDenied Action = "denied"
)

// ResourceType identifies what was touched.
type ResourceType string

const (
	ResourceMember       ResourceType = "member"
	ResourceTransaction  ResourceType = "transaction"
	ResourcePrayer       ResourceType = "prayer_request"
	ResourceWelfare      ResourceType = "welfare_case"
	ResourceConsent      ResourceType = "consent"
	ResourceMemberExport ResourceType = "member_export"
)

// sensitiveResources must be audited even on read. Everything here can carry
// health, hardship, or safeguarding information.
var sensitiveResources = map[ResourceType]bool{
	ResourcePrayer:       true,
	ResourceWelfare:      true,
	ResourceMemberExport: true,
}

// IsSensitive reports whether reads of this resource must be audited.
func IsSensitive(r ResourceType) bool { return sensitiveResources[r] }

// Entry is one immutable audit record.
type Entry struct {
	ID         bson.ObjectID `bson:"_id,omitempty"        json:"id"`
	ChurchID   string        `bson:"churchId"             json:"churchId"`
	ActorID    string        `bson:"actorId"              json:"actorId"`
	ActorRole  string        `bson:"actorRole"            json:"actorRole"`
	Action     Action        `bson:"action"               json:"action"`
	Resource   ResourceType  `bson:"resource"             json:"resource"`
	ResourceID string        `bson:"resourceId,omitempty" json:"resourceId,omitempty"`
	// Reason carries why access was granted or refused. For a denied entry
	// this is the whole point of the record.
	Reason    string    `bson:"reason,omitempty"     json:"reason,omitempty"`
	IP        string    `bson:"ip,omitempty"         json:"ip,omitempty"`
	RequestID string    `bson:"requestId,omitempty"  json:"requestId,omitempty"`
	CreatedAt time.Time `bson:"createdAt"            json:"createdAt"`
}

// Logger appends audit entries.
type Logger struct {
	coll *mongodb.TenantCollection
}

// NewLogger builds an audit logger.
func NewLogger(db *mongodb.DB) *Logger {
	return &Logger{coll: db.Tenant(Collection)}
}

// EnsureIndexes creates the indexes the audit queries need.
// Per ADR-005 every tenant-scoped compound index leads with churchId.
func (l *Logger) EnsureIndexes(ctx context.Context) error {
	_, err := l.coll.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			// "Who touched this record?" — the post-incident question.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "resource", Value: 1},
				{Key: "resourceId", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_resource_recent"),
		},
		{
			// "What did this user access?" — the other direction.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "actorId", Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_actor_recent"),
		},
	})
	if err != nil {
		return fmt.Errorf("audit: create indexes: %w", err)
	}
	return nil
}

// Record appends an entry. The actor is taken from the request scope rather
// than from the caller, so a handler cannot attribute its access to someone
// else.
//
// Audit failures are logged but do not fail the request: refusing to serve a
// member's own prayer request because the audit write timed out would be a
// worse outcome than a gap in the log. The gap is surfaced at error level so
// it is detectable rather than silent.
func (l *Logger) Record(ctx context.Context, action Action, resource ResourceType, resourceID, reason string) {
	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		// No tenant means no church to attribute this to. That is a
		// programming error at the call site, not something to swallow.
		logging.FromContext(ctx).Error("audit: dropped entry, no tenant in context",
			"action", action, "resource", resource, "resourceId", resourceID)
		return
	}

	doc := bson.M{
		"actorId":   scope.UserID,
		"actorRole": scope.Role,
		"action":    string(action),
		"resource":  string(resource),
	}
	if resourceID != "" {
		doc["resourceId"] = resourceID
	}
	if reason != "" {
		doc["reason"] = reason
	}
	if ip, ok := ctx.Value(ipKey{}).(string); ok && ip != "" {
		doc["ip"] = ip
	}
	if rid, ok := ctx.Value(requestIDKey{}).(string); ok && rid != "" {
		doc["requestId"] = rid
	}

	if _, err := l.coll.InsertOne(ctx, doc); err != nil {
		logging.FromContext(ctx).Error("audit: failed to write entry",
			"error", err, "action", action, "resource", resource, "resourceId", resourceID)
	}
}

// RecordRead is the read-side helper. It is a no-op for resources that are not
// sensitive, so ordinary listing does not flood the log while prayer and
// welfare access is always captured.
func (l *Logger) RecordRead(ctx context.Context, resource ResourceType, resourceID string) {
	if !IsSensitive(resource) {
		return
	}
	l.Record(ctx, ActionRead, resource, resourceID, "")
}

// RecordDenied captures a refused access attempt.
func (l *Logger) RecordDenied(ctx context.Context, resource ResourceType, resourceID, reason string) {
	l.Record(ctx, ActionDenied, resource, resourceID, reason)
}

// ForResource returns the access history of one record, newest first.
func (l *Logger) ForResource(ctx context.Context, resource ResourceType, resourceID string) ([]Entry, error) {
	var entries []Entry
	err := l.coll.Find(ctx,
		bson.M{"resource": string(resource), "resourceId": resourceID},
		&entries,
		options.Find().SetSort(bson.D{
			{Key: "createdAt", Value: -1},
			{Key: "_id", Value: -1},
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("audit: history for %s/%s: %w", resource, resourceID, err)
	}
	return entries, nil
}

// ForActor returns what one user accessed, newest first.
func (l *Logger) ForActor(ctx context.Context, actorID string) ([]Entry, error) {
	var entries []Entry
	err := l.coll.Find(ctx,
		bson.M{"actorId": actorID},
		&entries,
		options.Find().SetSort(bson.D{
			{Key: "createdAt", Value: -1},
			{Key: "_id", Value: -1},
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("audit: history for actor %s: %w", actorID, err)
	}
	return entries, nil
}

// --- request metadata carried into the audit entry ---

type ipKey struct{}
type requestIDKey struct{}

// WithRequestMetadata attaches the caller's IP and request id so audit entries
// can be correlated with application logs and traces.
func WithRequestMetadata(ctx context.Context, ip, requestID string) context.Context {
	ctx = context.WithValue(ctx, ipKey{}, ip)
	return context.WithValue(ctx, requestIDKey{}, requestID)
}
