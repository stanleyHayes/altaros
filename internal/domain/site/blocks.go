package site

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

// The v1 block library (§13.4).
//
// Chosen from what a church website actually contains rather than from what a
// page builder usually offers. Three of them — events, sermons, giving_cta —
// read from the platform's own data, because a church that adds an event in the
// dashboard and then re-types it into its website has a site that is wrong
// within a month. That duplication is the single most common reason church
// websites go stale.
//
// Deliberately NOT in v1: custom HTML, custom CSS, a free-form drag canvas,
// per-block responsive overrides, A/B tests, a forms builder. Each is the
// feature that turns a CMS into a support queue, and the first is also the one
// that turns it into an XSS vector aimed at the church's own congregation.

// BlockType is one kind of section.
type BlockType string

const (
	BlockHero                 BlockType = "hero"
	BlockRichText             BlockType = "rich_text"
	BlockServiceTimes         BlockType = "service_times"
	BlockSermons              BlockType = "sermons"
	BlockEvents               BlockType = "events"
	BlockGivingCTA            BlockType = "giving_cta"
	BlockLeadership           BlockType = "leadership"
	BlockContactAndDirections BlockType = "contact_and_directions"
	BlockLiveStream           BlockType = "live_stream"
	BlockGallery              BlockType = "gallery"
	BlockAnnouncements        BlockType = "announcements"
	BlockSpacer               BlockType = "spacer"
)

// ErrBlockType means the block type is not in the v1 library.
var ErrBlockType = errors.New("site: that section type is not available")

// ErrBlockData means a block's content failed its own validation.
var ErrBlockData = errors.New("site: that section's content is not valid")

// AllBlockTypes is the library, in the order an editor's "add a section" menu
// should list them — most-reached-for first, rather than alphabetically.
var AllBlockTypes = []BlockType{
	BlockHero,
	BlockServiceTimes,
	BlockRichText,
	BlockEvents,
	BlockSermons,
	BlockGivingCTA,
	BlockAnnouncements,
	BlockLeadership,
	BlockContactAndDirections,
	BlockLiveStream,
	BlockGallery,
	BlockSpacer,
}

// BlockDescriptor describes a block type for the editor's UI.
type BlockDescriptor struct {
	Type        BlockType `json:"type"`
	Label       string    `json:"label"`
	Description string    `json:"description"`
	// ReadsPlatformData marks the blocks that pull from the church's own
	// records. The editor shows this, because "this updates itself" is the
	// reason to choose one of these over typing the same thing into rich text.
	ReadsPlatformData bool `json:"readsPlatformData"`
}

// BlockLibrary describes every available block, for the editor.
func BlockLibrary() []BlockDescriptor {
	return []BlockDescriptor{
		{BlockHero, "Welcome banner", "A large image, your church's name, and one action.", false},
		{BlockServiceTimes, "Service times", "When you meet, and where.", false},
		{BlockRichText, "Text", "Headings, paragraphs and lists.", false},
		{BlockEvents, "Upcoming events", "Pulled from your events — never re-typed.", true},
		{BlockSermons, "Sermons", "Your most recent messages.", true},
		{BlockGivingCTA, "Giving", "A link to give, using your church's own giving setup.", true},
		{BlockAnnouncements, "Announcements", "Short notices, newest first.", false},
		{BlockLeadership, "Leadership", "Your pastors and staff.", false},
		{BlockContactAndDirections, "Contact and directions", "Address, phone, and a map link.", false},
		{BlockLiveStream, "Live stream", "Your YouTube or Facebook stream.", false},
		{BlockGallery, "Photos", "A handful of images from church life.", false},
		{BlockSpacer, "Space", "Breathing room between sections.", false},
	}
}

// ValidateBlock checks a block's data against its type and returns it cleaned.
//
// Every block goes through this on save. Nothing reaches the database
// unvalidated, which is what makes the renderer able to trust the shape it
// reads — the alternative is a renderer full of defensive checks that each have
// to be right.
func ValidateBlock(blockType BlockType, data map[string]any) (map[string]any, error) {
	if data == nil {
		data = map[string]any{}
	}

	switch blockType {
	case BlockHero:
		return validateHero(data)
	case BlockRichText:
		return validateRichTextBlock(data)
	case BlockServiceTimes:
		return validateServiceTimes(data)
	case BlockGivingCTA:
		return validateGivingCTA(data)
	case BlockLiveStream:
		return validateLiveStream(data)
	case BlockContactAndDirections:
		return validateContact(data)
	case BlockLeadership:
		return validateLeadership(data)
	case BlockGallery:
		return validateGallery(data)
	case BlockAnnouncements:
		return validateAnnouncements(data)
	case BlockEvents, BlockSermons:
		return validateFeed(data)
	case BlockSpacer:
		return validateSpacer(data)
	default:
		return nil, fmt.Errorf("%w: %q", ErrBlockType, blockType)
	}
}

