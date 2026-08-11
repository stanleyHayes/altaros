package media

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func testSigner(t *testing.T) *GrantSigner {
	t.Helper()
	s, err := NewGrantSigner("a-test-signing-key")
	if err != nil {
		t.Fatalf("NewGrantSigner: %v", err)
	}
	return s
}

func TestGrantRoundTrips(t *testing.T) {
	s := testSigner(t)
	want := GrantClaims{
		RoomID: "room-1", Identity: "member-9", Role: "viewer",
		ChurchID: "church-3", ExpiresAt: time.Now().Add(time.Hour).Unix(),
	}
	token, err := s.Sign(want)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	got, err := s.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if *got != want {
		t.Fatalf("round trip changed the claims:\n got %+v\nwant %+v", *got, want)
	}
}

// The whole point of signing: a viewer must not be able to promote themselves
// to publisher, or move their grant to another church's service.
func TestGrantRejectsATamperedPayload(t *testing.T) {
	s := testSigner(t)
	token, err := s.Sign(GrantClaims{
		RoomID: "room-1", Identity: "member-9", Role: "viewer",
		ExpiresAt: time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	payload, sig, _ := strings.Cut(token, ".")
	forged, err := s.Sign(GrantClaims{
		RoomID: "room-1", Identity: "member-9", Role: "publisher",
		ExpiresAt: time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	forgedPayload, _, _ := strings.Cut(forged, ".")

	// The publisher payload, carrying the viewer grant's signature.
	if _, err := s.Verify(forgedPayload + "." + sig); !errors.Is(err, ErrGrantInvalid) {
		t.Fatalf("a promoted role verified: %v", err)
	}
	// The viewer payload with a signature from elsewhere.
	if _, err := s.Verify(payload + ".not-the-signature"); !errors.Is(err, ErrGrantInvalid) {
		t.Fatalf("a bad signature verified: %v", err)
	}
}

func TestGrantRejectsAnotherKeysToken(t *testing.T) {
	mine := testSigner(t)
	theirs, err := NewGrantSigner("a-different-key")
	if err != nil {
		t.Fatalf("NewGrantSigner: %v", err)
	}
	token, err := theirs.Sign(GrantClaims{
		RoomID: "room-1", Identity: "member-9",
		ExpiresAt: time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if _, err := mine.Verify(token); !errors.Is(err, ErrGrantInvalid) {
		t.Fatalf("another key's grant verified: %v", err)
	}
}

func TestGrantExpires(t *testing.T) {
	s := testSigner(t)
	token, err := s.Sign(GrantClaims{
		RoomID: "room-1", Identity: "member-9",
		ExpiresAt: time.Now().Add(-time.Second).Unix(),
	})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if _, err := s.Verify(token); !errors.Is(err, ErrGrantExpired) {
		t.Fatalf("an expired grant verified: %v", err)
	}
}

// An expired grant we never issued must report INVALID, not expired. Answering
// "expired" would confirm to a forger that their payload was well formed and
// only the clock stood in the way.
func TestGrantChecksTheSignatureBeforeExpiry(t *testing.T) {
	s := testSigner(t)
	theirs, err := NewGrantSigner("a-different-key")
	if err != nil {
		t.Fatalf("NewGrantSigner: %v", err)
	}
	token, err := theirs.Sign(GrantClaims{
		RoomID: "room-1", Identity: "member-9",
		ExpiresAt: time.Now().Add(-time.Hour).Unix(),
	})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if _, err := s.Verify(token); !errors.Is(err, ErrGrantInvalid) {
		t.Fatalf("leaked that the payload parsed: %v", err)
	}
}

// A signer with no key must refuse to exist. Producing unsigned grants would
// leave a live endpoint anyone could reach by guessing a room id, looking
// exactly like a working system.
func TestGrantSignerRefusesAnEmptyKey(t *testing.T) {
	for _, key := range []string{"", "   "} {
		if _, err := NewGrantSigner(key); !errors.Is(err, ErrNoSigningKey) {
			t.Fatalf("built a signer with key %q: %v", key, err)
		}
	}
}

func TestGrantRejectsMalformedTokens(t *testing.T) {
	s := testSigner(t)
	for _, token := range []string{
		"", ".", "no-dot", "payload.", ".signature", "!!!.???",
	} {
		if _, err := s.Verify(token); err == nil {
			t.Fatalf("malformed token %q verified", token)
		}
	}
}
