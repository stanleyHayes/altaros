package finance

import (
	"errors"
	"strings"
	"testing"
)

// The cover image is the one campaign field a church supplies and the whole
// internet renders — the congregation's app, the church's own public site, and
// the ALTAR OS directory. It was documented as "checked against the media
// rules" and checked by nothing, which is the dangerous combination: the next
// person to wire it up reads the comment and trusts it.
func TestCoverImageMustBeAnHTTPSLink(t *testing.T) {
	rejected := []string{
		// Not pictures at all. This is how an image field becomes a script on
		// somebody else's page.
		"javascript:alert(1)",
		"JavaScript:alert(1)",
		"data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==",
		// Plain http on an https page is blocked as mixed content, so a church
		// sees a broken appeal it cannot explain.
		"http://example.org/roof.jpg",
		"https://",
		"not a url at all",
		"https://" + strings.Repeat("a", maxImageURL),
	}
	for _, raw := range rejected {
		if _, err := normaliseImageURL(raw); !errors.Is(err, ErrCampaignImage) {
			t.Errorf("accepted %q as a cover image: %v", raw, err)
		}
	}

	accepted := map[string]string{
		"https://cdn.example.org/roof.jpg":  "https://cdn.example.org/roof.jpg",
		"  https://cdn.example.org/a.png  ": "https://cdn.example.org/a.png",
		// Scheme comparison is case-insensitive, because a browser treats
		// these as the same URL and a naive check does not.
		"HTTPS://cdn.example.org/b.png": "HTTPS://cdn.example.org/b.png",
		// Absent is fine — most appeals have no picture.
		"":    "",
		"   ": "",
	}
	for raw, want := range accepted {
		got, err := normaliseImageURL(raw)
		if err != nil {
			t.Errorf("rejected %q: %v", raw, err)
			continue
		}
		if got != want {
			t.Errorf("normaliseImageURL(%q) = %q, want %q", raw, got, want)
		}
	}
}

// A campaign carrying a bad image must be REFUSED, not stored with the field
// quietly dropped — a church that pasted a link and saw no error believes the
// picture is set.
func TestCampaignNormaliseRejectsABadImage(t *testing.T) {
	_, err := CampaignInput{
		Title: "Roof", TargetAmount: 1000, CoverImageURL: "javascript:alert(1)",
	}.normalise()
	if !errors.Is(err, ErrCampaignImage) {
		t.Fatalf("a campaign with a script URL normalised cleanly: %v", err)
	}
}
