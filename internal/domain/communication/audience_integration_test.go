package communication

import (
	"context"
	"fmt"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// WP-22 acceptance: "a broadcast to 'inactive members in the youth department,
// Accra branch' resolves the correct set and reports cost before send."
//
// Against a real MongoDB, because the filter is a query — a fake store would
// prove the struct is built correctly and nothing about whether it selects the
// right people.

type stubSender struct {
	sent []notification.Message
	// suppress names members the notification service refuses, standing in for
	// a consent refusal without this package having to know how consent works.
	suppress map[string]bool
}

func (s *stubSender) Send(_ context.Context, msg notification.Message) (*notification.Notification, error) {
	s.sent = append(s.sent, msg)
	if s.suppress[msg.MemberID] {
		return &notification.Notification{Status: notification.StatusSuppressed}, nil
	}
	return &notification.Notification{Status: notification.StatusSent}, nil
}

type stubRates struct {
	rate       money.Amount
	configured bool
}

func (r stubRates) MessagingRate(context.Context, string) (money.Amount, bool, error) {
	return r.rate, r.configured, nil
}

type fixture struct {
	svc      *Service
	ctx      context.Context
	db       *mongodb.DB
	sender   *stubSender
	churchID string
	youth    bson.ObjectID
	choir    bson.ObjectID
}

func newFixture(t *testing.T, rates Rates) *fixture {
	t.Helper()

	uri := testsupport.MongoURI()
	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_communication",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB at "+uri, err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	churchID := bson.NewObjectID().Hex()
	ctx := tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID,
		UserID:   bson.NewObjectID().Hex(),
	})

	sender := &stubSender{suppress: map[string]bool{}}
	if rates == nil {
		rates = stubRates{}
	}
	svc := NewService(db, sender, rates)
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("indexes: %v", err)
	}

	f := &fixture{
		svc: svc, ctx: ctx, db: db, sender: sender, churchID: churchID,
		youth: bson.NewObjectID(), choir: bson.NewObjectID(),
	}
	for id, name := range map[bson.ObjectID]string{f.youth: "Youth", f.choir: "Choir"} {
		if _, err := db.Global("departments").InsertOne(ctx, bson.M{
			"_id": id, "churchId": bson.ObjectID{}, "name": name,
		}); err != nil {
			t.Fatalf("department %s: %v", name, err)
		}
		// Written unscoped above so the id is fixed, then stamped with the
		// tenant the wrapper expects.
		if _, err := db.Global("departments").UpdateOne(ctx, bson.M{"_id": id},
			bson.M{"$set": bson.M{"churchId": mustOID(t, churchID)}}); err != nil {
			t.Fatalf("stamp department: %v", err)
		}
	}
	return f
}

func mustOID(t *testing.T, hex string) bson.ObjectID {
	t.Helper()
	oid, err := bson.ObjectIDFromHex(hex)
	if err != nil {
		t.Fatalf("bad id %q: %v", hex, err)
	}
	return oid
}

// person adds a member and returns their id.
func (f *fixture) person(t *testing.T, name string, status member.Status,
	departments []bson.ObjectID, phone string) string {
	t.Helper()

	doc := bson.M{
		"firstName": name,
		"lastName":  "Test",
		"status":    string(status),
	}
	if phone != "" {
		doc["phoneE164"] = phone
	}
	if len(departments) > 0 {
		doc["departmentIds"] = departments
	}
	res, err := f.db.Tenant(member.Collection).InsertOne(f.ctx, doc)
	if err != nil {
		t.Fatalf("member %s: %v", name, err)
	}
	return res.InsertedID.(bson.ObjectID).Hex()
}

// attended records somebody present at a time.
func (f *fixture) attended(t *testing.T, memberID string, at time.Time) {
	t.Helper()
	if _, err := f.db.Tenant("attendance").InsertOne(f.ctx, bson.M{
		"eventId": bson.NewObjectID(), "memberId": memberID,
		"occurrenceAt": at, "checkedInAt": at, "recordedAt": at,
	}); err != nil {
		t.Fatalf("attendance: %v", err)
	}
}

