package communication

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/money"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/sms"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

var (
	// ErrNotFound means no such campaign or template.
	ErrNotFound = errors.New("communication: not found")
	// ErrBodyRequired means a message had no text.
	ErrBodyRequired = errors.New("communication: a message needs some text")
	// ErrChannelInvalid means an unrecognised channel.
	ErrChannelInvalid = errors.New("communication: that channel is not recognised")
	// ErrAlreadySent means a campaign has already gone out.
	ErrAlreadySent = errors.New("communication: this message has already been sent")
	// ErrCostChanged means the audience grew enough that the approved estimate
	// no longer covers it.
	ErrCostChanged = errors.New("communication: this now costs more than was approved")
	// ErrScheduleInPast means a send was scheduled for a time already gone.
	ErrScheduleInPast = errors.New("communication: that time has already passed")
)

// Rates resolves what a channel costs per billed unit.
//
// A port rather than a direct dependency on platformsetting, so this package
// stays testable without a settings document and so the rate can later come
// from a per-church negotiated plan without changing anything here.
type Rates interface {
	// MessagingRate returns the price per SMS segment (or per message on
	// channels not billed by segment), and whether a rate is configured at all.
	MessagingRate(ctx context.Context, channel string) (money.Amount, bool, error)
}

// Sender delivers one message. Satisfied by the WP-15 notification service,
// which owns consent, quiet hours, preference, dedupe and retry — none of which
// this package re-decides.
type Sender interface {
	Send(ctx context.Context, msg notification.Message) (*notification.Notification, error)
}

// Service is broadcast and targeted messaging.
type Service struct {
	campaigns *mongodb.TenantCollection
	templates *mongodb.TenantCollection

	members      *mongodb.TenantCollection
	attendance   *mongodb.TenantCollection
	transactions *mongodb.TenantCollection
	departments  *mongodb.TenantCollection
	groups       *mongodb.TenantCollection

	sender Sender
	rates  Rates
	now    func() time.Time
}

// NewService builds the communication service.
func NewService(db *mongodb.DB, sender Sender, rates Rates) *Service {
	return &Service{
		campaigns:    db.Tenant(CampaignCollection),
		templates:    db.Tenant(TemplateCollection),
		members:      db.Tenant(member.Collection),
		attendance:   db.Tenant("attendance"),
		transactions: db.Tenant("transactions"),
		departments:  db.Tenant(church.CollectionDepartments),
		groups:       db.Tenant(church.CollectionGroups),
		sender:       sender,
		rates:        rates,
		now:          time.Now,
	}
}

// EnsureIndexes creates what this domain reads by.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	err := s.campaigns.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "createdAt", Value: -1},
			},
			Options: options.Index().SetName("church_campaign_recent"),
		},
		{
			// The scheduler's query: everything due. Global rather than
			// per-church, because the sweeper has no tenant of its own — the
			// same shape the notification retry sweeper already uses.
			Keys: bson.D{
				{Key: "state", Value: 1},
				{Key: "scheduledFor", Value: 1},
			},
			Options: options.Index().
				SetName("campaign_due").
				SetPartialFilterExpression(bson.M{
					"scheduledFor": bson.M{"$exists": true},
				}),
		},
	})
	if err != nil {
		return fmt.Errorf("communication: create campaign indexes: %w", err)
	}

	err = s.templates.EnsureIndexes(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: mongodb.TenantField, Value: 1},
				{Key: "name", Value: 1},
			},
			Options: options.Index().SetName("uq_church_template_name").SetUnique(true),
		},
	})
	if err != nil {
		return fmt.Errorf("communication: create template indexes: %w", err)
	}
	return nil
}

// --- cost -----------------------------------------------------------------------

// confirmationThreshold is the recipient count above which a send should be
// confirmed explicitly rather than clicked past.
//
// A hundred rather than a congregation-sized number, because the mistake this
// catches is a filter that was meant to select a department and instead
// selected everyone — and a department is tens of people, so the boundary has
// to sit between the two rather than above both. A church whose whole
// membership is under a hundred confirms nothing, which is correct: there is no
// slip to catch.
const confirmationThreshold = 100

