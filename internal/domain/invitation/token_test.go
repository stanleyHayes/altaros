package invitation

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// These need no database: they are about the token and the contact rules.

func TestEveryTokenIsDifferent(t *testing.T) {
	seen := map[string]bool{}
	for range 500 {
		raw, hashed, err := newToken()
		if err != nil {
			t.Fatalf("newToken: %v", err)
		}
		if seen[raw] {
			t.Fatal("newToken repeated a token")
		}
		seen[raw] = true

		if raw == hashed {
			t.Fatal("the stored value is the raw token")
		}
		if hashToken(raw) != hashed {
			t.Fatal("the returned hash is not the hash of the returned token")
		}
	}
}

// TestTheTokenSurvivesBeingPastedIntoAMessage matters more than it looks: an
// invitation link gets forwarded through WhatsApp and SMS, and a token
// containing "+" or "/" is silently mangled by URL handling along the way.
func TestTheTokenSurvivesBeingPastedIntoAMessage(t *testing.T) {
	raw, _, err := newToken()
	if err != nil {
		t.Fatalf("newToken: %v", err)
	}
	if strings.ContainsAny(raw, "+/=&?# ") {
		t.Fatalf("token %q contains a character that URL handling will change", raw)
	}
	if len(raw) < 40 {
		t.Fatalf("token is only %d characters; that is not 32 bytes of entropy", len(raw))
	}
}

func TestSurroundingWhitespaceDoesNotBreakAToken(t *testing.T) {
	raw, hashed, err := newToken()
	if err != nil {
		t.Fatalf("newToken: %v", err)
	}
	// Someone copying a link out of an email selects the trailing space too.
	if hashToken("  "+raw+"\n") != hashed {
		t.Fatal("a token with surrounding whitespace does not resolve")
	}
}

func TestLiveRequiresBothPendingAndUnexpired(t *testing.T) {
	now := time.Now()
	future := now.Add(time.Hour)
	past := now.Add(-time.Hour)

	cases := []struct {
		name   string
		status Status
		expiry time.Time
		want   bool
	}{
		{"pending and in date", StatusPending, future, true},
		{"pending but expired", StatusPending, past, false},
		{"accepted and in date", StatusAccepted, future, false},
		{"revoked and in date", StatusRevoked, future, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inv := &Invitation{Status: tc.status, ExpiresAt: tc.expiry}
			if got := inv.Live(now); got != tc.want {
				t.Fatalf("Live = %v, want %v", got, tc.want)
			}
		})
	}

	if (*Invitation)(nil).Live(now) {
		t.Fatal("a nil invitation is not live")
	}
}

func TestNormaliseContact(t *testing.T) {
	cases := []struct {
		name      string
		email     string
		phone     string
		wantEmail string
		wantPhone string
		wantErr   error
	}{
		{
			name: "email is lower-cased so one person is one account",
			// The secretary types it as it appears on the form.
			email: "  Pastor.Mensah@Church.ORG ", wantEmail: "pastor.mensah@church.org",
		},
		{
			// The same number written three ways by three people has to be one
			// person, which is why this goes through E.164 rather than being
			// stored as typed.
			name:  "a local number becomes E.164",
			phone: "024 555 0101", wantPhone: "+233245550101",
		},
		{
			name:    "neither is refused",
			wantErr: ErrContactRequired,
		},
		{
			name:    "a malformed email is refused",
			email:   "not-an-address",
			wantErr: ErrEmailInvalid,
		},
		{
			name:    "a display-name email is refused",
			email:   "Pastor Mensah <pastor@church.org>",
			wantErr: ErrEmailInvalid,
		},
		{
			name:    "a malformed phone is refused",
			phone:   "12",
			wantErr: ErrPhoneInvalid,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			email, phone, err := normaliseContact(tc.email, tc.phone)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if email != tc.wantEmail {
				t.Errorf("email = %q, want %q", email, tc.wantEmail)
			}
			if phone != tc.wantPhone {
				t.Errorf("phone = %q, want %q", phone, tc.wantPhone)
			}
		})
	}
}

func TestContactPrefersEmail(t *testing.T) {
	both := &Invitation{Email: "a@b.org", Phone: "+233245550101"}
	if both.Contact() != "a@b.org" {
		t.Fatalf("Contact = %q, want the email", both.Contact())
	}
	phoneOnly := &Invitation{Phone: "+233245550101"}
	if phoneOnly.Contact() != "+233245550101" {
		t.Fatalf("Contact = %q, want the phone", phoneOnly.Contact())
	}
}