// gave records a completed gift at a time.
func (f *fixture) gave(t *testing.T, memberID string, at time.Time) {
	t.Helper()
	// finance.StatusSuccess, not a literal. This fixture wrote "completed",
	// which the system never writes — so it agreed with a bug in the code and
	// the test passed while the giving half of activity filtering matched
	// nothing. A fixture that invents its own values is not testing the system.
	if _, err := f.db.Tenant("transactions").InsertOne(f.ctx, bson.M{
		"memberId":   mustOID(t, memberID),
		"status":     string(finance.StatusSuccess),
		"direction":  string(finance.DirectionIncome),
		"occurredAt": at, "grossMinor": int64(5000), "currency": "GHS",
	}); err != nil {
		t.Fatalf("transaction: %v", err)
	}
}

func TestTheAcceptanceCriterionResolvesTheCorrectSet(t *testing.T) {
	f := newFixture(t, stubRates{rate: money.Amount{Minor: 4, Currency: "GHS"}, configured: true})

	// The people who should match.
	wanted := []string{
		f.person(t, "Ama", member.StatusInactive, []bson.ObjectID{f.youth}, "+233241000001"),
		f.person(t, "Kofi", member.StatusInactive, []bson.ObjectID{f.youth, f.choir}, "+233241000002"),
	}
	// And every near miss.
	f.person(t, "Yaa", member.StatusActive, []bson.ObjectID{f.youth}, "+233241000003")     // wrong status
	f.person(t, "Kwesi", member.StatusInactive, []bson.ObjectID{f.choir}, "+233241000004") // wrong department
	f.person(t, "Abena", member.StatusInactive, nil, "+233241000005")                      // no department

	preview, err := f.svc.Preview(f.ctx, "sms",
		"We have missed you at Youth. Join us this Sunday.",
		Filter{Statuses: []member.Status{member.StatusInactive},
			DepartmentIDs: []string{f.youth.Hex()}})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}

	if preview.Total != len(wanted) {
		t.Fatalf("total = %d, want %d — the filter selected the wrong set",
			preview.Total, len(wanted))
	}
	if preview.Reachable != len(wanted) {
		t.Errorf("reachable = %d, want %d", preview.Reachable, len(wanted))
	}
	// And the cost is reported BEFORE send, which is the other half of it.
	if preview.Cost.Minor != 4*int64(len(wanted)) {
		t.Errorf("cost = %s, want 4 pesewas per recipient", preview.Cost)
	}
	if preview.Audience == "" {
		t.Error("the audience should be described in words a person can check")
	}
}

func TestABroadcastNeverIncludesTheDeceased(t *testing.T) {
	// Messaging the family of somebody who has died, because a broadcast
	// defaulted to "everyone", is the worst thing this feature can do.
	f := newFixture(t, nil)

	f.person(t, "Living", member.StatusActive, nil, "+233241000010")
	f.person(t, "Departed", member.StatusDeceased, nil, "+233241000011")
	f.person(t, "Moved", member.StatusTransferred, nil, "+233241000012")

	preview, err := f.svc.Preview(f.ctx, "sms", "Everyone", Filter{})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if preview.Total != 1 {
		t.Fatalf("an unfiltered broadcast selected %d people, want only the "+
			"1 living, non-transferred member", preview.Total)
	}
}

func TestActivityIsWhatTheRecordsShowNotWhatTheOfficeRecorded(t *testing.T) {
	f := newFixture(t, nil)
	now := time.Now().UTC()

	// All three carry the SAME status, so the office's record cannot be what
	// distinguishes them.
	recent := f.person(t, "Recent", member.StatusActive, nil, "+233241000020")
	drifted := f.person(t, "Drifted", member.StatusActive, nil, "+233241000021")
	newcomer := f.person(t, "Newcomer", member.StatusActive, nil, "+233241000022")
	giver := f.person(t, "Giver", member.StatusActive, nil, "+233241000023")

	f.attended(t, recent, now.AddDate(0, 0, -7))
	f.attended(t, drifted, now.AddDate(0, 0, -200))
	// The giver has NOT attended in months but supports the church every month.
	// An attendance-only definition would send them "we miss you" while they
	// are still paying for the building.
	f.attended(t, giver, now.AddDate(0, 0, -300))
	f.gave(t, giver, now.AddDate(0, 0, -10))

	cases := map[Activity][]string{
		ActivityActive: {recent, giver},
		ActivityLapsed: {drifted},
		ActivityNever:  {newcomer},
	}
	for activity, want := range cases {
		t.Run(string(activity), func(t *testing.T) {
			audience, err := f.svc.Resolve(f.ctx, Filter{Activity: activity}, 0)
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			got := map[string]bool{}
			for _, r := range audience.Recipients {
				got[r.MemberID] = true
			}
			if len(got) != len(want) {
				t.Fatalf("%s selected %d people, want %d", activity, len(got), len(want))
			}
			for _, id := range want {
				if !got[id] {
					t.Errorf("%s did not select %s", activity, id)
				}
			}
		})
	}
}