// Preview says who a message reaches and what it costs, before it is sent.
func (s *Service) Preview(ctx context.Context, channel, body string, f Filter) (*CostPreview, error) {
	channel = strings.ToLower(strings.TrimSpace(channel))
	if !notification.Channel(channel).Valid() {
		return nil, fmt.Errorf("%w: %q", ErrChannelInvalid, channel)
	}
	if strings.TrimSpace(body) == "" {
		return nil, ErrBodyRequired
	}

	audience, err := s.Resolve(ctx, f, MaxAudience)
	if err != nil {
		return nil, err
	}

	reachable := 0
	for _, r := range audience.Recipients {
		if r.Reachable(channel) {
			reachable++
		}
	}

	preview := &CostPreview{
		Audience:    audience.Description,
		Total:       audience.Total,
		Reachable:   reachable,
		Unreachable: audience.Total - reachable,
	}

	// Segment counting applies to SMS and WhatsApp session messages. Email and
	// push are billed per message where they are billed at all, so a segment
	// figure there would be an invented number.
	perRecipient := 1
	if channel == string(notification.ChannelSMS) || channel == string(notification.ChannelWhatsApp) {
		estimate := sms.Measure(body)
		preview.Message = &estimate
		perRecipient = estimate.Segments
		if estimate.Warning != "" {
			preview.Warning = estimate.Warning
		}
	}
	preview.Segments = perRecipient * reachable

	rate, configured, err := s.rates.MessagingRate(ctx, channel)
	if err != nil {
		return nil, fmt.Errorf("communication: resolve rate: %w", err)
	}
	preview.RateConfigured = configured
	if configured {
		preview.Cost = money.Amount{
			Minor:    rate.Minor * int64(preview.Segments),
			Currency: rate.Currency,
		}
	}

	preview.RequiresConfirmation = reachable >= confirmationThreshold

	switch {
	case reachable == 0 && audience.Total > 0:
		preview.Warning = fmt.Sprintf(
			"None of these %d people have a %s address on file, so nobody would "+
				"receive this.", audience.Total, channelName(channel))
	case preview.Unreachable > 0 && preview.Warning == "":
		preview.Warning = fmt.Sprintf(
			"%d of %d have no %s address on file and will not receive this.",
			preview.Unreachable, audience.Total, channelName(channel))
	case !configured && preview.Warning == "":
		preview.Warning = "No " + channelName(channel) + " rate has been set on " +
			"the platform, so this cost cannot be estimated."
	}
	return preview, nil
}

func channelName(channel string) string {
	switch channel {
	case string(notification.ChannelSMS):
		return "phone number"
	case string(notification.ChannelEmail):
		return "email"
	case string(notification.ChannelWhatsApp):
		return "WhatsApp"
	}
	return channel
}

// --- campaigns --------------------------------------------------------------------

// CampaignInput is a campaign as submitted.
type CampaignInput struct {
	Name         string
	Channel      string
	Subject      string
	Body         string
	Filter       Filter
	ScheduledFor *time.Time
	// ApprovedCostMinor is the estimate the sender agreed to, from Preview.
	ApprovedCostMinor int64
	ApprovedCurrency  string
}

