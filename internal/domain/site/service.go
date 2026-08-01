package site

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Service manages a church's pages, versions and blocks.
type Service struct {
	pages    *mongodb.TenantCollection
	versions *mongodb.TenantCollection
	blocks   *mongodb.TenantCollection
	themes   *mongodb.TenantCollection
	now      func() time.Time
}

// NewService builds the site service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		pages:    db.Tenant(PageCollection),
		versions: db.Tenant(VersionCollection),
		blocks:   db.Tenant(BlockCollection),
		themes:   db.Tenant(ThemeCollection),
		now:      time.Now,
	}
}

// pageSlugPattern is what may appear in a URL path segment.
var pageSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// reservedPageSlugs are paths the renderer itself owns.
//
// A church page at /api would shadow the gateway on its own subdomain, and one
// at /sitemap.xml would replace the file search engines read. Refused for the
// same reason a church cannot take the `api` subdomain: it is a routing
// decision, not a naming one.
var reservedPageSlugs = map[string]bool{
	"api": true, "admin": true, "assets": true, "static": true,
	"sitemap": true, "robots": true, "_next": true, "health": true,
}

// EnsureIndexes creates the constraints the CMS depends on.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.pages.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// One page per address per church. Two churches may both have
			// /about; one church may not have two.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "slug", Value: 1},
			},
			Options: options.Index().SetName("uq_church_page_slug").SetUnique(true),
		},
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "inNav", Value: 1},
				{Key: "navOrder", Value: 1},
			},
			Options: options.Index().SetName("church_page_nav"),
		},
	})
	if err != nil {
		return fmt.Errorf("site: create page indexes: %w", err)
	}

	err = s.versions.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "pageId", Value: 1},
				{Key: "number", Value: -1},
			},
			Options: options.Index().SetName("church_page_version"),
		},
	})
	if err != nil {
		return fmt.Errorf("site: create version indexes: %w", err)
	}

	err = s.blocks.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			// The render query: every block of one version, in order.
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "versionId", Value: 1},
				{Key: "position", Value: 1},
			},
			Options: options.Index().SetName("church_version_block"),
		},
	})
	if err != nil {
		return fmt.Errorf("site: create block indexes: %w", err)
	}

	err = s.themes.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: mongodb.TenantField, Value: 1}},
			Options: options.Index().SetName("uq_church_theme").SetUnique(true),
		},
	})
	if err != nil {
		return fmt.Errorf("site: create theme indexes: %w", err)
	}
	return nil
}

// --- pages -----------------------------------------------------------------

// PageInput is what an editor supplies for a page.
type PageInput struct {
	Slug           string
	Title          string
	SEODescription string
	InNav          bool
	NavOrder       int
}

// CreatePage adds an address to the church's site.
//
// The page starts with an empty DRAFT version and no published one, so it
// exists in the editor and is invisible to the public until somebody publishes
// it. A page that went live the moment it was created would put an empty page
// on a church's website every time someone clicked "new".
func (s *Service) CreatePage(ctx context.Context, in PageInput) (*Page, error) {
	slug, err := normalisePageSlug(in.Slug)
	if err != nil {
		return nil, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, ErrTitleRequired
	}

	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	res, err := s.pages.InsertOne(ctx, bson.M{
		"slug":           slug,
		"title":          title,
		"seoDescription": strings.TrimSpace(in.SEODescription),
		"inNav":          in.InNav,
		"navOrder":       in.NavOrder,
		"createdAt":      now,
		"updatedAt":      now,
	})
	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrSlugTaken
		}
		return nil, fmt.Errorf("site: create page: %w", err)
	}

	pageID := res.InsertedID.(bson.ObjectID)
	version, err := s.newVersion(ctx, pageID, 1, scope.UserID, "")
	if err != nil {
		return nil, err
	}
	if _, err := s.pages.UpdateOne(ctx, bson.M{"_id": pageID},
		bson.M{"$set": bson.M{"draftVersionId": version.ID}}); err != nil {
		return nil, fmt.Errorf("site: attach draft: %w", err)
	}

	return s.PageByID(ctx, pageID.Hex())
}