func TestSomebodyWhoHasNeverAttendedIsNotLapsed(t *testing.T) {
	// A separate audience with a different message. "We miss you" to a person
	// who has never attended is a mistake the church has to apologise for.
	f := newFixture(t, nil)
	newcomer := f.person(t, "Newcomer", member.StatusVisitor, nil, "+233241000030")

	lapsed, err := f.svc.Resolve(f.ctx, Filter{Activity: ActivityLapsed}, 0)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	for _, r := range lapsed.Recipients {
		if r.MemberID == newcomer {
			t.Fatal("somebody with no history at all was selected as lapsed")
		}
	}
}

func TestPeopleWithNoPhoneAreCountedButNotCharged(t *testing.T) {
	// Most of a congregation has no phone on file initially, and a cost
	// preview that ignores that overstates both the reach and the bill.
	f := newFixture(t, stubRates{rate: money.Amount{Minor: 4, Currency: "GHS"}, configured: true})

	f.person(t, "Has", member.StatusActive, nil, "+233241000040")
	f.person(t, "None", member.StatusActive, nil, "")
	f.person(t, "Neither", member.StatusActive, nil, "")

	preview, err := f.svc.Preview(f.ctx, "sms", "Hello", Filter{})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if preview.Total != 3 {
		t.Errorf("total = %d, want 3", preview.Total)
	}
	if preview.Reachable != 1 {
		t.Errorf("reachable = %d, want 1", preview.Reachable)
	}
	if preview.Unreachable != 2 {
		t.Errorf("unreachable = %d, want 2", preview.Unreachable)
	}
	if preview.Cost.Minor != 4 {
		t.Errorf("cost = %s, want one recipient's worth", preview.Cost)
	}
	if preview.Warning == "" {
		t.Error("two of three being unreachable should be said, not left to be noticed")
	}
}

func TestAnUnpricedChannelSaysSoRatherThanShowingZero(t *testing.T) {
	// A church shown "GHS 0.00" for a broadcast to four hundred people will
	// believe it, and the correction arrives as an invoice.
	f := newFixture(t, stubRates{configured: false})
	f.person(t, "Someone", member.StatusActive, nil, "+233241000050")

	preview, err := f.svc.Preview(f.ctx, "sms", "Hello", Filter{})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if preview.RateConfigured {
		t.Fatal("no rate was configured but the preview claims one")
	}
	if preview.Cost.Minor != 0 {
		t.Errorf("cost = %s with no rate configured", preview.Cost)
	}
	if preview.Warning == "" {
		t.Error("an unpriced send must say the cost is unavailable")
	}
}

