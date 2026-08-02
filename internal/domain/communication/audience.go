// Package communication is broadcast and targeted messaging (WP-22, PDF §6.3).
//
// It sits ON TOP of WP-15's notification service rather than beside it. That
// service already owns the things that must not be re-decided per caller —
// consent (fail-closed under Act 843 and the NDPA), quiet hours, per-channel
// preference, deduplication and retry. This package owns the three things a
// church actually does before any of that runs:
//
//   - WHO the message goes to, expressed as a filter over the congregation
//     rather than a list somebody pastes in;
//   - WHAT it costs, said before send rather than discovered on an invoice;
//   - WHEN it goes, because a church schedules its announcements.
//
// The order matters. A church that cannot see the cost will not use targeting,
// and a church that cannot see the audience will not trust the cost.
package communication

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

var (
	// ErrAudienceEmpty means a filter matched nobody.
	ErrAudienceEmpty = errors.New("communication: this audience has nobody in it")
	// ErrAudienceTooBroad means a filter would reach more people than the
	// safety ceiling allows in one send.
	ErrAudienceTooBroad = errors.New("communication: this audience is too large for one send")
	// ErrFilterInvalid means a filter could not be understood.
	ErrFilterInvalid = errors.New("communication: that audience filter is not valid")
)

// MaxAudience caps one broadcast.
//
// Not a technical limit — a blast radius. The most expensive mistake available
// here is a filter that was meant to select a department and instead selected
// the congregation, and the difference is invisible until the bill arrives.
// Above this the church is made to confirm the count explicitly.
const MaxAudience = 5000

// Activity is how recently somebody has been part of church life.
//
// Distinct from member.Status, and the distinction is the point. Status is what
// the office RECORDED — a pastoral judgement, updated when somebody gets round
// to it. Activity is what the records SHOW: attendance and giving. A church
// that wants to reach "people who have drifted" means the second, and using the
// first would reach whoever nobody has updated.
type Activity string

const (
	// ActivityAny does not filter on activity.
	ActivityAny Activity = ""
	// ActivityActive is somebody seen within the window.
	ActivityActive Activity = "active"
	// ActivityLapsed is somebody not seen within the window, but seen before.
	ActivityLapsed Activity = "lapsed"
	// ActivityNever is somebody with no attendance and no giving on record.
	ActivityNever Activity = "never"
)

// Valid reports whether an activity filter is recognised.
func (a Activity) Valid() bool {
	switch a {
	case ActivityAny, ActivityActive, ActivityLapsed, ActivityNever:
		return true
	}
	return false
}

// DefaultActivityWindow is how far back "recently" reaches.
//
// Eight weeks rather than a month: a member who attends fortnightly and misses
// two is not lapsed, and a window that calls them lapsed produces a "we miss
// you" message to somebody who was there last Sunday. That message does more
// damage than not sending one.
const DefaultActivityWindow = 56 * 24 * time.Hour

// Filter describes an audience without listing it.
//
// Stored on a campaign rather than the resolved member list, so a scheduled
// message reaches the congregation as it is WHEN IT SENDS, not as it was when
// somebody wrote it. A list frozen at compose time silently excludes everyone
// who joined in between — which for a "welcome to the new members" message is
// exactly the wrong people.
type Filter struct {
	// Statuses limits to member statuses. Empty means every status except the
	// ones nobody means to message; see excludedStatuses.
	Statuses []member.Status `bson:"statuses,omitempty" json:"statuses,omitempty"`
	// DepartmentIDs limits to ministries. Any match, not all.
	DepartmentIDs []string `bson:"departmentIds,omitempty" json:"departmentIds,omitempty"`
	// GroupIDs limits to cells or home fellowships.
	GroupIDs []string `bson:"groupIds,omitempty" json:"groupIds,omitempty"`
	// Gender limits to one gender, for the messages that genuinely are
	// (men's fellowship, women's conference).
	Gender string `bson:"gender,omitempty" json:"gender,omitempty"`
	// Activity limits by attendance and giving recency.
	Activity Activity `bson:"activity,omitempty" json:"activity,omitempty"`
	// ActivityWindow overrides how far back "recently" reaches.
	ActivityWindow time.Duration `bson:"activityWindow,omitempty" json:"activityWindow,omitempty"`
	// MemberIDs is an explicit list, for the cases a filter cannot express.
	// Combined with the rest as an intersection, not a union — a list plus a
	// filter means "these people, if they also match", which is the reading
	// that cannot accidentally widen an audience.
	MemberIDs []string `bson:"memberIds,omitempty" json:"memberIds,omitempty"`
}

