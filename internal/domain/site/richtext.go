package site

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode"
)

// Rich text and URLs — the security boundary (§13.5).
//
// # A deliberate change from the plan, and why
//
// §13.5 says rich text is "a constrained subset (headings, bold, italic, lists,
// links) SANITISED server-side on save and again on render". This stores
// STRUCTURED NODES instead, and accepts no HTML at any point.
//
// The reason is what the sanitiser is standing in front of. The editor is a
// church secretary; the audience is that church's own congregation — the people
// most likely to trust whatever the page says. A sanitiser is a denylist
// pretending to be an allowlist: it has to be right about every parser quirk,
// every mutation-XSS case, every encoding, forever. Structured nodes remove it
// from the trust path entirely. There is no HTML to sanitise because there is
// no HTML: the renderer emits elements from a closed set, and a value that is
// not in that set cannot become markup however it is spelled.
//
// The cost is real and worth naming: the editor must produce this shape rather
// than a contenteditable's innerHTML, and pasting formatted text from Word has
// to be converted rather than accepted. That is a bigger frontend job. It is
// also the difference between "we sanitise" and "there is nothing to sanitise".

// NodeType is one kind of rich-text node. Closed set, by construction.
type NodeType string

const (
	NodeParagraph NodeType = "paragraph"
	NodeHeading   NodeType = "heading"
	NodeList      NodeType = "list"
	NodeQuote     NodeType = "quote"
)

// MarkType is inline emphasis. Also closed.
type MarkType string

const (
	MarkBold   MarkType = "bold"
	MarkItalic MarkType = "italic"
	MarkLink   MarkType = "link"
)

var (
	// ErrRichTextInvalid means a document used something outside the closed set.
	ErrRichTextInvalid = errors.New("site: that formatting is not supported")
	// ErrURLScheme means a link used a scheme that is not allowed.
	ErrURLScheme = errors.New("site: that kind of link is not allowed")
	// ErrURLInvalid means a URL could not be parsed at all.
	ErrURLInvalid = errors.New("site: that link is not a valid address")
)

// Span is a run of text with optional emphasis.
type Span struct {
	Text string `bson:"text" json:"text"`
	// Marks are the emphasis applied to this run. A closed set, so "bold" is
	// the only way to get bold and there is no attribute to smuggle anything
	// through.
	Marks []MarkType `bson:"marks,omitempty" json:"marks,omitempty"`
	// Href is set only when Marks contains MarkLink, and is validated against
	// the scheme allowlist on save.
	Href string `bson:"href,omitempty" json:"href,omitempty"`
}

// Node is one block-level element of a rich-text document.
type Node struct {
	Type NodeType `bson:"type" json:"type"`
	// Level applies to headings: 2 or 3 only. Not 1 — the page title is the
	// h1, and a second one on the page is a real accessibility problem rather
	// than a style preference.
	Level int `bson:"level,omitempty" json:"level,omitempty"`
	// Ordered applies to lists.
	Ordered bool `bson:"ordered,omitempty" json:"ordered,omitempty"`
	// Spans is the content of a paragraph, heading or quote.
	Spans []Span `bson:"spans,omitempty" json:"spans,omitempty"`
	// Items is the content of a list: one span run per item.
	Items [][]Span `bson:"items,omitempty" json:"items,omitempty"`
}

// maxRichTextNodes bounds a single rich-text field.
//
// Not a style rule. Without a bound, one page can be made large enough to be a
// denial of service against the renderer, and the person doing it is signed in
// as a church staff member — which makes it a plausible accident as much as an
// attack (a paste from a long document).
const (
	maxRichTextNodes = 200
	maxSpansPerNode  = 100
	maxSpanRunes     = 5000
	maxListItems     = 100
)

// ValidateRichText checks a document against the closed set and returns a
// cleaned copy.
//
// Returns a NEW slice rather than mutating: the caller's input is untrusted by
// definition, and handing back a value derived from it makes it obvious in the
// calling code which one is safe to store.
func ValidateRichText(nodes []Node) ([]Node, error) {
	if len(nodes) > maxRichTextNodes {
		return nil, fmt.Errorf("%w: a section may hold at most %d paragraphs",
			ErrRichTextInvalid, maxRichTextNodes)
	}

	out := make([]Node, 0, len(nodes))
	for i, node := range nodes {
		cleaned, err := validateNode(node)
		if err != nil {
			return nil, fmt.Errorf("paragraph %d: %w", i+1, err)
		}
		// Drop nodes that ended up with no content. An empty paragraph is what
		// a stray Enter produces, and storing it renders a gap nobody asked
		// for.
		if cleaned.isEmpty() {
			continue
		}
		out = append(out, cleaned)
	}
	return out, nil
}

// isEmpty reports whether a node would render as nothing.
//
// Reaching the end means every text run was blank, which is what a stray Enter
// produces — storing it renders a gap nobody asked for.
func (n Node) isEmpty() bool {
	for _, s := range n.Spans {
		if strings.TrimSpace(s.Text) != "" {
			return false
		}
	}
	for _, item := range n.Items {
		for _, s := range item {
			if strings.TrimSpace(s.Text) != "" {
				return false
			}
		}
	}
	return true
}

