package site

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

var (
	churchA = bson.NewObjectID().Hex()
	churchB = bson.NewObjectID().Hex()
)

type harness struct {
	svc *Service
	db  *mongodb.DB
	ctx context.Context
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	connectCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            testsupport.MongoURI(),
		Database:       "altar_test_site",
		ConnectTimeout: 5 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	svc := NewService(db)
	ctx := scopeOf(churchA)
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	return &harness{svc: svc, db: db, ctx: ctx}
}

func scopeOf(churchID string) context.Context {
	return tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID,
		UserID:   bson.NewObjectID().Hex(),
		Role:     "CHURCH_ADMIN",
	})
}

// paragraph is a minimal valid rich-text block.
func paragraph(text string) BlockInput {
	return BlockInput{
		Type: BlockRichText,
		Data: map[string]any{"content": []any{
			map[string]any{
				"type":  "paragraph",
				"spans": []any{map[string]any{"text": text}},
			},
		}},
	}
}

// --- the property the whole model rests on ---------------------------------

// TestEditingAPublishedPageDoesNotChangeTheLiveSite is the one that justifies
// versioning at the page.
//
// After publishing, the draft and published pointers refer to the SAME version.
// The next edit must fork — otherwise somebody who believes they are drafting
// is editing the church's live website in front of its congregation.
func TestEditingAPublishedPageDoesNotChangeTheLiveSite(t *testing.T) {
	h := newHarness(t)

	page, err := h.svc.CreatePage(h.ctx, PageInput{Slug: "about", Title: "About us"})
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	if _, err := h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{
		paragraph("We meet on Sundays."),
	}); err != nil {
		t.Fatalf("SetBlocks: %v", err)
	}
	if _, err := h.svc.Publish(h.ctx, page.ID.Hex(), "first"); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	// Now edit. This must fork rather than touch what is live.
	if _, err := h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{
		paragraph("DRAFT — do not publish yet"),
	}); err != nil {
		t.Fatalf("SetBlocks after publish: %v", err)
	}

	live, err := h.svc.Render(h.ctx, "about")
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if len(live.Blocks) != 1 {
		t.Fatalf("live page has %d blocks, want 1", len(live.Blocks))
	}
	rendered := firstText(t, live.Blocks[0])
	if rendered != "We meet on Sundays." {
		t.Fatalf("the live site shows %q — an unpublished edit reached the "+
			"public website", rendered)
	}

	// And the page reports that there is something to publish.
	reloaded, err := h.svc.PageByID(h.ctx, page.ID.Hex())
	if err != nil {
		t.Fatalf("PageByID: %v", err)
	}
	if !reloaded.HasUnpublishedChanges() {
		t.Error("the page should report unpublished edits")
	}
}

// A forked draft starts from what is LIVE, not from nothing — otherwise
// clicking edit on a finished page presents a blank one.
func TestAForkedDraftStartsFromTheLiveContent(t *testing.T) {
	h := newHarness(t)

	page, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "visit", Title: "Plan a visit"})
	if _, err := h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{
		paragraph("Parking is behind the building."),
		paragraph("Come as you are."),
	}); err != nil {
		t.Fatalf("SetBlocks: %v", err)
	}
	if _, err := h.svc.Publish(h.ctx, page.ID.Hex(), ""); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	version, err := h.svc.EditableVersion(h.ctx, page.ID.Hex())
	if err != nil {
		t.Fatalf("EditableVersion: %v", err)
	}
	blocks, err := h.svc.BlocksOf(h.ctx, version.ID.Hex())
	if err != nil {
		t.Fatalf("BlocksOf: %v", err)
	}
	if len(blocks) != 2 {
		t.Fatalf("the forked draft has %d blocks, want the 2 that are live", len(blocks))
	}
}

// --- publish and rollback --------------------------------------------------

