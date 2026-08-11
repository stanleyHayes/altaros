package live

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Recording a service is a data protection question before it is a storage one.
//
// A recorded service captures the congregation: who attended, who came forward
// for prayer, who wept, who was baptised. Under the Data Protection Act 2012
// that is personal data, and because it reveals religious belief it is SENSITIVE
// personal data under s.1 — the category the Act treats most strictly. A church
// that records without telling anyone has not made a technical oversight.
//
// So three things are enforced here rather than documented:
//
//  1. Recording is OFF by default and switched on per session. A church that
//     never thinks about it never records.
//  2. Every viewer is TOLD, in the join response, before their camera or
//     microphone could be used and before they have watched anything.
//  3. Recordings expire. Act 843 s.24 does not permit keeping personal data
//     longer than the purpose needs, and "we kept every service forever
//     because storage is cheap" is not a purpose.

// RecordingCollection holds one document per recorded service.
const RecordingCollection = "live_recordings"

// DefaultRetention is how long a recording is kept unless a church shortens it.
//
// One year: long enough to re-watch a service, share a sermon, and settle a
// question about what was said; short enough that a congregation's faces are
// not held indefinitely by default. A church may set less. It may NOT set
// more — see MaxRetention.
const DefaultRetention = 365 * 24 * time.Hour

// MaxRetention is the longest a church may keep a recording.
//
// A ceiling, not a suggestion, and it is deliberately shorter than the six
// years Act 915 s.28 requires for FINANCIAL records. The two are different
// data: a giving ledger is a legal obligation, and video of a congregation
// praying is not. Letting a church type "10 years" into a settings box would
// make the tightest data in the product the longest-lived.
const MaxRetention = 3 * 365 * 24 * time.Hour

var (
	// ErrRecordingNotFound means no such recording in this church.
	ErrRecordingNotFound = errors.New("live: recording not found")
	// ErrRetentionTooLong means a church asked to keep a recording past the cap.
	ErrRetentionTooLong = errors.New("live: recordings cannot be kept that long")
	// ErrNotRecording means the session was not being recorded.
	ErrNotRecording = errors.New("live: that service was not recorded")
)

// RecordingStatus is where a recording stands.
type RecordingStatus string

const (
	// RecordingActive means the service is being written now.
	RecordingActive RecordingStatus = "recording"
	// RecordingReady means it is finished and playable.
	RecordingReady RecordingStatus = "ready"
	// RecordingFailed means the write did not complete.
	//
	// Kept as a row rather than deleted, because a church that was told the
	// service was being recorded is owed the answer that it was not.
	RecordingFailed RecordingStatus = "failed"
	// RecordingDeleted means the media is gone and only the record remains.
	RecordingDeleted RecordingStatus = "deleted"
)