func validateNode(node Node) (Node, error) {
	switch node.Type {
	case NodeParagraph, NodeQuote:
		spans, err := validateSpans(node.Spans)
		if err != nil {
			return Node{}, err
		}
		return Node{Type: node.Type, Spans: spans}, nil

	case NodeHeading:
		// 2 or 3 only. The page title is the h1; a second h1 is an
		// accessibility defect, and h4+ on a church page is a hierarchy nobody
		// is actually maintaining.
		level := node.Level
		if level != 2 && level != 3 {
			level = 2
		}
		spans, err := validateSpans(node.Spans)
		if err != nil {
			return Node{}, err
		}
		return Node{Type: NodeHeading, Level: level, Spans: spans}, nil

	case NodeList:
		if len(node.Items) > maxListItems {
			return Node{}, fmt.Errorf("%w: a list may hold at most %d items",
				ErrRichTextInvalid, maxListItems)
		}
		items := make([][]Span, 0, len(node.Items))
		for _, item := range node.Items {
			spans, err := validateSpans(item)
			if err != nil {
				return Node{}, err
			}
			items = append(items, spans)
		}
		return Node{Type: NodeList, Ordered: node.Ordered, Items: items}, nil

	default:
		// Anything outside the closed set. Refused rather than dropped, so an
		// editor sending an unsupported node learns immediately instead of
		// discovering later that some of their content silently vanished.
		return Node{}, fmt.Errorf("%w: %q", ErrRichTextInvalid, node.Type)
	}
}

func validateSpans(spans []Span) ([]Span, error) {
	if len(spans) > maxSpansPerNode {
		return nil, fmt.Errorf("%w: too many formatting runs in one paragraph",
			ErrRichTextInvalid)
	}

	out := make([]Span, 0, len(spans))
	for _, span := range spans {
		text := sanitiseText(span.Text)
		if len([]rune(text)) > maxSpanRunes {
			return nil, fmt.Errorf("%w: that paragraph is too long", ErrRichTextInvalid)
		}

		cleaned := Span{Text: text}
		for _, mark := range span.Marks {
			switch mark {
			case MarkBold, MarkItalic:
				cleaned.Marks = append(cleaned.Marks, mark)
			case MarkLink:
				href, err := ValidateURL(span.Href)
				if err != nil {
					return nil, err
				}
				cleaned.Marks = append(cleaned.Marks, MarkLink)
				cleaned.Href = href
			default:
				return nil, fmt.Errorf("%w: %q", ErrRichTextInvalid, mark)
			}
		}
		out = append(out, cleaned)
	}
	return out, nil
}

// sanitiseText strips control characters from a text run.
//
// Not an XSS defence — there is no HTML here, so text is text. This removes the
// characters that break a rendered page in other ways: a bidirectional override
// can make a link's visible text read differently from where it points, and a
// zero-width character makes two visibly identical page slugs.
func sanitiseText(s string) string {
	return strings.Map(func(r rune) rune {
		switch r {
		case '\n', '\t':
			// Kept: a paragraph legitimately contains a line break.
			return ' '
		}
		// Bidirectional overrides and other formatting characters. U+202E
		// alone is enough to display "gnip.exe" as "exe.ping".
		if unicode.Is(unicode.Cf, r) || unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
}

// allowedSchemes is the URL allowlist.
//
// An allowlist rather than a denylist of `javascript:` and friends, because a
// denylist has to anticipate every spelling — and there are many: uppercase,
// leading whitespace, embedded tabs and newlines inside the scheme, and
// percent-encoding. An allowlist has to anticipate nothing.
var allowedSchemes = map[string]bool{
	"http":  true,
	"https": true,
	// A church's contact block legitimately links an address and a phone
	// number, and neither can execute anything.
	"mailto": true,
	"tel":    true,
}

// ValidateURL checks a URL against the scheme allowlist and returns it cleaned.
//
// `javascript:` in a link field is the cheapest possible XSS, and it is exactly
// what a compromised or careless staff account would reach for.
func ValidateURL(raw string) (string, error) {
	// Strip the whitespace a browser ignores before parsing. `java\tscript:`
	// and ` javascript:` are both executed by browsers and both parse as a
	// relative path if left alone — so removing it first is what makes the
	// scheme check see what the browser will see.
	trimmed := strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return -1
		}
		return r
	}, raw)
	trimmed = strings.TrimSpace(trimmed)

	if trimmed == "" {
		return "", fmt.Errorf("%w: it is empty", ErrURLInvalid)
	}

	// A relative link within the church's own site. Allowed, and cannot carry
	// a scheme by definition.
	if strings.HasPrefix(trimmed, "/") && !strings.HasPrefix(trimmed, "//") {
		return trimmed, nil
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrURLInvalid, err)
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme == "" {
		// No scheme and not relative — "example.com/page". Browsers treat this
		// as relative; a church typing it means the website. Making it https
		// explicit is what the church intended and removes the ambiguity.
		return "https://" + trimmed, nil
	}
	if !allowedSchemes[scheme] {
		return "", fmt.Errorf("%w: %q", ErrURLScheme, scheme)
	}
	return parsed.String(), nil
}