func TestPublishThenRollbackRestoresTheEarlierPage(t *testing.T) {
	h := newHarness(t)

	page, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "news", Title: "News"})

	// Version 1.
	_, _ = h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{paragraph("Original")})
	if _, err := h.svc.Publish(h.ctx, page.ID.Hex(), "v1"); err != nil {
		t.Fatalf("publish v1: %v", err)
	}
	versions, _ := h.svc.Versions(h.ctx, page.ID.Hex())
	firstVersion := versions[0].ID

	// Version 2.
	_, _ = h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{paragraph("Replacement")})
	if _, err := h.svc.Publish(h.ctx, page.ID.Hex(), "v2"); err != nil {
		t.Fatalf("publish v2: %v", err)
	}

	live, _ := h.svc.Render(h.ctx, "news")
	if got := firstText(t, live.Blocks[0]); got != "Replacement" {
		t.Fatalf("after publishing v2 the site shows %q", got)
	}

	// Roll back.
	if _, err := h.svc.Rollback(h.ctx, page.ID.Hex(), firstVersion.Hex()); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	live, _ = h.svc.Render(h.ctx, "news")
	if got := firstText(t, live.Blocks[0]); got != "Original" {
		t.Fatalf("after rollback the site shows %q, want the original", got)
	}
}

// The version that was live is ARCHIVED, not deleted — deleting it removes the
// thing you would roll back to.
func TestPublishingKeepsThePreviousVersion(t *testing.T) {
	h := newHarness(t)

	page, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "give", Title: "Give"})
	_, _ = h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{paragraph("One")})
	_, _ = h.svc.Publish(h.ctx, page.ID.Hex(), "")
	_, _ = h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{paragraph("Two")})
	_, _ = h.svc.Publish(h.ctx, page.ID.Hex(), "")

	versions, err := h.svc.Versions(h.ctx, page.ID.Hex())
	if err != nil {
		t.Fatalf("Versions: %v", err)
	}
	if len(versions) < 2 {
		t.Fatalf("got %d versions, want at least 2 — history is what rollback "+
			"restores from", len(versions))
	}

	var archived int
	for _, v := range versions {
		if v.Status == StatusArchived {
			archived++
		}
	}
	if archived == 0 {
		t.Error("no version was archived; the superseded one should be kept")
	}
}

func TestPublishingNothingIsRefused(t *testing.T) {
	h := newHarness(t)

	page, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "empty", Title: "Empty"})
	_, _ = h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{paragraph("x")})
	_, _ = h.svc.Publish(h.ctx, page.ID.Hex(), "")

	if _, err := h.svc.Publish(h.ctx, page.ID.Hex(), ""); !errors.Is(err, ErrNothingToPublish) {
		t.Fatalf("got %v, want ErrNothingToPublish", err)
	}
}

// A version of another page must not be restorable onto this one. The tenant
// wrapper stops this crossing churches; this stops it crossing pages.
func TestRollbackRefusesAnotherPagesVersion(t *testing.T) {
	h := newHarness(t)

	one, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "one", Title: "One"})
	_, _ = h.svc.SetBlocks(h.ctx, one.ID.Hex(), []BlockInput{paragraph("One")})
	_, _ = h.svc.Publish(h.ctx, one.ID.Hex(), "")
	oneVersions, _ := h.svc.Versions(h.ctx, one.ID.Hex())

	two, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "two", Title: "Two"})
	_, _ = h.svc.SetBlocks(h.ctx, two.ID.Hex(), []BlockInput{paragraph("Two")})
	_, _ = h.svc.Publish(h.ctx, two.ID.Hex(), "")

	if _, err := h.svc.Rollback(h.ctx, two.ID.Hex(), oneVersions[0].ID.Hex()); !errors.Is(err, ErrVersionNotFound) {
		t.Fatalf("got %v, want ErrVersionNotFound", err)
	}
}

// --- what the public can see ------------------------------------------------

// A page that has never been published is invisible, and a new page starts
// that way — otherwise clicking "new page" puts an empty page on a church's
// website.
func TestAnUnpublishedPageIsInvisible(t *testing.T) {
	h := newHarness(t)

	page, err := h.svc.CreatePage(h.ctx, PageInput{Slug: "secret", Title: "Secret", InNav: true})
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	if page.IsPublished() {
		t.Error("a brand-new page must not be live")
	}

	if _, err := h.svc.Render(h.ctx, "secret"); !errors.Is(err, ErrPageNotFound) {
		t.Fatalf("Render of an unpublished page = %v, want ErrPageNotFound", err)
	}
}