// excludedStatuses are never included by a filter that does not name them.
//
// Messaging the family of somebody who has died, because a broadcast defaulted
// to "everyone", is the single worst thing this feature can do. Transferred
// members are excluded for a smaller version of the same reason: they belong to
// another church now.
var excludedStatuses = []member.Status{member.StatusDeceased, member.StatusTransferred}

// IsEmpty reports whether a filter narrows nothing.
func (f Filter) IsEmpty() bool {
	return len(f.Statuses) == 0 && len(f.DepartmentIDs) == 0 && len(f.GroupIDs) == 0 &&
		f.Gender == "" && f.Activity == ActivityAny && len(f.MemberIDs) == 0
}

// Describe renders a filter as the sentence a church would use.
//
// Shown on the confirmation screen, because "247 recipients" is not something
// anybody can check. "Inactive members in the Youth department" is.
func (f Filter) Describe(departments, groups map[string]string) string {
	if f.IsEmpty() {
		return "Everyone in your church"
	}

	parts := []string{}
	switch f.Activity {
	case ActivityActive:
		parts = append(parts, "recently active")
	case ActivityLapsed:
		parts = append(parts, "not seen recently")
	case ActivityNever:
		parts = append(parts, "never recorded as attending or giving")
	}
	for _, status := range f.Statuses {
		parts = append(parts, string(status))
	}
	if f.Gender != "" {
		parts = append(parts, f.Gender)
	}

	who := "members"
	if len(parts) > 0 {
		who = strings.Join(parts, ", ") + " members"
	}

	where := []string{}
	for _, id := range f.DepartmentIDs {
		if name, ok := departments[id]; ok {
			where = append(where, name)
		}
	}
	for _, id := range f.GroupIDs {
		if name, ok := groups[id]; ok {
			where = append(where, name)
		}
	}
	if len(where) > 0 {
		who += " in " + strings.Join(where, " or ")
	}
	if len(f.MemberIDs) > 0 {
		who += fmt.Sprintf(" (from a list of %d)", len(f.MemberIDs))
	}
	return strings.ToUpper(who[:1]) + who[1:]
}

// query renders a filter as a MongoDB predicate.
//
// Tenant scoping is NOT here: the collection is a TenantCollection, which
// injects churchId itself and refuses to build a query without one. Adding it
// here as well would look like belt and braces and would actually be a place
// for the two to disagree.
func (f Filter) query() (bson.M, error) {
	q := bson.M{}

	if len(f.Statuses) > 0 {
		statuses := make([]string, 0, len(f.Statuses))
		for _, status := range f.Statuses {
			if !status.Valid() {
				return nil, fmt.Errorf("%w: unknown status %q", ErrFilterInvalid, status)
			}
			statuses = append(statuses, string(status))
		}
		q["status"] = bson.M{"$in": statuses}
	} else {
		excluded := make([]string, 0, len(excludedStatuses))
		for _, status := range excludedStatuses {
			excluded = append(excluded, string(status))
		}
		q["status"] = bson.M{"$nin": excluded}
	}

	if len(f.DepartmentIDs) > 0 {
		ids, err := objectIDs(f.DepartmentIDs, "department")
		if err != nil {
			return nil, err
		}
		q["departmentIds"] = bson.M{"$in": ids}
	}
	if len(f.GroupIDs) > 0 {
		ids, err := objectIDs(f.GroupIDs, "group")
		if err != nil {
			return nil, err
		}
		q["groupIds"] = bson.M{"$in": ids}
	}
	if f.Gender != "" {
		q["gender"] = strings.ToLower(strings.TrimSpace(f.Gender))
	}
	if len(f.MemberIDs) > 0 {
		ids, err := objectIDs(f.MemberIDs, "member")
		if err != nil {
			return nil, err
		}
		q["_id"] = bson.M{"$in": ids}
	}
	return q, nil
}