// Create records a campaign without sending it.
func (s *Service) Create(ctx context.Context, in CampaignInput) (*Campaign, error) {
	channel := strings.ToLower(strings.TrimSpace(in.Channel))
	if !notification.Channel(channel).Valid() {
		return nil, fmt.Errorf("%w: %q", ErrChannelInvalid, channel)
	}
	if strings.TrimSpace(in.Body) == "" {
		return nil, ErrBodyRequired
	}
	if !in.Filter.Activity.Valid() {
		return nil, fmt.Errorf("%w: unknown activity %q", ErrFilterInvalid, in.Filter.Activity)
	}

	now := s.now().UTC()
	state := StateDraft
	if in.ScheduledFor != nil {
		if !in.ScheduledFor.After(now) {
			return nil, ErrScheduleInPast
		}
		state = StateScheduled
	}

	scope, _ := tenancy.FromContext(ctx)
	doc := bson.M{
		"name":       strings.TrimSpace(in.Name),
		"channel":    channel,
		"body":       in.Body,
		"filter":     in.Filter,
		"state":      string(state),
		"recipients": 0,
		"sent":       0,
		"suppressed": 0,
		"failed":     0,
		"createdAt":  now,
		"updatedAt":  now,
	}
	if in.Subject != "" {
		doc["subject"] = strings.TrimSpace(in.Subject)
	}
	if in.ScheduledFor != nil {
		doc["scheduledFor"] = in.ScheduledFor.UTC()
	}
	if in.ApprovedCostMinor > 0 {
		doc["approvedCostMinor"] = in.ApprovedCostMinor
		doc["approvedCurrency"] = in.ApprovedCurrency
	}
	if scope.UserID != "" {
		doc["createdBy"] = mongodb.ID(scope.UserID)
	}

	res, err := s.campaigns.InsertOne(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("communication: create campaign: %w", err)
	}
	return s.byObjectID(ctx, res.InsertedID.(bson.ObjectID))
}

// Campaigns lists a church's broadcasts, newest first.
func (s *Service) Campaigns(ctx context.Context, limit int64) ([]Campaign, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	out := []Campaign{}
	err := s.campaigns.Find(ctx, bson.M{}, &out,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("communication: list campaigns: %w", err)
	}
	return out, nil
}

// ByID returns one campaign within the caller's church.
func (s *Service) ByID(ctx context.Context, id string) (*Campaign, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.byObjectID(ctx, oid)
}

func (s *Service) byObjectID(ctx context.Context, oid bson.ObjectID) (*Campaign, error) {
	var found Campaign
	err := s.campaigns.FindOne(ctx, bson.M{"_id": oid}, &found)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("communication: read campaign: %w", err)
	}
	return &found, nil
}

// Cancel stops a campaign that has not gone out.
func (s *Service) Cancel(ctx context.Context, id string) (*Campaign, error) {
	campaign, err := s.ByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if campaign.State == StateSent || campaign.State == StateSending {
		return nil, ErrAlreadySent
	}
	if _, err := s.campaigns.UpdateOne(ctx, bson.M{"_id": campaign.ID},
		bson.M{"$set": bson.M{"state": string(StateCancelled)}}); err != nil {
		return nil, fmt.Errorf("communication: cancel: %w", err)
	}
	return s.byObjectID(ctx, campaign.ID)
}

// costOverrunTolerance is how much a send may exceed its approved estimate.
//
// A scheduled message resolves its audience at SEND time, so a growing
// congregation legitimately costs a little more than the preview said. Ten per
// cent absorbs that; beyond it, something changed that the person who approved
// the cost did not agree to — a filter edited, or a bulk import — and spending
// the money and apologising afterwards is the wrong order.
const costOverrunTolerance = 110