// Pages lists the church's pages, in navigation order.
func (s *Service) Pages(ctx context.Context) ([]Page, error) {
	var out []Page
	err := s.pages.Find(ctx, bson.M{}, &out,
		options.Find().SetSort(bson.D{{Key: "navOrder", Value: 1}, {Key: "title", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("site: list pages: %w", err)
	}
	return out, nil
}

// PageByID returns one page within the caller's church.
func (s *Service) PageByID(ctx context.Context, id string) (*Page, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrPageNotFound
	}
	var page Page
	err = s.pages.FindOne(ctx, bson.M{"_id": oid}, &page)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrPageNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("site: read page: %w", err)
	}
	return &page, nil
}

// UpdatePage changes a page's own fields, not its content.
func (s *Service) UpdatePage(ctx context.Context, id string, in PageInput) (*Page, error) {
	page, err := s.PageByID(ctx, id)
	if err != nil {
		return nil, err
	}

	set := bson.M{"updatedAt": s.now().UTC()}
	if title := strings.TrimSpace(in.Title); title != "" {
		set["title"] = title
	}
	if in.Slug != "" {
		slug, err := normalisePageSlug(in.Slug)
		if err != nil {
			return nil, err
		}
		set["slug"] = slug
	}
	set["seoDescription"] = strings.TrimSpace(in.SEODescription)
	set["inNav"] = in.InNav
	set["navOrder"] = in.NavOrder

	if _, err := s.pages.UpdateOne(ctx, bson.M{"_id": page.ID}, bson.M{"$set": set}); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrSlugTaken
		}
		return nil, fmt.Errorf("site: update page: %w", err)
	}
	return s.PageByID(ctx, id)
}

// DeletePage removes a page and everything belonging to it.
func (s *Service) DeletePage(ctx context.Context, id string) error {
	page, err := s.PageByID(ctx, id)
	if err != nil {
		return err
	}
	// The home page is the address the subdomain itself resolves to. Deleting
	// it leaves a church whose website is a 404 at its own name.
	if page.Slug == homeSlug {
		return ErrHomePageRequired
	}

	versions, err := s.versionsOf(ctx, page.ID)
	if err != nil {
		return err
	}
	for _, version := range versions {
		if _, err := s.blocks.DeleteMany(ctx, bson.M{"versionId": version.ID}); err != nil {
			return fmt.Errorf("site: delete blocks: %w", err)
		}
	}
	if _, err := s.versions.DeleteMany(ctx, bson.M{"pageId": page.ID}); err != nil {
		return fmt.Errorf("site: delete versions: %w", err)
	}
	if _, err := s.pages.DeleteOne(ctx, bson.M{"_id": page.ID}); err != nil {
		return fmt.Errorf("site: delete page: %w", err)
	}
	return nil
}

// homeSlug is the page a bare subdomain resolves to.
const homeSlug = "home"

// --- the draft ---------------------------------------------------------------