// Recording is one recorded service.
type Recording struct {
	ID        bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID  mongodb.ID    `bson:"churchId"      json:"churchId"`
	SessionID mongodb.ID    `bson:"sessionId"     json:"sessionId"`

	Title  string          `bson:"title"  json:"title"`
	Status RecordingStatus `bson:"status" json:"status"`

	// StoragePath is where the media lives. NOT a URL and never served
	// directly: playback goes through an authorised handler, because a
	// guessable path to a congregation on video is the same leak as no
	// access control at all.
	StoragePath string `bson:"storagePath,omitempty" json:"-"`
	SizeBytes   int64  `bson:"sizeBytes,omitempty"   json:"sizeBytes,omitempty"`

	// AnnouncedAt is when the church declared this service would be recorded.
	//
	// Stored because "were people told" is the question that gets asked
	// afterwards, and "the recording exists so presumably they were" is not an
	// answer anybody should accept.
	AnnouncedAt time.Time `bson:"announcedAt" json:"announcedAt"`
	// AnnouncedBy is who made that declaration.
	AnnouncedBy mongodb.ID `bson:"announcedBy,omitempty" json:"announcedBy,omitempty"`

	StartedAt time.Time  `bson:"startedAt"           json:"startedAt"`
	EndedAt   *time.Time `bson:"endedAt,omitempty"   json:"endedAt,omitempty"`

	// DeleteAfter is when this is erased. Always set, never null.
	//
	// A nullable expiry is a recording kept forever by whoever forgets to fill
	// it in, and the person who bears that is a member of the congregation who
	// was on camera four years ago.
	DeleteAfter time.Time  `bson:"deleteAfter"          json:"deleteAfter"`
	DeletedAt   *time.Time `bson:"deletedAt,omitempty"  json:"deletedAt,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// Expired reports whether this recording is past its retention.
func (r *Recording) Expired(now time.Time) bool {
	return r != nil && r.Status != RecordingDeleted && !now.Before(r.DeleteAfter)
}

// RecordingNotice is what a member is told before they watch or appear.
//
// Returned on JOIN, not buried in a settings page, because consent that arrives
// after someone is already on camera is not consent. The wording is plain for
// the same reason: a notice nobody understands has not informed anybody, whether
// or not it satisfies a lawyer.
type RecordingNotice struct {
	Recording bool   `json:"recording"`
	Notice    string `json:"notice,omitempty"`
	// KeptUntil tells a person how long, which is the part they actually
	// want to know and the part a generic notice always omits.
	KeptUntil *time.Time `json:"keptUntil,omitempty"`
}

// NoticeFor builds the notice for a session.
func NoticeFor(s *Session, deleteAfter *time.Time) RecordingNotice {
	if s == nil || !s.Recording {
		return RecordingNotice{Recording: false}
	}
	return RecordingNotice{
		Recording: true,
		Notice: "This service is being recorded. If you turn on your camera or " +
			"microphone you may appear in the recording.",
		KeptUntil: deleteAfter,
	}
}

// StartRecording opens a recording for a session.
func (s *Service) StartRecording(ctx context.Context, sessionID, storagePath, actorID string, retention time.Duration) (*Recording, error) {
	session, err := s.SessionByID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if retention <= 0 {
		retention = DefaultRetention
	}
	if retention > MaxRetention {
		return nil, fmt.Errorf("%w: asked for %s, the limit is %s",
			ErrRetentionTooLong, retention, MaxRetention)
	}

	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(sessionID))
	if err != nil {
		return nil, ErrSessionNotFound
	}

	now := s.now().UTC()
	doc := bson.M{
		"sessionId": oid,
		"title":     session.Title,
		"status":    string(RecordingActive),
		// The expiry is computed and stored NOW, at the start, rather than
		// when the recording ends. A service that crashes mid-write would
		// otherwise leave a row with no expiry — the exact recording nobody
		// remembers, kept forever.
		"deleteAfter": now.Add(retention),
		"announcedAt": now,
		"startedAt":   now,
		"createdAt":   now,
		"updatedAt":   now,
	}
	if storagePath != "" {
		doc["storagePath"] = storagePath
	}
	if actorID != "" {
		doc["announcedBy"] = mongodb.ID(actorID)
	}

	res, err := s.recordings.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("live: start recording: %w", err)
	}
	id, _ := res.InsertedID.(bson.ObjectID)
	return s.RecordingByID(ctx, id.Hex())
}

// FinishRecording marks a recording complete.
func (s *Service) FinishRecording(ctx context.Context, id string, sizeBytes int64, failed bool) (*Recording, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrRecordingNotFound
	}
	status := RecordingReady
	if failed {
		status = RecordingFailed
	}
	now := s.now().UTC()
	if _, err := s.recordings.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": bson.M{
		"status": string(status), "sizeBytes": sizeBytes,
		"endedAt": now, "updatedAt": now,
	}}); err != nil {
		return nil, fmt.Errorf("live: finish recording: %w", err)
	}
	return s.RecordingByID(ctx, id)
}

// RecordingByID reads one recording.
func (s *Service) RecordingByID(ctx context.Context, id string) (*Recording, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return nil, ErrRecordingNotFound
	}
	var rec Recording
	if err := s.recordings.FindOne(ctx, bson.M{"_id": oid}, &rec); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrRecordingNotFound
		}
		return nil, fmt.Errorf("live: read recording: %w", err)
	}
	return &rec, nil
}

// Recordings lists a church's recordings, newest first.
//
// Deleted ones are still LISTED, with their media gone. A church that recorded
// four services and sees three has been told something untrue about its own
// history; showing the row with an expiry date is how retention becomes
// visible rather than mysterious.
func (s *Service) Recordings(ctx context.Context) ([]Recording, error) {
	out := []Recording{}
	err := s.recordings.Find(ctx, bson.M{}, &out,
		options.Find().SetSort(bson.D{{Key: "startedAt", Value: -1}}).SetLimit(200))
	if err != nil {
		return nil, fmt.Errorf("live: list recordings: %w", err)
	}
	return out, nil
}

// RecordingForSession finds the recording of one service.
func (s *Service) RecordingForSession(ctx context.Context, sessionID string) (*Recording, error) {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(sessionID))
	if err != nil {
		return nil, ErrRecordingNotFound
	}
	// Newest first via Find rather than FindOne: a session restarted after a
	// crash has more than one recording row, and the one a church wants is
	// the latest, not whichever the database returns first.
	found := []Recording{}
	err = s.recordings.Find(ctx, bson.M{"sessionId": oid}, &found,
		options.Find().SetSort(bson.D{{Key: "startedAt", Value: -1}}).SetLimit(1))
	if err == nil && len(found) == 0 {
		err = mongo.ErrNoDocuments
	}
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrRecordingNotFound
		}
		return nil, fmt.Errorf("live: read recording: %w", err)
	}
	return &found[0], nil
}

// ExpiredRecordings finds recordings past their retention, across ALL churches.
//
// Global on purpose: this is the sweeper's query, and a retention rule that
// only ran for churches somebody remembered to sweep is not a retention rule.
func (s *Service) ExpiredRecordings(ctx context.Context, now time.Time, limit int64) ([]Recording, error) {
	cursor, err := s.allRecordings.Find(ctx, bson.M{
		"deleteAfter": bson.M{"$lte": now},
		"status":      bson.M{"$ne": string(RecordingDeleted)},
	}, options.Find().SetLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("live: find expired recordings: %w", err)
	}
	out := []Recording{}
	if err := cursor.All(ctx, &out); err != nil {
		return nil, fmt.Errorf("live: read expired recordings: %w", err)
	}
	return out, nil
}

// MarkRecordingDeleted records that the media is gone.
//
// The ROW survives its media. Erasing it too would leave a church with no
// evidence that a service was recorded and later deleted, which is the record
// a data protection question actually needs — and it is what lets the church
// tell a member "yes, that service was recorded, and it was erased on this
// date" instead of "we have no idea".
func (s *Service) MarkRecordingDeleted(ctx context.Context, id string) error {
	oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
	if err != nil {
		return ErrRecordingNotFound
	}
	now := s.now().UTC()
	_, err = s.allRecordings.UpdateOne(ctx, bson.M{"_id": oid}, bson.M{"$set": bson.M{
		"status": string(RecordingDeleted), "deletedAt": now, "updatedAt": now,
		// The path goes with the media. Keeping it would leave a map to a
		// file we promised to erase.
		"storagePath": "",
	}})
	if err != nil {
		return fmt.Errorf("live: mark recording deleted: %w", err)
	}
	return nil
}
