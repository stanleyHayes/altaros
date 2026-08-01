package site

import (
	"errors"
	"strings"
	"testing"
)

// §13.5 — the security boundary.
//
// The editor is a church staff member and the audience is that church's own
// congregation: the people most likely to trust whatever the page says. So an
// XSS here is not "a script runs", it is "the church's own website asks its
// members for their mobile-money PIN and they believe it".

// TestJavascriptURLsAreRefused covers the cheapest possible XSS and, more
// importantly, every spelling of it a browser accepts.
//
// A denylist has to anticipate all of these. The allowlist has to anticipate
// nothing, which is why it is an allowlist.
func TestJavascriptURLsAreRefused(t *testing.T) {
	hostile := []struct{ url, why string }{
		{"javascript:alert(1)", "the plain form"},
		{"JavaScript:alert(1)", "uppercase"},
		{"JaVaScRiPt:alert(1)", "mixed case"},
		{"  javascript:alert(1)", "leading whitespace, which browsers ignore"},
		{"java\tscript:alert(1)", "an embedded tab, which browsers ignore"},
		{"java\nscript:alert(1)", "an embedded newline"},
		{"java\rscript:alert(1)", "an embedded carriage return"},
		{"java\x00script:alert(1)", "an embedded null"},
		{"\x01javascript:alert(1)", "a leading control character"},
		{"vbscript:msgbox(1)", "the other scriptable scheme"},
		{"data:text/html,<script>alert(1)</script>", "a data URL rendering HTML"},
		{"data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", "base64 data"},
		{"file:///etc/passwd", "a local file"},
		{"blob:https://example.com/uuid", "a blob URL"},
	}

	for _, c := range hostile {
		t.Run(c.why, func(t *testing.T) {
			got, err := ValidateURL(c.url)
			if err == nil {
				t.Fatalf("ValidateURL(%q) returned %q with no error — this is a "+
					"link a church staff member can put on their own front page",
					c.url, got)
			}
			if !errors.Is(err, ErrURLScheme) && !errors.Is(err, ErrURLInvalid) {
				t.Errorf("err = %v, want a scheme or parse refusal", err)
			}
		})
	}
}

func TestLegitimateURLsAreAccepted(t *testing.T) {
	cases := map[string]string{
		"https://youtube.com/live/abc": "https://youtube.com/live/abc",
		"http://example.org":           "http://example.org",
		"mailto:office@church.org":     "mailto:office@church.org",
		"tel:+233241234567":            "tel:+233241234567",
		"/about":                       "/about",
		// No scheme and not relative: a church typing "gracechapel.org" means
		// the website. Making it explicit removes the ambiguity rather than
		// storing something a browser will treat as a relative path.
		"gracechapel.org": "https://gracechapel.org",
	}
	for input, want := range cases {
		got, err := ValidateURL(input)
		if err != nil {
			t.Errorf("ValidateURL(%q) = %v, want %q", input, err, want)
			continue
		}
		if got != want {
			t.Errorf("ValidateURL(%q) = %q, want %q", input, got, want)
		}
	}
}

// A protocol-relative URL inherits the page's scheme and points off-site. It is
// not a path, and treating it as one would let //evil.test through the
// relative-link shortcut.
func TestProtocolRelativeURLsAreNotTreatedAsPaths(t *testing.T) {
	got, err := ValidateURL("//evil.test/steal")
	if err == nil && strings.HasPrefix(got, "//") {
		t.Fatalf("ValidateURL(//evil.test) = %q; a protocol-relative URL was "+
			"treated as a same-site path", got)
	}
}

