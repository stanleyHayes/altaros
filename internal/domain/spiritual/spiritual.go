// Package spiritual owns devotionals, sermons and member prayer requests.
package spiritual

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

const (
	DevotionalCollection = "devotionals"
	SermonCollection      = "sermons"
	PrayerCollection      = "prayer_requests"
)

var (
	ErrNotFound        = errors.New("spiritual: not found")
	ErrInvalidInput    = errors.New("spiritual: invalid input")
	ErrMemberRequired  = errors.New("spiritual: member required")
)

type Devotional struct {
	ID            bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID      mongodb.ID    `bson:"churchId" json:"churchId"`
	Title         string        `bson:"title" json:"title"`
	Scripture     string        `bson:"scripture" json:"scripture"`
	ScriptureText string        `bson:"scriptureText" json:"scriptureText"`
	Content       string        `bson:"content" json:"content"`
	Date          time.Time     `bson:"date" json:"date"`
	Author        string        `bson:"author" json:"author"`
	ImageURL      *string       `bson:"imageUrl,omitempty" json:"imageUrl,omitempty"`
}

type Sermon struct {
	ID           bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID     mongodb.ID    `bson:"churchId" json:"churchId"`
	Title        string        `bson:"title" json:"title"`
	Speaker      string        `bson:"speaker" json:"speaker"`
	Date         time.Time     `bson:"date" json:"date"`
	Duration     string        `bson:"duration" json:"duration"`
	ThumbnailURL *string       `bson:"thumbnailUrl,omitempty" json:"thumbnailUrl,omitempty"`
	AudioURL     *string       `bson:"audioUrl,omitempty" json:"audioUrl,omitempty"`
	VideoURL     *string       `bson:"videoUrl,omitempty" json:"videoUrl,omitempty"`
	Description  string        `bson:"description" json:"description"`
	Series       *string       `bson:"series,omitempty" json:"series,omitempty"`
}

type PrayerRequest struct {
	ID          bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID    mongodb.ID    `bson:"churchId" json:"churchId"`
	MemberID    mongodb.ID    `bson:"memberId" json:"memberId"`
	Title       string        `bson:"title" json:"title"`
	Description string        `bson:"description" json:"description"`
	IsAnonymous bool          `bson:"isAnonymous" json:"isAnonymous"`
	PrayerCount int64         `bson:"prayerCount" json:"prayerCount"`
	AuthorName  *string       `bson:"authorName,omitempty" json:"authorName,omitempty"`
	CreatedAt   time.Time     `bson:"createdAt" json:"createdAt"`
}

type PrayerInput struct {
	Title, Description string
	IsAnonymous        bool
	MemberID            string
	AuthorName          string
}