// An unpublished page must not appear in the navigation either — a menu entry
// that 404s is worse than no entry.
func TestTheNavigationExcludesUnpublishedPages(t *testing.T) {
	h := newHarness(t)

	home, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "home", Title: "Home", InNav: true, NavOrder: 10})
	_, _ = h.svc.SetBlocks(h.ctx, home.ID.Hex(), []BlockInput{paragraph("Welcome")})
	_, _ = h.svc.Publish(h.ctx, home.ID.Hex(), "")

	// Created, in the nav, never published.
	_, _ = h.svc.CreatePage(h.ctx, PageInput{Slug: "draft-page", Title: "Draft", InNav: true, NavOrder: 20})

	rendered, err := h.svc.Render(h.ctx, "")
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, item := range rendered.Nav {
		if item.Slug == "draft-page" {
			t.Fatal("an unpublished page appeared in the navigation; clicking it 404s")
		}
	}
}

// Unpublishing takes a page off the site and keeps the work.
func TestUnpublishHidesThePageButKeepsIt(t *testing.T) {
	h := newHarness(t)

	page, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "old", Title: "Old"})
	_, _ = h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{paragraph("Old news")})
	_, _ = h.svc.Publish(h.ctx, page.ID.Hex(), "")

	if _, err := h.svc.Unpublish(h.ctx, page.ID.Hex()); err != nil {
		t.Fatalf("Unpublish: %v", err)
	}
	if _, err := h.svc.Render(h.ctx, "old"); !errors.Is(err, ErrPageNotFound) {
		t.Fatalf("Render after unpublish = %v, want ErrPageNotFound", err)
	}
	if _, err := h.svc.PageByID(h.ctx, page.ID.Hex()); err != nil {
		t.Fatalf("the page itself should still exist: %v", err)
	}
}

// --- tenancy ----------------------------------------------------------------

// Two churches may both have /about, and neither can see the other's.
func TestTwoChurchesHaveSeparateSites(t *testing.T) {
	h := newHarness(t)
	other := scopeOf(churchB)
	if err := h.svc.EnsureIndexes(other); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}

	for ctx, text := range map[context.Context]string{
		h.ctx: "Grace Chapel welcomes you",
		other: "Living Word welcomes you",
	} {
		page, err := h.svc.CreatePage(ctx, PageInput{Slug: "about", Title: "About"})
		if err != nil {
			t.Fatalf("CreatePage: %v", err)
		}
		if _, err := h.svc.SetBlocks(ctx, page.ID.Hex(), []BlockInput{paragraph(text)}); err != nil {
			t.Fatalf("SetBlocks: %v", err)
		}
		if _, err := h.svc.Publish(ctx, page.ID.Hex(), ""); err != nil {
			t.Fatalf("Publish: %v", err)
		}
	}

	a, err := h.svc.Render(h.ctx, "about")
	if err != nil {
		t.Fatalf("Render A: %v", err)
	}
	b, err := h.svc.Render(other, "about")
	if err != nil {
		t.Fatalf("Render B: %v", err)
	}
	if firstText(t, a.Blocks[0]) == firstText(t, b.Blocks[0]) {
		t.Fatal("both churches rendered the same content from /about")
	}

	// And one church's page list does not include the other's.
	pages, _ := h.svc.Pages(h.ctx)
	if len(pages) != 1 {
		t.Fatalf("church A sees %d pages, want 1", len(pages))
	}
}

// --- validation --------------------------------------------------------------

func TestAPageAddressMustBeUsableInAURL(t *testing.T) {
	h := newHarness(t)

	for _, slug := range []string{"About Us", "about/us", "about?x=1", "../etc"} {
		if _, err := h.svc.CreatePage(h.ctx, PageInput{Slug: slug, Title: "x"}); !errors.Is(err, ErrSlugInvalid) {
			t.Errorf("CreatePage(%q) = %v, want ErrSlugInvalid", slug, err)
		}
	}
	// Paths the renderer itself owns.
	for _, slug := range []string{"api", "sitemap", "robots", "admin"} {
		if _, err := h.svc.CreatePage(h.ctx, PageInput{Slug: slug, Title: "x"}); !errors.Is(err, ErrSlugInvalid) {
			t.Errorf("CreatePage(%q) = %v, want ErrSlugInvalid — it would shadow "+
				"the renderer's own path", slug, err)
		}
	}
}

func TestTwoPagesCannotShareAnAddress(t *testing.T) {
	h := newHarness(t)

	if _, err := h.svc.CreatePage(h.ctx, PageInput{Slug: "about", Title: "About"}); err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	if _, err := h.svc.CreatePage(h.ctx, PageInput{Slug: "about", Title: "About again"}); !errors.Is(err, ErrSlugTaken) {
		t.Fatalf("got %v, want ErrSlugTaken", err)
	}
}