// TestRichTextAcceptsNoHTML is the structural property this design is for.
//
// There is no HTML anywhere in the content model, so markup in a text field is
// TEXT — it cannot become an element however it is spelled, because the
// renderer emits from a closed set of node types rather than from a string.
func TestRichTextAcceptsNoHTML(t *testing.T) {
	nodes := []Node{{
		Type: NodeParagraph,
		Spans: []Span{
			{Text: `<script>alert(1)</script>`},
			{Text: `<img src=x onerror=alert(1)>`},
		},
	}}

	cleaned, err := ValidateRichText(nodes)
	if err != nil {
		t.Fatalf("ValidateRichText: %v", err)
	}
	if len(cleaned) != 1 {
		t.Fatalf("got %d nodes, want 1", len(cleaned))
	}

	// The text is PRESERVED, not stripped — a church writing about "the <b>
	// tag" in a tutorial should see what they typed. It is safe because it is
	// stored as text in a typed field, and the renderer will escape it.
	if !strings.Contains(cleaned[0].Spans[0].Text, "<script>") {
		t.Error("the text was mangled; it does not need to be, because it is " +
			"never interpreted as markup")
	}
	// And there is nowhere for it to have become markup: the node type is from
	// the closed set and carries no HTML field at all.
	if cleaned[0].Type != NodeParagraph {
		t.Errorf("node type = %q, want paragraph", cleaned[0].Type)
	}
}

// An unknown node or mark is REFUSED rather than dropped, so an editor learns
// immediately instead of finding later that content silently vanished.
func TestUnknownFormattingIsRefused(t *testing.T) {
	if _, err := ValidateRichText([]Node{{Type: "html", Spans: []Span{{Text: "x"}}}}); !errors.Is(err, ErrRichTextInvalid) {
		t.Errorf("an unknown node type = %v, want ErrRichTextInvalid", err)
	}
	if _, err := ValidateRichText([]Node{{
		Type:  NodeParagraph,
		Spans: []Span{{Text: "x", Marks: []MarkType{"script"}}},
	}}); !errors.Is(err, ErrRichTextInvalid) {
		t.Errorf("an unknown mark = %v, want ErrRichTextInvalid", err)
	}
}

// A link mark carries an href, and that href goes through the same allowlist.
// This is the path most likely to be missed, because the URL is nested two
// levels inside a document rather than being its own field.
func TestALinkInsideRichTextIsValidatedToo(t *testing.T) {
	_, err := ValidateRichText([]Node{{
		Type: NodeParagraph,
		Spans: []Span{{
			Text:  "click here",
			Marks: []MarkType{MarkLink},
			Href:  "javascript:alert(1)",
		}},
	}})
	if !errors.Is(err, ErrURLScheme) {
		t.Fatalf("got %v, want ErrURLScheme — a link nested in a paragraph is "+
			"still a link", err)
	}
}

// A bidirectional override makes a link's visible text read differently from
// where it points, which is a phishing primitive rather than a formatting one.
func TestBidirectionalOverridesAreStripped(t *testing.T) {
	cleaned, err := ValidateRichText([]Node{{
		Type:  NodeParagraph,
		Spans: []Span{{Text: "safe‮txt.exe"}},
	}})
	if err != nil {
		t.Fatalf("ValidateRichText: %v", err)
	}
	if strings.ContainsRune(cleaned[0].Spans[0].Text, '‮') {
		t.Error("a right-to-left override survived; it can make a filename or a " +
			"link read backwards")
	}
}

// Headings are h2/h3 only. The page title is the h1, and a second one is an
// accessibility defect rather than a style choice.
func TestHeadingLevelsAreConstrained(t *testing.T) {
	for _, requested := range []int{0, 1, 4, 7, -2} {
		cleaned, err := ValidateRichText([]Node{{
			Type: NodeHeading, Level: requested, Spans: []Span{{Text: "Heading"}},
		}})
		if err != nil {
			t.Fatalf("level %d: %v", requested, err)
		}
		if got := cleaned[0].Level; got != 2 && got != 3 {
			t.Errorf("level %d became %d, want 2 or 3", requested, got)
		}
	}
}

// A bound on size is not a style rule: without it one page can be made large
// enough to be a denial of service against the renderer, and the person doing
// it is signed in as church staff — as likely an accidental paste as an attack.
func TestRichTextIsBounded(t *testing.T) {
	huge := make([]Node, maxRichTextNodes+1)
	for i := range huge {
		huge[i] = Node{Type: NodeParagraph, Spans: []Span{{Text: "x"}}}
	}
	if _, err := ValidateRichText(huge); !errors.Is(err, ErrRichTextInvalid) {
		t.Errorf("got %v, want a refusal for too many paragraphs", err)
	}

	long := []Node{{Type: NodeParagraph, Spans: []Span{{Text: strings.Repeat("x", maxSpanRunes+1)}}}}
	if _, err := ValidateRichText(long); !errors.Is(err, ErrRichTextInvalid) {
		t.Errorf("got %v, want a refusal for an over-long paragraph", err)
	}
}