// --- individual blocks -----------------------------------------------------

func validateHero(data map[string]any) (map[string]any, error) {
	out := map[string]any{
		"heading":    text(data, "heading", 120),
		"subheading": text(data, "subheading", 300),
	}
	if out["heading"] == "" {
		return nil, fmt.Errorf("%w: a welcome banner needs a heading", ErrBlockData)
	}
	if err := optionalURL(data, out, "imageUrl"); err != nil {
		return nil, err
	}
	if err := optionalURL(data, out, "ctaUrl"); err != nil {
		return nil, err
	}
	if label := text(data, "ctaLabel", 40); label != "" {
		out["ctaLabel"] = label
	}
	// A button with a label and nowhere to go is a dead end on the church's
	// front page. Refused rather than rendered.
	if _, hasLabel := out["ctaLabel"]; hasLabel {
		if _, hasURL := out["ctaUrl"]; !hasURL {
			return nil, fmt.Errorf("%w: the banner's button needs a link", ErrBlockData)
		}
	}
	return out, nil
}

func validateRichTextBlock(data map[string]any) (map[string]any, error) {
	nodes, err := decodeNodes(data["content"])
	if err != nil {
		return nil, err
	}
	cleaned, err := ValidateRichText(nodes)
	if err != nil {
		return nil, err
	}
	return map[string]any{"content": cleaned}, nil
}

func validateServiceTimes(data map[string]any) (map[string]any, error) {
	raw, _ := data["services"].([]any)
	if len(raw) > 20 {
		return nil, fmt.Errorf("%w: at most 20 services", ErrBlockData)
	}

	services := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name := text(entry, "name", 80)
		when := text(entry, "time", 80)
		if name == "" && when == "" {
			continue
		}
		service := map[string]any{
			"name":     name,
			"time":     when,
			"location": text(entry, "location", 160),
			"note":     text(entry, "note", 200),
		}
		services = append(services, service)
	}
	if len(services) == 0 {
		return nil, fmt.Errorf("%w: add at least one service", ErrBlockData)
	}
	return map[string]any{
		"heading":  textOr(data, "heading", 120, "Service times"),
		"services": services,
	}, nil
}

func validateGivingCTA(data map[string]any) (map[string]any, error) {
	// No URL field at all, deliberately. The destination is the church's OWN
	// giving page, derived from its id at render time — so a block that says
	// "give" cannot be pointed at somebody else's payment link, whether by
	// mistake or by a compromised staff account. That is the one field on a
	// church website where a wrong URL costs the congregation money.
	return map[string]any{
		"heading": textOr(data, "heading", 120, "Give"),
		"body":    text(data, "body", 400),
		"label":   textOr(data, "label", 40, "Give now"),
	}, nil
}

func validateLiveStream(data map[string]any) (map[string]any, error) {
	out := map[string]any{"heading": textOr(data, "heading", 120, "Watch live")}
	if err := optionalURL(data, out, "url"); err != nil {
		return nil, err
	}
	if _, ok := out["url"]; !ok {
		return nil, fmt.Errorf("%w: a live stream needs a link", ErrBlockData)
	}
	return out, nil
}

func validateContact(data map[string]any) (map[string]any, error) {
	out := map[string]any{
		"heading": textOr(data, "heading", 120, "Find us"),
		"address": text(data, "address", 400),
		"phone":   text(data, "phone", 40),
		"email":   text(data, "email", 160),
	}
	if err := optionalURL(data, out, "mapUrl"); err != nil {
		return nil, err
	}
	return out, nil
}

func validateLeadership(data map[string]any) (map[string]any, error) {
	raw, _ := data["people"].([]any)
	if len(raw) > 40 {
		return nil, fmt.Errorf("%w: at most 40 people", ErrBlockData)
	}

	people := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name := text(entry, "name", 120)
		if name == "" {
			continue
		}
		person := map[string]any{
			"name": name,
			"role": text(entry, "role", 120),
			"bio":  text(entry, "bio", 600),
		}
		if err := optionalURL(entry, person, "photoUrl"); err != nil {
			return nil, err
		}
		people = append(people, person)
	}
	return map[string]any{
		"heading": textOr(data, "heading", 120, "Our leadership"),
		"people":  people,
	}, nil
}

func validateGallery(data map[string]any) (map[string]any, error) {
	raw, _ := data["images"].([]any)
	// Bounded because every image is a request on a page a congregation loads
	// over mobile data.
	if len(raw) > 30 {
		return nil, fmt.Errorf("%w: at most 30 photos", ErrBlockData)
	}

	images := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		image := map[string]any{
			// Alt text, always. A church site is read by people using screen
			// readers and indexed by crawlers that cannot see images.
			"alt": text(entry, "alt", 200),
		}
		if err := optionalURL(entry, image, "url"); err != nil {
			return nil, err
		}
		if _, ok := image["url"]; !ok {
			continue
		}
		images = append(images, image)
	}
	return map[string]any{
		"heading": text(data, "heading", 120),
		"images":  images,
	}, nil
}