// EditableVersion returns the version an editor may write to, forking one if
// the current draft is live.
//
// This is the rule the whole versioning model rests on. After publishing, the
// draft and published pointers refer to the SAME version — so the next edit has
// to fork, or it silently changes the live website while somebody believes they
// are drafting.
//
// Forking copies the blocks. That is the one multi-row operation in this
// design, and it is deliberately here rather than in publish or rollback,
// because a half-finished fork leaves an unpublished draft in a bad state — an
// inconvenience — whereas a half-finished publish leaves the live site in one.
func (s *Service) EditableVersion(ctx context.Context, pageID string) (*Version, error) {
	page, err := s.PageByID(ctx, pageID)
	if err != nil {
		return nil, err
	}

	// A draft that is not the published version is already private. Write to it.
	if !page.DraftVersionID.IsZero() && page.DraftVersionID != page.PublishedVersionID {
		return s.versionByID(ctx, page.DraftVersionID)
	}

	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}

	next, err := s.nextVersionNumber(ctx, page.ID)
	if err != nil {
		return nil, err
	}
	fresh, err := s.newVersion(ctx, page.ID, next, scope.UserID, "")
	if err != nil {
		return nil, err
	}

	// Copy the live blocks so the editor starts from what is on the site
	// rather than from nothing.
	if !page.PublishedVersionID.IsZero() {
		if err := s.copyBlocks(ctx, page.PublishedVersionID, fresh.ID); err != nil {
			return nil, err
		}
	}

	if _, err := s.pages.UpdateOne(ctx, bson.M{"_id": page.ID},
		bson.M{"$set": bson.M{"draftVersionId": fresh.ID, "updatedAt": s.now().UTC()}}); err != nil {
		return nil, fmt.Errorf("site: attach forked draft: %w", err)
	}
	return fresh, nil
}

// SetBlocks replaces the draft's content in one call.
//
// Whole-list rather than per-block edits: an editor rearranging sections
// produces one intent, and applying it as a series of moves is where ordering
// bugs live. Positions are re-spaced to 10, 20, 30 on the way in, so inserting
// between two blocks later is one write.
func (s *Service) SetBlocks(ctx context.Context, pageID string, blocks []BlockInput) ([]Block, error) {
	version, err := s.EditableVersion(ctx, pageID)
	if err != nil {
		return nil, err
	}

	// Validate EVERYTHING before writing anything. A page half-saved because
	// the ninth section was malformed is worse than a refused save.
	type prepared struct {
		blockType BlockType
		data      map[string]any
	}
	ready := make([]prepared, 0, len(blocks))
	for i, in := range blocks {
		data, err := ValidateBlock(in.Type, in.Data)
		if err != nil {
			return nil, fmt.Errorf("section %d (%s): %w", i+1, in.Type, err)
		}
		ready = append(ready, prepared{blockType: in.Type, data: data})
	}

	if _, err := s.blocks.DeleteMany(ctx, bson.M{"versionId": version.ID}); err != nil {
		return nil, fmt.Errorf("site: clear draft blocks: %w", err)
	}
	for i, item := range ready {
		if _, err := s.blocks.InsertOne(ctx, bson.M{
			"versionId": version.ID,
			"type":      string(item.blockType),
			"position":  (i + 1) * 10,
			"data":      item.data,
		}); err != nil {
			return nil, fmt.Errorf("site: write block %d: %w", i+1, err)
		}
	}

	if _, err := s.pages.UpdateOne(ctx, bson.M{"_id": version.PageID},
		bson.M{"$set": bson.M{"updatedAt": s.now().UTC()}}); err != nil {
		return nil, fmt.Errorf("site: touch page: %w", err)
	}
	return s.BlocksOf(ctx, version.ID.Hex())
}

// BlockInput is one section as an editor submits it.
type BlockInput struct {
	Type BlockType
	Data map[string]any
}