// --- blocks ---------------------------------------------------------------

// Every block that takes a URL runs it through the allowlist. Missing one is
// the likely mistake, so this walks them rather than testing one.
func TestEveryBlockURLFieldIsValidated(t *testing.T) {
	const hostile = "javascript:alert(1)"

	cases := []struct {
		blockType BlockType
		data      map[string]any
	}{
		{BlockHero, map[string]any{"heading": "Welcome", "imageUrl": hostile}},
		{BlockHero, map[string]any{"heading": "Welcome", "ctaUrl": hostile, "ctaLabel": "Go"}},
		{BlockLiveStream, map[string]any{"url": hostile}},
		{BlockContactAndDirections, map[string]any{"mapUrl": hostile}},
		{BlockGallery, map[string]any{"images": []any{
			map[string]any{"url": hostile, "alt": "x"},
		}}},
		{BlockLeadership, map[string]any{"people": []any{
			map[string]any{"name": "Pastor", "photoUrl": hostile},
		}}},
		{BlockAnnouncements, map[string]any{"items": []any{
			map[string]any{"title": "Notice", "linkUrl": hostile},
		}}},
	}

	for _, c := range cases {
		t.Run(string(c.blockType), func(t *testing.T) {
			if _, err := ValidateBlock(c.blockType, c.data); err == nil {
				t.Fatalf("%s accepted %q", c.blockType, hostile)
			}
		})
	}
}

// The giving block has NO url field, deliberately. It is the one place on a
// church website where a wrong link costs the congregation money, so the
// destination is derived from the church rather than typed.
func TestTheGivingBlockCannotBePointedElsewhere(t *testing.T) {
	data, err := ValidateBlock(BlockGivingCTA, map[string]any{
		"heading": "Give",
		"url":     "https://attacker.test/collect",
		"ctaUrl":  "https://attacker.test/collect",
		"link":    "https://attacker.test/collect",
	})
	if err != nil {
		t.Fatalf("ValidateBlock: %v", err)
	}
	for key, value := range data {
		if str, ok := value.(string); ok && strings.Contains(str, "attacker.test") {
			t.Fatalf("field %q kept an attacker-supplied destination: %q", key, str)
		}
	}
	for _, key := range []string{"url", "ctaUrl", "link", "href"} {
		if _, present := data[key]; present {
			t.Errorf("the giving block must not carry a %q field at all", key)
		}
	}
}

func TestUnknownBlockTypesAreRefused(t *testing.T) {
	for _, blockType := range []BlockType{"custom_html", "script", "iframe", ""} {
		if _, err := ValidateBlock(blockType, map[string]any{}); !errors.Is(err, ErrBlockType) {
			t.Errorf("ValidateBlock(%q) = %v, want ErrBlockType", blockType, err)
		}
	}
}

// Every block in the advertised library must actually validate, or the editor
// offers a section that cannot be saved.
func TestEveryAdvertisedBlockCanBeSaved(t *testing.T) {
	minimal := map[BlockType]map[string]any{
		BlockHero:     {"heading": "Welcome"},
		BlockRichText: {"content": []any{}},
		BlockServiceTimes: {"services": []any{
			map[string]any{"name": "Sunday Service", "time": "9:00 AM"},
		}},
		BlockLiveStream: {"url": "https://youtube.com/live/x"},
	}

	for _, descriptor := range BlockLibrary() {
		t.Run(string(descriptor.Type), func(t *testing.T) {
			data, ok := minimal[descriptor.Type]
			if !ok {
				data = map[string]any{}
			}
			if _, err := ValidateBlock(descriptor.Type, data); err != nil {
				t.Fatalf("the library advertises %s but it cannot be saved: %v",
					descriptor.Type, err)
			}
		})
	}
}

// A banner button with a label and no destination is a dead end on the
// church's front page.
func TestAHeroButtonNeedsSomewhereToGo(t *testing.T) {
	if _, err := ValidateBlock(BlockHero, map[string]any{
		"heading": "Welcome", "ctaLabel": "Plan your visit",
	}); !errors.Is(err, ErrBlockData) {
		t.Errorf("got %v, want a refusal for a button with no link", err)
	}
}