// Send delivers a campaign now.
//
// The audience is resolved HERE rather than at compose time, so the message
// reaches the congregation as it is. Every message goes through the notification
// service, which is what applies consent, per-channel preference and quiet
// hours — this loop deliberately re-decides none of them, and counts the
// suppressions it is told about.
func (s *Service) Send(ctx context.Context, id string) (*Campaign, error) {
	campaign, err := s.ByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if campaign.State == StateSent || campaign.State == StateSending {
		return nil, ErrAlreadySent
	}

	preview, err := s.Preview(ctx, campaign.Channel, campaign.Body, campaign.Filter)
	if err != nil {
		return nil, err
	}

	// The cost the sender approved still has to cover what this actually costs.
	if campaign.ApprovedCostMinor > 0 && preview.RateConfigured {
		ceiling := campaign.ApprovedCostMinor * costOverrunTolerance / 100
		if preview.Cost.Minor > ceiling {
			return nil, fmt.Errorf("%w: approved %d, now %d",
				ErrCostChanged, campaign.ApprovedCostMinor, preview.Cost.Minor)
		}
	}

	audience, err := s.Resolve(ctx, campaign.Filter, MaxAudience)
	if err != nil {
		return nil, err
	}

	if _, err := s.campaigns.UpdateOne(ctx, bson.M{"_id": campaign.ID}, bson.M{
		"$set": bson.M{"state": string(StateSending), "recipients": audience.Total},
	}); err != nil {
		return nil, fmt.Errorf("communication: mark sending: %w", err)
	}

	sent, suppressed, failed := 0, 0, 0
	// The FIRST failure reason, kept and stored on the campaign.
	//
	// Without it a church sees "sent 0, failed 247" and has nothing to act on,
	// and neither does support. One reason rather than all of them because 247
	// copies of the same message is not more informative than one — and when
	// they genuinely differ, the first is still a place to start.
	firstFailure := ""
	note := func(reason string) {
		failed++
		if firstFailure == "" {
			firstFailure = reason
		}
	}

	for _, recipient := range audience.Recipients {
		if !recipient.Reachable(campaign.Channel) {
			suppressed++
			continue
		}

		result, err := s.sender.Send(ctx, notification.Message{
			MemberID: recipient.MemberID,
			Channel:  notification.Channel(campaign.Channel),
			// KindAnnouncement, not transactional: a broadcast is exactly what
			// communications consent exists to gate, and marking it otherwise
			// would route it around the check that keeps this lawful.
			Kind:    notification.KindAnnouncement,
			Subject: campaign.Subject,
			Body:    personalise(campaign.Body, recipient),
			// One key per (campaign, member), so a retried send — a crashed
			// process, a re-clicked button — does not message anybody twice.
			DedupeKey: "campaign:" + campaign.ID.Hex() + ":" + recipient.MemberID,
		})
		switch {
		case err != nil:
			note(err.Error())
		case result == nil:
			note("the messaging service returned nothing")
		case result.Status == notification.StatusSuppressed:
			suppressed++
		default:
			sent++
		}
	}

	now := s.now().UTC()
	actual := int64(0)
	if preview.RateConfigured && preview.Message != nil {
		rate, _, rateErr := s.rates.MessagingRate(ctx, campaign.Channel)
		if rateErr == nil {
			actual = rate.Minor * int64(preview.Message.Segments) * int64(sent)
		}
	}

	update := bson.M{
		"state":      string(StateSent),
		"sent":       sent,
		"suppressed": suppressed,
		"failed":     failed,
		"sentAt":     now,
	}
	if actual > 0 {
		update["actualCostMinor"] = actual
	}
	if firstFailure != "" {
		update["lastError"] = firstFailure
	}
	if _, err := s.campaigns.UpdateOne(ctx, bson.M{"_id": campaign.ID},
		bson.M{"$set": update}); err != nil {
		return nil, fmt.Errorf("communication: record outcome: %w", err)
	}
	return s.byObjectID(ctx, campaign.ID)
}

// personalise substitutes the placeholders a church actually uses.
//
// A deliberately CLOSED set, not a template language. Anything more expressive
// is a way for a message body to read data it was not given — and the body is
// typed by a church administrator, so it is untrusted input reaching a renderer.
func personalise(body string, r Recipient) string {
	first := r.Name
	if idx := strings.IndexByte(first, ' '); idx > 0 {
		first = first[:idx]
	}
	return strings.NewReplacer(
		"{{name}}", r.Name,
		"{{firstName}}", first,
		"{{first_name}}", first,
	).Replace(body)
}

// --- scheduling ---------------------------------------------------------------