// BlocksOf returns one version's blocks, in render order.
func (s *Service) BlocksOf(ctx context.Context, versionID string) ([]Block, error) {
	oid, err := bson.ObjectIDFromHex(versionID)
	if err != nil {
		return nil, ErrVersionNotFound
	}
	var out []Block
	err = s.blocks.Find(ctx, bson.M{"versionId": oid}, &out,
		options.Find().SetSort(bson.D{{Key: "position", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("site: read blocks: %w", err)
	}
	if out == nil {
		out = []Block{}
	}
	return out, nil
}

// --- publishing ---------------------------------------------------------------

// Publish makes the draft live.
//
// One field. Everything else this function does is bookkeeping around a single
// atomic pointer move, which is what makes publishing impossible to half-apply:
// the site is showing the old version, and then it is showing the new one.
func (s *Service) Publish(ctx context.Context, pageID, note string) (*Page, error) {
	page, err := s.PageByID(ctx, pageID)
	if err != nil {
		return nil, err
	}
	if page.DraftVersionID.IsZero() {
		return nil, ErrVersionNotFound
	}
	if page.DraftVersionID == page.PublishedVersionID {
		return nil, ErrNothingToPublish
	}

	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()

	// The version that was live becomes archived rather than deleted —
	// rollback is the point of versioning, and deleting the previous version
	// removes the thing you would roll back to.
	if !page.PublishedVersionID.IsZero() {
		if _, err := s.versions.UpdateOne(ctx,
			bson.M{"_id": page.PublishedVersionID},
			bson.M{"$set": bson.M{"status": string(StatusArchived)}}); err != nil {
			return nil, fmt.Errorf("site: archive previous version: %w", err)
		}
	}

	if _, err := s.versions.UpdateOne(ctx, bson.M{"_id": page.DraftVersionID}, bson.M{
		"$set": bson.M{
			"status":      string(StatusPublished),
			"publishedAt": now,
			"publishedBy": mongodb.ID(scope.UserID),
			"note":        strings.TrimSpace(note),
		},
	}); err != nil {
		return nil, fmt.Errorf("site: mark version published: %w", err)
	}

	// The pointer move. After this the public sees the new content.
	if _, err := s.pages.UpdateOne(ctx, bson.M{"_id": page.ID}, bson.M{
		"$set": bson.M{"publishedVersionId": page.DraftVersionID, "updatedAt": now},
	}); err != nil {
		return nil, fmt.Errorf("site: publish: %w", err)
	}
	return s.PageByID(ctx, pageID)
}

// Rollback points the live site at an earlier version.
//
// The same single pointer move as publishing, which is why it is instant and
// why it cannot half-apply. The draft is left pointing at the restored version
// too, so the next edit forks from what is now live rather than from the
// version somebody just decided was wrong.
func (s *Service) Rollback(ctx context.Context, pageID, versionID string) (*Page, error) {
	page, err := s.PageByID(ctx, pageID)
	if err != nil {
		return nil, err
	}
	target, err := s.versionByIDString(ctx, versionID)
	if err != nil {
		return nil, err
	}
	if target.PageID != page.ID {
		// A version of another page. Refused rather than applied — the tenant
		// wrapper already stops this crossing churches, and this stops it
		// crossing pages within one.
		return nil, ErrVersionNotFound
	}
	if target.ID == page.PublishedVersionID {
		return nil, ErrNothingToPublish
	}

	now := s.now().UTC()
	if !page.PublishedVersionID.IsZero() {
		if _, err := s.versions.UpdateOne(ctx, bson.M{"_id": page.PublishedVersionID},
			bson.M{"$set": bson.M{"status": string(StatusArchived)}}); err != nil {
			return nil, fmt.Errorf("site: archive current version: %w", err)
		}
	}
	if _, err := s.versions.UpdateOne(ctx, bson.M{"_id": target.ID},
		bson.M{"$set": bson.M{"status": string(StatusPublished), "publishedAt": now}}); err != nil {
		return nil, fmt.Errorf("site: restore version: %w", err)
	}
	if _, err := s.pages.UpdateOne(ctx, bson.M{"_id": page.ID}, bson.M{
		"$set": bson.M{
			"publishedVersionId": target.ID,
			"draftVersionId":     target.ID,
			"updatedAt":          now,
		},
	}); err != nil {
		return nil, fmt.Errorf("site: rollback: %w", err)
	}
	return s.PageByID(ctx, pageID)
}

// Unpublish takes a page off the public site without deleting it.
func (s *Service) Unpublish(ctx context.Context, pageID string) (*Page, error) {
	page, err := s.PageByID(ctx, pageID)
	if err != nil {
		return nil, err
	}
	if !page.IsPublished() {
		return nil, ErrNotPublished
	}
	if page.Slug == homeSlug {
		return nil, ErrHomePageRequired
	}

	if _, err := s.pages.UpdateOne(ctx, bson.M{"_id": page.ID}, bson.M{
		"$unset": bson.M{"publishedVersionId": ""},
		"$set":   bson.M{"updatedAt": s.now().UTC()},
	}); err != nil {
		return nil, fmt.Errorf("site: unpublish: %w", err)
	}
	return s.PageByID(ctx, pageID)
}

// Versions lists a page's history, newest first.
func (s *Service) Versions(ctx context.Context, pageID string) ([]Version, error) {
	oid, err := bson.ObjectIDFromHex(pageID)
	if err != nil {
		return nil, ErrPageNotFound
	}
	return s.versionsOf(ctx, oid)
}

// --- rendering ---------------------------------------------------------------

// Render returns a published page for the public site.
//
// PUBLISHED only, and there is no parameter that could change that. A renderer
// that could be asked for a draft is one query-string away from putting a
// half-written page in front of a congregation.
func (s *Service) Render(ctx context.Context, slug string) (*RenderedPage, error) {
	normalised := slug
	if strings.TrimSpace(normalised) == "" {
		normalised = homeSlug
	}

	var page Page
	err := s.pages.FindOne(ctx, bson.M{
		"slug":               normalised,
		"publishedVersionId": bson.M{"$exists": true},
	}, &page)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrPageNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("site: render lookup: %w", err)
	}

	blocks, err := s.BlocksOf(ctx, page.PublishedVersionID.Hex())
	if err != nil {
		return nil, err
	}

	nav, err := s.nav(ctx)
	if err != nil {
		return nil, err
	}

	rendered := &RenderedPage{
		Slug:           page.Slug,
		Title:          page.Title,
		SEODescription: page.SEODescription,
		Blocks:         blocks,
		Nav:            nav,
	}
	if version, err := s.versionByID(ctx, page.PublishedVersionID); err == nil {
		rendered.PublishedAt = version.PublishedAt
	}
	if theme, err := s.Theme(ctx); err == nil {
		rendered.Theme = theme
	}
	return rendered, nil
}

// nav is the published, navigation-listed pages.
//
// Unpublished pages are excluded, so a page being drafted does not appear in
// the menu of a live site and 404 when somebody clicks it.
func (s *Service) nav(ctx context.Context) ([]NavItem, error) {
	var pages []Page
	err := s.pages.Find(ctx, bson.M{
		"inNav":              true,
		"publishedVersionId": bson.M{"$exists": true},
	}, &pages, options.Find().SetSort(bson.D{{Key: "navOrder", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("site: nav: %w", err)
	}

	items := make([]NavItem, 0, len(pages))
	for _, p := range pages {
		items = append(items, NavItem{Slug: p.Slug, Title: p.Title})
	}
	return items, nil
}

// --- theme -------------------------------------------------------------------

// Theme returns the church's theme, or the default.
func (s *Service) Theme(ctx context.Context) (*Theme, error) {
	var theme Theme
	err := s.themes.FindOne(ctx, bson.M{}, &theme)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return defaultTheme(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("site: read theme: %w", err)
	}
	return &theme, nil
}

// SetTheme updates the church's visual identity.
func (s *Service) SetTheme(ctx context.Context, in Theme) (*Theme, error) {
	set := bson.M{
		"palette":    presetOr(in.Palette, palettes, "warm"),
		"typography": presetOr(in.Typography, typographies, "classic"),
		"mode":       presetOr(in.Mode, modes, "light"),
		"updatedAt":  s.now().UTC(),
	}
	for key, raw := range map[string]string{"logoUrl": in.LogoURL, "faviconUrl": in.FaviconURL} {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		validated, err := ValidateURL(raw)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", key, err)
		}
		set[key] = validated
	}

	if _, err := s.themes.UpsertOne(ctx, bson.M{}, bson.M{"$set": set}); err != nil {
		return nil, fmt.Errorf("site: save theme: %w", err)
	}
	return s.Theme(ctx)
}

// Named presets, not free input (see the Theme doc comment).
var (
	palettes     = map[string]bool{"warm": true, "deep": true, "forest": true, "slate": true, "royal": true}
	typographies = map[string]bool{"classic": true, "modern": true, "editorial": true}
	modes        = map[string]bool{"light": true, "dark": true, "system": true}
)

func presetOr(value string, allowed map[string]bool, fallback string) string {
	v := strings.ToLower(strings.TrimSpace(value))
	if allowed[v] {
		return v
	}
	return fallback
}

func defaultTheme() *Theme {
	return &Theme{Palette: "warm", Typography: "classic", Mode: "light"}
}

// --- internals ---------------------------------------------------------------

func (s *Service) newVersion(ctx context.Context, pageID bson.ObjectID, number int, createdBy, note string) (*Version, error) {
	res, err := s.versions.InsertOne(ctx, bson.M{
		"pageId":    pageID,
		"number":    number,
		"status":    string(StatusDraft),
		"note":      strings.TrimSpace(note),
		"createdBy": mongodb.ID(createdBy),
		"createdAt": s.now().UTC(),
	})
	if err != nil {
		return nil, fmt.Errorf("site: create version: %w", err)
	}
	return s.versionByID(ctx, res.InsertedID.(bson.ObjectID))
}

func (s *Service) versionByID(ctx context.Context, id bson.ObjectID) (*Version, error) {
	var version Version
	err := s.versions.FindOne(ctx, bson.M{"_id": id}, &version)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrVersionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("site: read version: %w", err)
	}
	return &version, nil
}

func (s *Service) versionByIDString(ctx context.Context, id string) (*Version, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrVersionNotFound
	}
	return s.versionByID(ctx, oid)
}

func (s *Service) versionsOf(ctx context.Context, pageID bson.ObjectID) ([]Version, error) {
	var out []Version
	err := s.versions.Find(ctx, bson.M{"pageId": pageID}, &out,
		options.Find().SetSort(bson.D{{Key: "number", Value: -1}}))
	if err != nil {
		return nil, fmt.Errorf("site: list versions: %w", err)
	}
	if out == nil {
		out = []Version{}
	}
	return out, nil
}

func (s *Service) nextVersionNumber(ctx context.Context, pageID bson.ObjectID) (int, error) {
	versions, err := s.versionsOf(ctx, pageID)
	if err != nil {
		return 0, err
	}
	if len(versions) == 0 {
		return 1, nil
	}
	// Sorted newest first.
	return versions[0].Number + 1, nil
}

func (s *Service) copyBlocks(ctx context.Context, from, to bson.ObjectID) error {
	source, err := s.BlocksOf(ctx, from.Hex())
	if err != nil {
		return err
	}
	for _, block := range source {
		if _, err := s.blocks.InsertOne(ctx, bson.M{
			"versionId": to,
			"type":      string(block.Type),
			"position":  block.Position,
			"data":      block.Data,
		}); err != nil {
			return fmt.Errorf("site: copy block: %w", err)
		}
	}
	return nil
}

// normalisePageSlug validates a page address.
func normalisePageSlug(raw string) (string, error) {
	slug := strings.ToLower(strings.TrimSpace(raw))
	slug = strings.Trim(slug, "/")
	if slug == "" {
		// A bare subdomain resolves to the home page, so an empty slug is the
		// home page rather than an error.
		return homeSlug, nil
	}
	if len(slug) > 80 || !pageSlugPattern.MatchString(slug) {
		return "", fmt.Errorf("%w: use letters, numbers and hyphens", ErrSlugInvalid)
	}
	if reservedPageSlugs[slug] {
		return "", fmt.Errorf("%w: %q is used by the platform", ErrSlugInvalid, slug)
	}
	return slug, nil
}