func TestSendingCountsSuppressionsSeparatelyFromFailures(t *testing.T) {
	// A church needs to tell "we could not reach them" from "they asked us not
	// to". The first is a records problem it can fix; the second is a decision
	// it must respect.
	f := newFixture(t, nil)

	f.person(t, "Willing", member.StatusActive, nil, "+233241000060")
	declined := f.person(t, "Declined", member.StatusActive, nil, "+233241000061")
	f.person(t, "NoPhone", member.StatusActive, nil, "")
	f.sender.suppress[declined] = true

	campaign, err := f.svc.Create(f.ctx, CampaignInput{
		Name: "Notice", Channel: "sms", Body: "Service moves to 9am", Filter: Filter{},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	sent, err := f.svc.Send(f.ctx, campaign.ID.Hex())
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if sent.Sent != 1 {
		t.Errorf("sent = %d, want 1", sent.Sent)
	}
	// Two suppressions: the one who declined, and the one with no number.
	if sent.Suppressed != 2 {
		t.Errorf("suppressed = %d, want 2", sent.Suppressed)
	}
	if sent.Failed != 0 {
		t.Errorf("failed = %d, want 0", sent.Failed)
	}
	if sent.Recipients != sent.Sent+sent.Suppressed+sent.Failed {
		t.Error("the outcome does not account for every recipient")
	}

	// Consent is decided by the notification service, not re-decided here.
	// This asserts the kind that gates it — marking a broadcast transactional
	// would route it around the check that keeps this lawful.
	for _, msg := range f.sender.sent {
		if msg.Kind != notification.KindAnnouncement {
			t.Errorf("a broadcast was sent as %q, which skips the consent check",
				msg.Kind)
		}
	}
}

func TestARetriedSendDoesNotMessageAnybodyTwice(t *testing.T) {
	f := newFixture(t, nil)
	person := f.person(t, "Once", member.StatusActive, nil, "+233241000070")

	campaign, err := f.svc.Create(f.ctx, CampaignInput{
		Name: "Notice", Channel: "sms", Body: "Hello", Filter: Filter{},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := f.svc.Send(f.ctx, campaign.ID.Hex()); err != nil {
		t.Fatalf("send: %v", err)
	}

	// The dedupe key is what the notification service uses to make a redeliver
	// a no-op, so this asserts one is set and is specific to the pair.
	if len(f.sender.sent) != 1 {
		t.Fatalf("sent %d messages to one person", len(f.sender.sent))
	}
	key := f.sender.sent[0].DedupeKey
	if key == "" {
		t.Fatal("no dedupe key, so a crashed and re-run send would message " +
			"the whole congregation twice")
	}
	want := "campaign:" + campaign.ID.Hex() + ":" + person
	if key != want {
		t.Errorf("dedupe key = %q, want %q", key, want)
	}
}

func TestPersonalisationIsAClosedSet(t *testing.T) {
	f := newFixture(t, nil)
	f.person(t, "Ama", member.StatusActive, nil, "+233241000080")

	campaign, err := f.svc.Create(f.ctx, CampaignInput{
		Name:    "Greeting",
		Channel: "sms",
		// The last placeholder is not one this supports, and must survive
		// untouched rather than being resolved against anything.
		Body:   "Hi {{firstName}}, {{name}} — {{giving.total}}",
		Filter: Filter{},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := f.svc.Send(f.ctx, campaign.ID.Hex()); err != nil {
		t.Fatalf("send: %v", err)
	}

	body := f.sender.sent[0].Body
	if want := "Hi Ama, Ama Test — {{giving.total}}"; body != want {
		t.Errorf("body = %q, want %q — an unsupported placeholder must not "+
			"resolve against anything", body, want)
	}
}

func TestAScheduledSendRefusesAMaterialCostOverrun(t *testing.T) {
	// A scheduled message resolves its audience at SEND time, so a growing
	// congregation legitimately costs a little more than the preview said.
	// Beyond the tolerance, something changed that the approver did not agree
	// to — and spending the money and apologising afterwards is the wrong order.
	f := newFixture(t, stubRates{rate: money.Amount{Minor: 100, Currency: "GHS"}, configured: true})
	f.person(t, "First", member.StatusActive, nil, "+233241000090")

	campaign, err := f.svc.Create(f.ctx, CampaignInput{
		Name: "Scheduled", Channel: "sms", Body: "Hello", Filter: Filter{},
		// Approved when the audience was one person.
		ApprovedCostMinor: 100, ApprovedCurrency: "GHS",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Then the congregation grows fivefold before it sends.
	for i := 0; i < 4; i++ {
		f.person(t, fmt.Sprintf("Later%d", i), member.StatusActive, nil,
			fmt.Sprintf("+23324100009%d", i+1))
	}

	if _, err := f.svc.Send(f.ctx, campaign.ID.Hex()); err == nil {
		t.Fatal("a 5x cost overrun was sent without anybody approving it")
	} else if !isCostChanged(err) {
		t.Fatalf("send failed for the wrong reason: %v", err)
	}
}

func isCostChanged(err error) bool {
	for err != nil {
		if err == ErrCostChanged {
			return true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