// A church's site must keep an address for its own subdomain to resolve to.
func TestTheHomePageCannotBeRemoved(t *testing.T) {
	h := newHarness(t)

	page, err := h.svc.CreatePage(h.ctx, PageInput{Slug: "", Title: "Home"})
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	if page.Slug != "home" {
		t.Fatalf("an empty slug became %q, want home", page.Slug)
	}
	if err := h.svc.DeletePage(h.ctx, page.ID.Hex()); !errors.Is(err, ErrHomePageRequired) {
		t.Fatalf("got %v, want ErrHomePageRequired", err)
	}
}

// A page half-saved because the ninth section was malformed is worse than a
// refused save.
func TestOneBadSectionRejectsTheWholeSave(t *testing.T) {
	h := newHarness(t)

	page, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "mixed", Title: "Mixed"})
	_, _ = h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{paragraph("Good")})

	_, err := h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{
		paragraph("Still good"),
		{Type: BlockLiveStream, Data: map[string]any{"url": "javascript:alert(1)"}},
	})
	if err == nil {
		t.Fatal("a hostile section was accepted")
	}

	version, _ := h.svc.EditableVersion(h.ctx, page.ID.Hex())
	blocks, _ := h.svc.BlocksOf(h.ctx, version.ID.Hex())
	if len(blocks) != 1 {
		t.Fatalf("the draft now has %d blocks; the refused save should have "+
			"changed nothing", len(blocks))
	}
	if firstText(t, blocks[0]) != "Good" {
		t.Error("the refused save partially applied")
	}
}

// Positions are re-spaced on save so inserting between two blocks later is one
// write rather than renumbering the page.
func TestBlockPositionsAreSparse(t *testing.T) {
	h := newHarness(t)

	page, _ := h.svc.CreatePage(h.ctx, PageInput{Slug: "ordered", Title: "Ordered"})
	blocks, err := h.svc.SetBlocks(h.ctx, page.ID.Hex(), []BlockInput{
		paragraph("First"), paragraph("Second"), paragraph("Third"),
	})
	if err != nil {
		t.Fatalf("SetBlocks: %v", err)
	}
	if len(blocks) != 3 {
		t.Fatalf("got %d blocks, want 3", len(blocks))
	}
	for i, block := range blocks {
		want := (i + 1) * 10
		if block.Position != want {
			t.Errorf("block %d position = %d, want %d", i, block.Position, want)
		}
	}
}

// firstText digs the first text run out of a rich-text block.
//
// The type switch is not defensive padding. Block.Data is map[string]any, and
// the driver decodes an embedded document into that as bson.D — an ORDERED
// slice of key/value pairs, not a map. An earlier version of this helper only
// handled bson.M, returned "" for everything, and made four tests fail while
// reporting that unpublished edits had reached the live site. The data was
// correct the whole time; the helper reading it was not, and a test that lies
// in that direction is worse than no test.
func firstText(t *testing.T, block Block) string {
	t.Helper()

	content, ok := block.Data["content"]
	if !ok {
		t.Fatalf("block %s has no content", block.Type)
	}

	nodes := asSlice(content)
	if len(nodes) == 0 {
		return ""
	}
	spans := asSlice(field(nodes[0], "spans"))
	if len(spans) == 0 {
		return ""
	}
	text, _ := field(spans[0], "text").(string)
	return text
}

// asSlice reads a BSON array however the driver decoded it.
func asSlice(v any) []any {
	switch typed := v.(type) {
	case bson.A:
		return typed
	case []any:
		return typed
	case []Node:
		// The in-memory form, before a round trip.
		out := make([]any, len(typed))
		for i, n := range typed {
			out[i] = n
		}
		return out
	case []Span:
		out := make([]any, len(typed))
		for i, s := range typed {
			out[i] = s
		}
		return out
	}
	return nil
}

// field reads one key out of a decoded BSON document, in either shape.
func field(doc any, key string) any {
	switch typed := doc.(type) {
	case bson.D:
		for _, e := range typed {
			if e.Key == key {
				return e.Value
			}
		}
	case bson.M:
		return typed[key]
	case map[string]any:
		return typed[key]
	case Node:
		if key == "spans" {
			return typed.Spans
		}
	case Span:
		if key == "text" {
			return typed.Text
		}
	}
	return nil
}
