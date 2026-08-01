// Package site is the per-church website and its CMS (WP-40, ADR-007).
//
// # What a church is buying
//
// Most churches in this market have no website, or one that has been wrong
// since 2019 because the person who built it left. So the two things that
// matter are that it is EDITABLE by whoever is in the office on Tuesday, and
// that the parts most likely to go stale — service times, events, sermons —
// are not typed twice.
//
// # Versioning at the page, not the block
//
//	pages.draftVersionId      what the editor is working on
//	pages.publishedVersionId  what the public sees
//
// Publishing is "point publishedVersionId at this version". Rollback is "point
// it at an earlier one". Both are a single-field update: atomic, instant, and
// impossible to half-apply. Versioning per BLOCK makes both a multi-row
// migration that can fail halfway and leave a page that is neither the old one
// nor the new one — on a live website, in front of a congregation.
//
// The consequence that has to be handled rather than assumed: after publishing,
// draft and published point at the same version, so the next edit MUST fork a
// new version rather than mutate it. Editing in place would change the live
// site while someone believed they were drafting.
package site

import (
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

// Collections.
const (
	PageCollection    = "pages"
	VersionCollection = "pageVersions"
	BlockCollection   = "blocks"
	ThemeCollection   = "siteThemes"
)

var (
	// ErrPageNotFound means no page matched in this church.
	ErrPageNotFound = errors.New("site: page not found")
	// ErrVersionNotFound means no version matched.
	ErrVersionNotFound = errors.New("site: version not found")
	// ErrSlugTaken means the church already has a page at that address.
	ErrSlugTaken = errors.New("site: a page already exists at that address")
	// ErrSlugInvalid means the slug cannot be part of a URL.
	ErrSlugInvalid = errors.New("site: that page address is not valid")
	// ErrTitleRequired means a page was submitted without a title.
	ErrTitleRequired = errors.New("site: a page title is required")
	// ErrNothingToPublish means the draft is identical to what is already live.
	ErrNothingToPublish = errors.New("site: there are no changes to publish")
	// ErrNotPublished means an operation needs a live version and there is none.
	ErrNotPublished = errors.New("site: this page has never been published")
	// ErrHomePageRequired means the church tried to remove its only landing page.
	ErrHomePageRequired = errors.New("site: a site must keep a home page")
)

// VersionStatus is where a version sits in its life.
type VersionStatus string

const (
	// StatusDraft is being edited and is not public.
	StatusDraft VersionStatus = "draft"
	// StatusPublished is, or has been, live.
	StatusPublished VersionStatus = "published"
	// StatusArchived was live and has been superseded. Kept, because rollback
	// is the whole point of versioning and deleting the old one removes it.
	StatusArchived VersionStatus = "archived"
)

// Page is one address on a church's site.
type Page struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	// Slug is the path: "" is the home page, "about" is /about.
	Slug  string `bson:"slug"  json:"slug"`
	Title string `bson:"title" json:"title"`
	// SEODescription is the snippet a search engine shows. Empty is allowed;
	// a bad one is worse than none.
	SEODescription string `bson:"seoDescription,omitempty" json:"seoDescription,omitempty"`

	// NavOrder places the page in the site's navigation. Sparse (10, 20, 30)
	// for the same reason block positions are.
	NavOrder int `bson:"navOrder" json:"navOrder"`
	// InNav is separate from NavOrder because a page can legitimately exist
	// and not be linked — a giving page reached only from a QR code on a
	// bulletin, for instance.
	InNav bool `bson:"inNav" json:"inNav"`

	DraftVersionID     bson.ObjectID `bson:"draftVersionId,omitempty"     json:"draftVersionId,omitempty"`
	PublishedVersionID bson.ObjectID `bson:"publishedVersionId,omitempty" json:"publishedVersionId,omitempty"`

	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// IsPublished reports whether the public can see anything at this address.
func (p *Page) IsPublished() bool { return !p.PublishedVersionID.IsZero() }

// HasUnpublishedChanges reports whether the draft differs from what is live.
//
// True when the draft version is not the published one — which is the case
// immediately after any edit, since editing forks a new version.
func (p *Page) HasUnpublishedChanges() bool {
	if p.DraftVersionID.IsZero() {
		return false
	}
	return p.DraftVersionID != p.PublishedVersionID
}

// Version is one snapshot of a page's content.
type Version struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`
	PageID   bson.ObjectID `bson:"pageId"        json:"pageId"`

	// Number increments per page, so an editor sees "version 4" rather than an
	// ObjectId.
	Number int           `bson:"number" json:"number"`
	Status VersionStatus `bson:"status" json:"status"`

	// Note is what the editor typed about this change — "added Easter service
	// times". Optional, and the thing that makes a version list usable a month
	// later.
	Note string `bson:"note,omitempty" json:"note,omitempty"`

	PublishedAt *time.Time `bson:"publishedAt,omitempty" json:"publishedAt,omitempty"`
	PublishedBy mongodb.ID `bson:"publishedBy,omitempty" json:"publishedBy,omitempty"`
	CreatedBy   mongodb.ID `bson:"createdBy,omitempty"   json:"createdBy,omitempty"`
	CreatedAt   time.Time  `bson:"createdAt"             json:"createdAt"`
}

// Block is one section of a page, belonging to one version.
type Block struct {
	ID        bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID  mongodb.ID    `bson:"churchId"      json:"churchId"`
	VersionID bson.ObjectID `bson:"versionId"     json:"versionId"`

	Type BlockType `bson:"type" json:"type"`
	// Position is a SPARSE integer (10, 20, 30…), so inserting between two
	// blocks is one write rather than renumbering the whole page.
	Position int `bson:"position" json:"position"`

	// Data is the block's validated content. Its shape depends on Type and is
	// checked on save by the block's own validator — nothing reaches this
	// field unvalidated.
	Data map[string]any `bson:"data" json:"data"`
}

// Theme is a church's visual identity for its own site.
type Theme struct {
	ID       bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID mongodb.ID    `bson:"churchId"      json:"churchId"`

	// Palette is a NAMED preset rather than free colour input. A church
	// choosing its own hex values produces unreadable contrast within a week,
	// and the platform then owns an accessibility problem it cannot fix
	// without overriding the church's choice.
	Palette string `bson:"palette" json:"palette"`
	// Typography is a named pairing, for the same reason.
	Typography string `bson:"typography" json:"typography"`
	// Mode is light, dark, or system.
	Mode string `bson:"mode" json:"mode"`

	LogoURL    string `bson:"logoUrl,omitempty"    json:"logoUrl,omitempty"`
	FaviconURL string `bson:"faviconUrl,omitempty" json:"faviconUrl,omitempty"`

	UpdatedAt time.Time `bson:"updatedAt" json:"updatedAt"`
}

// RenderedPage is what the public renderer consumes.
//
// Deliberately a flat, self-contained shape: the renderer is server-side (Q-13)
// and should make ONE call per page, not one per block. It also carries only
// published content, so there is no draft field a renderer could accidentally
// read.
type RenderedPage struct {
	Slug           string    `json:"slug"`
	Title          string    `json:"title"`
	SEODescription string    `json:"seoDescription,omitempty"`
	Blocks         []Block   `json:"blocks"`
	Theme          *Theme    `json:"theme,omitempty"`
	Nav            []NavItem `json:"nav"`
	// PublishedAt lets the renderer set a Last-Modified header, which is what
	// makes a church site cacheable at the edge.
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
}

// NavItem is one entry in a site's navigation.
type NavItem struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}