// Due returns the churches with campaigns ready to send.
//
// Church ids rather than campaigns, matching the notification sweeper: the
// caller has to enter each church's tenant scope before it can read anything,
// so handing it campaigns read outside a scope would be handing it data the
// wrapper exists to prevent.
func (s *Service) Due(ctx context.Context, global *mongo.Collection) ([]string, error) {
	result := global.Distinct(ctx, mongodb.TenantField, bson.M{
		"state":        string(StateScheduled),
		"scheduledFor": bson.M{"$lte": s.now().UTC()},
	})
	var raw []any
	if err := result.Decode(&raw); err != nil {
		return nil, fmt.Errorf("communication: find due campaigns: %w", err)
	}

	out := make([]string, 0, len(raw))
	for _, value := range raw {
		switch v := value.(type) {
		case string:
			out = append(out, v)
		case bson.ObjectID:
			out = append(out, v.Hex())
		}
	}
	return out, nil
}

// SendDue sends every scheduled campaign that is due within the caller's church.
func (s *Service) SendDue(ctx context.Context) (int, error) {
	var due []Campaign
	err := s.campaigns.Find(ctx, bson.M{
		"state":        string(StateScheduled),
		"scheduledFor": bson.M{"$lte": s.now().UTC()},
	}, &due, options.Find().SetLimit(50))
	if err != nil {
		return 0, fmt.Errorf("communication: read due campaigns: %w", err)
	}

	sent := 0
	for i := range due {
		if _, err := s.Send(ctx, due[i].ID.Hex()); err != nil {
			// One campaign failing must not stop the rest. The reason is
			// recorded on the campaign so a church is not left with a
			// "scheduled" status and no explanation.
			if _, markErr := s.campaigns.UpdateOne(ctx, bson.M{"_id": due[i].ID}, bson.M{
				"$set": bson.M{"state": string(StateFailed), "lastError": err.Error()},
			}); markErr != nil {
				return sent, markErr
			}
			continue
		}
		sent++
	}
	return sent, nil
}

// --- templates ------------------------------------------------------------------

// SaveTemplate creates or replaces a reusable message.
func (s *Service) SaveTemplate(ctx context.Context, name, channel, subject, body string) (*Template, error) {
	name = strings.TrimSpace(name)
	channel = strings.ToLower(strings.TrimSpace(channel))
	if name == "" {
		return nil, fmt.Errorf("%w: a template needs a name", ErrBodyRequired)
	}
	if strings.TrimSpace(body) == "" {
		return nil, ErrBodyRequired
	}
	if !notification.Channel(channel).Valid() {
		return nil, fmt.Errorf("%w: %q", ErrChannelInvalid, channel)
	}

	scope, _ := tenancy.FromContext(ctx)
	set := bson.M{"channel": channel, "body": body}
	if subject != "" {
		set["subject"] = strings.TrimSpace(subject)
	}
	onInsert := bson.M{"name": name}
	if scope.UserID != "" {
		onInsert["createdBy"] = mongodb.ID(scope.UserID)
	}

	if _, err := s.templates.UpsertOne(ctx, bson.M{"name": name}, bson.M{
		"$set":         set,
		"$setOnInsert": onInsert,
	}); err != nil {
		return nil, fmt.Errorf("communication: save template: %w", err)
	}

	var out Template
	if err := s.templates.FindOne(ctx, bson.M{"name": name}, &out); err != nil {
		return nil, fmt.Errorf("communication: read template: %w", err)
	}
	return &out, nil
}

// Templates lists a church's saved messages.
func (s *Service) Templates(ctx context.Context) ([]Template, error) {
	out := []Template{}
	err := s.templates.Find(ctx, bson.M{}, &out,
		options.Find().SetSort(bson.D{{Key: "name", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("communication: list templates: %w", err)
	}
	return out, nil
}

// DeleteTemplate removes a saved message.
func (s *Service) DeleteTemplate(ctx context.Context, id string) error {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return ErrNotFound
	}
	res, err := s.templates.DeleteOne(ctx, bson.M{"_id": oid})
	if err != nil {
		return fmt.Errorf("communication: delete template: %w", err)
	}
	if res.DeletedCount == 0 {
		return ErrNotFound
	}
	return nil
}