func objectIDs(raw []string, what string) ([]bson.ObjectID, error) {
	out := make([]bson.ObjectID, 0, len(raw))
	for _, id := range raw {
		oid, err := bson.ObjectIDFromHex(strings.TrimSpace(id))
		if err != nil {
			return nil, fmt.Errorf("%w: %s id %q", ErrFilterInvalid, what, id)
		}
		out = append(out, oid)
	}
	return out, nil
}

// Recipient is one person a message will reach, with the address it will use.
type Recipient struct {
	MemberID string `json:"memberId"`
	Name     string `json:"name"`
	Phone    string `json:"phone,omitempty"`
	Email    string `json:"email,omitempty"`
}

// Reachable reports whether this person can be reached on a channel at all.
func (r Recipient) Reachable(channel string) bool {
	switch channel {
	case "sms", "whatsapp":
		return r.Phone != ""
	case "email":
		return r.Email != ""
	}
	// Push has no address here — it is resolved from device registrations at
	// send time, so anybody may be reachable and the notification service is
	// what says otherwise.
	return true
}

// Audience is a resolved filter.
type Audience struct {
	// Recipients are the people the filter selected.
	Recipients []Recipient `json:"recipients"`
	// Total is how many the filter selected, which is not the same as how many
	// can be reached on a given channel.
	Total int `json:"total"`
	// Description is the filter in words.
	Description string `json:"description"`
}

// Resolve turns a filter into the people it selects.
//
// Activity filtering happens AFTER the database query rather than inside it,
// because it spans three collections — members, attendance and transactions —
// and MongoDB's $lookup is forbidden inside a tenant-scoped pipeline for the
// reason given in the mongodb package: a lookup reads a second collection that
// the leading tenant $match never touched.
func (s *Service) Resolve(ctx context.Context, f Filter, limit int) (*Audience, error) {
	if !f.Activity.Valid() {
		return nil, fmt.Errorf("%w: unknown activity %q", ErrFilterInvalid, f.Activity)
	}
	q, err := f.query()
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > MaxAudience {
		limit = MaxAudience
	}

	var members []member.Member
	err = s.members.Find(ctx, q, &members,
		options.Find().
			SetSort(bson.D{{Key: "lastName", Value: 1}}).
			// One over the cap, so "more than the ceiling" is distinguishable
			// from "exactly the ceiling" without a second count query.
			SetLimit(int64(limit)+1).
			SetProjection(bson.M{
				"firstName": 1, "lastName": 1, "phoneE164": 1, "email": 1,
			}))
	if err != nil {
		return nil, fmt.Errorf("communication: resolve audience: %w", err)
	}

	if f.Activity != ActivityAny {
		members, err = s.filterByActivity(ctx, members, f)
		if err != nil {
			return nil, err
		}
	}

	if len(members) > limit {
		return nil, fmt.Errorf("%w: more than %d people match", ErrAudienceTooBroad, limit)
	}

	recipients := make([]Recipient, 0, len(members))
	for i := range members {
		recipients = append(recipients, Recipient{
			MemberID: members[i].ID.Hex(),
			Name:     members[i].FullName(),
			Phone:    members[i].PhoneE164,
			Email:    members[i].Email,
		})
	}

	departments, groups, err := s.ministryNames(ctx)
	if err != nil {
		// A missing name makes the description less useful, not wrong. Failing
		// the whole resolve because a department was renamed would be worse.
		departments, groups = map[string]string{}, map[string]string{}
	}

	return &Audience{
		Recipients:  recipients,
		Total:       len(recipients),
		Description: f.Describe(departments, groups),
	}, nil
}