func validateAnnouncements(data map[string]any) (map[string]any, error) {
	raw, _ := data["items"].([]any)
	if len(raw) > 20 {
		return nil, fmt.Errorf("%w: at most 20 announcements", ErrBlockData)
	}

	items := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		title := text(entry, "title", 160)
		if title == "" {
			continue
		}
		announcement := map[string]any{
			"title": title,
			"body":  text(entry, "body", 600),
		}
		if err := optionalURL(entry, announcement, "linkUrl"); err != nil {
			return nil, err
		}
		items = append(items, announcement)
	}
	return map[string]any{
		"heading": textOr(data, "heading", 120, "Announcements"),
		"items":   items,
	}, nil
}

// validateFeed covers events and sermons, which carry no content of their own.
//
// They hold only how MUCH to show, because their content is the church's own
// records — that is the whole point of them existing as blocks rather than as
// text somebody re-types.
func validateFeed(data map[string]any) (map[string]any, error) {
	limit := intOr(data, "limit", 3)
	if limit < 1 {
		limit = 1
	}
	if limit > 12 {
		limit = 12
	}
	return map[string]any{
		"heading": text(data, "heading", 120),
		"limit":   limit,
	}, nil
}

func validateSpacer(data map[string]any) (map[string]any, error) {
	size := strings.ToLower(text(data, "size", 20))
	switch size {
	case "small", "medium", "large":
	default:
		size = "medium"
	}
	return map[string]any{"size": size}, nil
}

// --- helpers ---------------------------------------------------------------

// text reads a string field, trims it, strips control characters and truncates.
//
// Truncation rather than refusal for length: a church pasting a slightly long
// heading should get a slightly short heading, not an error that loses the rest
// of the form.
func text(data map[string]any, key string, max int) string {
	raw, _ := data[key].(string)
	cleaned := strings.TrimSpace(sanitiseText(raw))
	runes := []rune(cleaned)
	if len(runes) > max {
		return strings.TrimSpace(string(runes[:max]))
	}
	return cleaned
}

func textOr(data map[string]any, key string, max int, fallback string) string {
	if v := text(data, key, max); v != "" {
		return v
	}
	return fallback
}

func intOr(data map[string]any, key string, fallback int) int {
	switch v := data[key].(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		// What JSON numbers decode to.
		return int(v)
	}
	return fallback
}

// optionalURL validates a URL field when present, and omits it when not.
//
// Omitted rather than stored empty — the same lesson as the sparse index: an
// empty string is a value, and a renderer checking `if url` behaves differently
// from one checking `if "url" in data`.
func optionalURL(in map[string]any, out map[string]any, key string) error {
	raw, _ := in[key].(string)
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	validated, err := ValidateURL(raw)
	if err != nil {
		return fmt.Errorf("%s: %w", key, err)
	}
	out[key] = validated
	return nil
}

// decodeNodes converts decoded JSON into rich-text nodes.
//
// Written by hand rather than round-tripping through encoding/json because the
// input arrives as map[string]any from the HTTP layer, and a second marshal
// step would be doing work twice to reach the same place.
func decodeNodes(raw any) ([]Node, error) {
	items, ok := raw.([]any)
	if !ok {
		if raw == nil {
			return nil, nil
		}
		return nil, fmt.Errorf("%w: content must be a list of paragraphs", ErrRichTextInvalid)
	}

	nodes := make([]Node, 0, len(items))
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%w: a paragraph must be an object", ErrRichTextInvalid)
		}
		nodeType, _ := entry["type"].(string)
		node := Node{
			Type:    NodeType(nodeType),
			Level:   intOr(entry, "level", 0),
			Ordered: boolOr(entry, "ordered"),
		}

		if spans, ok := entry["spans"].([]any); ok {
			node.Spans = decodeSpans(spans)
		}
		if items, ok := entry["items"].([]any); ok {
			for _, listItem := range items {
				spans, _ := listItem.([]any)
				node.Items = append(node.Items, decodeSpans(spans))
			}
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

func decodeSpans(raw []any) []Span {
	spans := make([]Span, 0, len(raw))
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		span := Span{Text: stringOf(entry["text"]), Href: stringOf(entry["href"])}
		if marks, ok := entry["marks"].([]any); ok {
			for _, mark := range marks {
				span.Marks = append(span.Marks, MarkType(stringOf(mark)))
			}
		}
		spans = append(spans, span)
	}
	return spans
}

func stringOf(v any) string {
	s, _ := v.(string)
	return s
}

func boolOr(data map[string]any, key string) bool {
	b, _ := data[key].(bool)
	return b
}

// SortBlocks orders blocks by position, which is the order they render in.
func SortBlocks(blocks []Block) {
	sort.SliceStable(blocks, func(i, j int) bool {
		return blocks[i].Position < blocks[j].Position
	})
}
