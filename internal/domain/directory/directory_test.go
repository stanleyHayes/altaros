package directory

import (
	"context"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	churchdomain "github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// Every test here is about what must NOT appear.
//
// This is the one query in the product that crosses tenants and answers an
// anonymous stranger. The tenancy layer that protects everything else is
// deliberately absent, so the tests carry the weight: a church that never
// opted in, an appeal that was never published, a church that has since left
// — each of those appearing on a public marketing page is a real disclosure
// about a real congregation, not a rendering bug.

type harness struct {
	svc       *Service
	churches  *mongo.Collection
	campaigns *mongo.Collection
	ctx       context.Context
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	connect, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db, err := mongodb.Connect(connect, config.MongoConfig{
		URI: testsupport.MongoURI(), Database: "altar_test_directory",
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
	return &harness{
		svc:       NewService(db, "altaros.com"),
		churches:  db.Global(churchdomain.CollectionChurches),
		campaigns: db.Global(finance.CampaignCollection),
		ctx:       context.Background(),
	}
}

func (h *harness) addChurch(t *testing.T, name string, listed bool, extra bson.M) bson.ObjectID {
	t.Helper()
	doc := bson.M{
		"name": name, "slug": name, "city": "Accra", "country": "Ghana",
		"listedInDirectory": listed, "isActive": true,
	}
	for k, v := range extra {
		doc[k] = v
	}
	res, err := h.churches.InsertOne(h.ctx, doc)
	if err != nil {
		t.Fatalf("insert church: %v", err)
	}
	id, _ := res.InsertedID.(bson.ObjectID)
	return id
}

func (h *harness) addCampaign(t *testing.T, churchID bson.ObjectID, title string, extra bson.M) {
	t.Helper()
	doc := bson.M{
		"churchId": churchID, "title": title, "targetAmount": int64(100000),
		"currency": "GHS", "isActive": true,
		"startDate": time.Now().Add(-24 * time.Hour),
		"endDate":   time.Now().Add(30 * 24 * time.Hour),
	}
	for k, v := range extra {
		doc[k] = v
	}
	if _, err := h.campaigns.InsertOne(h.ctx, doc); err != nil {
		t.Fatalf("insert campaign: %v", err)
	}
}

func titles(campaigns []Campaign) map[string]bool {
	out := map[string]bool{}
	for _, c := range campaigns {
		out[c.Title] = true
	}
	return out
}

func names(churches []Church) map[string]bool {
	out := map[string]bool{}
	for _, c := range churches {
		out[c.Name] = true
	}
	return out
}

// THE test. A church that never asked to be listed must not be listed.
func TestOnlyOptedInChurchesAppear(t *testing.T) {
	h := newHarness(t)
	h.addChurch(t, "opted-in", true, nil)
	h.addChurch(t, "never-asked", false, nil)
	// The field absent entirely — every church that existed before the
	// directory did. Absence must read as "no".
	h.addChurch(t, "predates-the-feature", false, bson.M{"listedInDirectory": nil})

	found, err := h.svc.Churches(h.ctx)
	if err != nil {
		t.Fatalf("Churches: %v", err)
	}
	got := names(found)
	if !got["opted-in"] {
		t.Fatal("a church that opted in is missing from the directory")
	}
	if got["never-asked"] {
		t.Fatal("a church that never opted in is on our public marketing site")
	}
	if got["predates-the-feature"] {
		t.Fatal("a church with no answer recorded was treated as having said yes")
	}
}

// A suspended or deleted church must come off the marketing site.
func TestInactiveAndDeletedChurchesDropOut(t *testing.T) {
	h := newHarness(t)
	h.addChurch(t, "running", true, nil)
	h.addChurch(t, "suspended", true, bson.M{"isActive": false})
	h.addChurch(t, "deleted", true, bson.M{"deletedAt": time.Now()})

	found, err := h.svc.Churches(h.ctx)
	if err != nil {
		t.Fatalf("Churches: %v", err)
	}
	got := names(found)
	if !got["running"] {
		t.Fatal("an active listed church is missing")
	}
	if got["suspended"] {
		t.Fatal("a suspended church is still on our marketing site")
	}
	if got["deleted"] {
		t.Fatal("a deleted church is still on our marketing site")
	}
}

// The two opt-ins are separate, and BOTH are required.
func TestACampaignNeedsBothOptIns(t *testing.T) {
	h := newHarness(t)
	listed := h.addChurch(t, "listed-church", true, nil)

	h.addCampaign(t, listed, "both", bson.M{
		"listedInDirectory": true, "visibility": "public",
	})
	// Published to the public on the church's OWN site, but never offered to
	// ours. That is the common case and it must stay off.
	h.addCampaign(t, listed, "public-not-listed", bson.M{
		"listedInDirectory": false, "visibility": "public",
	})
	// Flagged for our site but never actually published anywhere. Publishing
	// it here would announce an appeal the church has not announced.
	h.addCampaign(t, listed, "listed-but-members-only", bson.M{
		"listedInDirectory": true, "visibility": "members",
	})
	h.addCampaign(t, listed, "listed-but-draft", bson.M{
		"listedInDirectory": true, "visibility": "",
	})

	found, err := h.svc.Campaigns(h.ctx, time.Now())
	if err != nil {
		t.Fatalf("Campaigns: %v", err)
	}
	got := titles(found)
	if !got["both"] {
		t.Fatal("an appeal with both opt-ins is missing")
	}
	for _, title := range []string{
		"public-not-listed", "listed-but-members-only", "listed-but-draft",
	} {
		if got[title] {
			t.Fatalf("%q reached the public directory without both opt-ins", title)
		}
	}
}

// A campaign's own flag says nothing about the CHURCH's current choice. A
// church that leaves the directory takes its appeals with it.
func TestACampaignFromAChurchThatLeftDoesNotAppear(t *testing.T) {
	h := newHarness(t)
	left := h.addChurch(t, "left-the-directory", false, nil)
	h.addCampaign(t, left, "orphaned", bson.M{
		"listedInDirectory": true, "visibility": "public",
	})

	found, err := h.svc.Campaigns(h.ctx, time.Now())
	if err != nil {
		t.Fatalf("Campaigns: %v", err)
	}
	if titles(found)["orphaned"] {
		t.Fatal("an appeal outlived its church's decision to leave the directory")
	}
}

// An appeal that has closed collects gifts toward something that ended.
func TestFinishedCampaignsDropOut(t *testing.T) {
	h := newHarness(t)
	church := h.addChurch(t, "church", true, nil)
	h.addCampaign(t, church, "running", bson.M{
		"listedInDirectory": true, "visibility": "public",
	})
	h.addCampaign(t, church, "finished", bson.M{
		"listedInDirectory": true, "visibility": "public",
		"endDate": time.Now().Add(-24 * time.Hour),
	})
	h.addCampaign(t, church, "closed", bson.M{
		"listedInDirectory": true, "visibility": "public", "isActive": false,
	})

	found, err := h.svc.Campaigns(h.ctx, time.Now())
	if err != nil {
		t.Fatalf("Campaigns: %v", err)
	}
	got := titles(found)
	if !got["running"] {
		t.Fatal("a running appeal is missing")
	}
	if got["finished"] {
		t.Fatal("an appeal past its end date is still collecting on our site")
	}
	if got["closed"] {
		t.Fatal("a closed appeal is still on our site")
	}
}

// The raised figure is the church's to reveal, on our site as much as theirs.
func TestProgressIsOmittedUnlessTheChurchShowsIt(t *testing.T) {
	h := newHarness(t)
	church := h.addChurch(t, "church", true, nil)
	h.addCampaign(t, church, "shown", bson.M{
		"listedInDirectory": true, "visibility": "public", "showProgress": true,
	})
	h.addCampaign(t, church, "hidden", bson.M{
		"listedInDirectory": true, "visibility": "public", "showProgress": false,
	})

	found, err := h.svc.Campaigns(h.ctx, time.Now())
	if err != nil {
		t.Fatalf("Campaigns: %v", err)
	}
	for _, c := range found {
		switch c.Title {
		case "shown":
			if c.CurrentAmount == nil || c.Progress == nil {
				t.Fatal("a church that shows its progress has none on our site")
			}
		case "hidden":
			// Absent, not zero: "GHS 0 raised" on a public page says something
			// about a church that a missing figure does not.
			if c.CurrentAmount != nil || c.Progress != nil {
				t.Fatal("the raised figure leaked for a church that hides it")
			}
		}
	}
}

// Every appeal must say whose it is. One without a church is indistinguishable
// from a scam.
func TestEveryListedCampaignNamesItsChurch(t *testing.T) {
	h := newHarness(t)
	church := h.addChurch(t, "grace-chapel", true, nil)
	h.addCampaign(t, church, "roof", bson.M{
		"listedInDirectory": true, "visibility": "public",
	})

	found, err := h.svc.Campaigns(h.ctx, time.Now())
	if err != nil {
		t.Fatalf("Campaigns: %v", err)
	}
	if len(found) != 1 {
		t.Fatalf("got %d appeals, want 1", len(found))
	}
	if found[0].ChurchName == "" {
		t.Fatal("an appeal on our public site does not say which church it is for")
	}
}

// Opting in and out has to actually change what the public sees.
func TestSetListedTakesEffect(t *testing.T) {
	h := newHarness(t)
	id := h.addChurch(t, "undecided", false, nil)

	listed, err := h.svc.Listed(h.ctx, id.Hex())
	if err != nil {
		t.Fatalf("Listed: %v", err)
	}
	if listed {
		t.Fatal("a church defaults to being listed")
	}

	if err := h.svc.SetListed(h.ctx, id.Hex(), true); err != nil {
		t.Fatalf("SetListed: %v", err)
	}
	if found, _ := h.svc.Churches(h.ctx); !names(found)["undecided"] {
		t.Fatal("opting in did not put the church on the directory")
	}

	if err := h.svc.SetListed(h.ctx, id.Hex(), false); err != nil {
		t.Fatalf("SetListed: %v", err)
	}
	if found, _ := h.svc.Churches(h.ctx); names(found)["undecided"] {
		t.Fatal("opting out did not take the church off the directory")
	}
}

func TestSetListedRejectsAnUnknownChurch(t *testing.T) {
	h := newHarness(t)
	if err := h.svc.SetListed(h.ctx, bson.NewObjectID().Hex(), true); err == nil {
		t.Fatal("listed a church that does not exist")
	}
	if err := h.svc.SetListed(h.ctx, "not-an-id", true); err == nil {
		t.Fatal("accepted a malformed church id")
	}
}