// filterByActivity narrows a set by attendance and giving recency.
//
// Both collections are consulted, because either counts. A member who gives by
// mobile money every month and has not been scanned at a door in a year is not
// lapsed — and an attendance-only definition would send them a "we miss you"
// message while they are still supporting the church financially.
func (s *Service) filterByActivity(ctx context.Context, members []member.Member, f Filter) ([]member.Member, error) {
	if len(members) == 0 {
		return members, nil
	}

	window := f.ActivityWindow
	if window <= 0 {
		window = DefaultActivityWindow
	}
	since := s.now().UTC().Add(-window)

	ids := make([]string, 0, len(members))
	for i := range members {
		ids = append(ids, members[i].ID.Hex())
	}

	seen, err := s.activeSince(ctx, ids, since)
	if err != nil {
		return nil, err
	}
	ever, err := s.activeSince(ctx, ids, time.Time{})
	if err != nil {
		return nil, err
	}

	out := members[:0]
	for i := range members {
		id := members[i].ID.Hex()
		keep := false
		switch f.Activity {
		case ActivityActive:
			keep = seen[id]
		case ActivityLapsed:
			// Seen at some point but not lately. Somebody who has NEVER been
			// recorded is a different audience with a different message —
			// "we miss you" to a person who has never attended is a mistake
			// the church has to apologise for.
			keep = !seen[id] && ever[id]
		case ActivityNever:
			keep = !ever[id]
		}
		if keep {
			out = append(out, members[i])
		}
	}
	return out, nil
}

// activeSince reports which of the given members attended or gave since a time.
// A zero time means "ever".
func (s *Service) activeSince(ctx context.Context, memberIDs []string, since time.Time) (map[string]bool, error) {
	out := make(map[string]bool, len(memberIDs))

	attendance := bson.M{"memberId": bson.M{"$in": memberIDs}}
	if !since.IsZero() {
		attendance["checkedInAt"] = bson.M{"$gte": since}
	}
	var attended []struct {
		MemberID string `bson:"memberId"`
	}
	if err := s.attendance.Find(ctx, attendance, &attended,
		options.Find().SetProjection(bson.M{"memberId": 1})); err != nil {
		return nil, fmt.Errorf("communication: attendance activity: %w", err)
	}
	for _, row := range attended {
		out[row.MemberID] = true
	}

	// Giving is stored with memberId as an ObjectId by the legacy writer and
	// as a string by early Go documents (ADR-005), so both forms are matched.
	// Checking one silently halves the set — and halving it here means telling
	// a church somebody has stopped giving when they have not.
	oids := make([]bson.ObjectID, 0, len(memberIDs))
	for _, id := range memberIDs {
		if oid, err := bson.ObjectIDFromHex(id); err == nil {
			oids = append(oids, oid)
		}
	}
	any := make(bson.A, 0, len(memberIDs)+len(oids))
	for _, id := range memberIDs {
		any = append(any, id)
	}
	for _, oid := range oids {
		any = append(any, oid)
	}

	giving := bson.M{"memberId": bson.M{"$in": any}, "status": "completed"}
	if !since.IsZero() {
		giving["occurredAt"] = bson.M{"$gte": since}
	}
	var gave []struct {
		MemberID mongodb.ID `bson:"memberId"`
	}
	if err := s.transactions.Find(ctx, giving, &gave,
		options.Find().SetProjection(bson.M{"memberId": 1})); err != nil {
		return nil, fmt.Errorf("communication: giving activity: %w", err)
	}
	for _, row := range gave {
		out[row.MemberID.String()] = true
	}

	return out, nil
}

// ministryNames returns department and group names by id, for descriptions.
func (s *Service) ministryNames(ctx context.Context) (map[string]string, map[string]string, error) {
	departments := map[string]string{}
	groups := map[string]string{}

	var rows []struct {
		ID   bson.ObjectID `bson:"_id"`
		Name string        `bson:"name"`
	}
	if err := s.departments.Find(ctx, bson.M{}, &rows,
		options.Find().SetProjection(bson.M{"name": 1})); err != nil {
		return nil, nil, err
	}
	for _, row := range rows {
		departments[row.ID.Hex()] = row.Name
	}

	rows = rows[:0]
	if err := s.groups.Find(ctx, bson.M{}, &rows,
		options.Find().SetProjection(bson.M{"name": 1})); err != nil {
		return nil, nil, err
	}
	for _, row := range rows {
		groups[row.ID.Hex()] = row.Name
	}
	return departments, groups, nil
}
