package fieldcrypt

import (
	"errors"
	"strings"
	"testing"
)

func TestARoundTripReturnsTheOriginal(t *testing.T) {
	c, err := New("a-development-key")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	for _, plain := range []string{
		"Rent arrears of GHS 400. Landlord threatening eviction.",
		"Safeguarding: child disclosed abuse at home.",
		"unicode — accents, emoji 🙏, and quotes “like this”",
		" ",
	} {
		sealed, err := c.Encrypt(plain)
		if err != nil {
			t.Fatalf("Encrypt: %v", err)
		}
		if strings.Contains(sealed, plain) {
			t.Fatalf("the plaintext is visible in the stored value: %q", sealed)
		}
		back, err := c.Decrypt(sealed)
		if err != nil {
			t.Fatalf("Decrypt: %v", err)
		}
		if back != plain {
			t.Fatalf("round trip gave %q, want %q", back, plain)
		}
	}
}

func TestTheSameValueEncryptsDifferentlyEveryTime(t *testing.T) {
	// A deterministic ciphertext leaks equality: anybody reading the
	// collection could tell which cases share a note, and with a small set of
	// likely notes could recover them by comparison.
	c, _ := New("k")
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		sealed, err := c.Encrypt("Rent arrears")
		if err != nil {
			t.Fatalf("Encrypt: %v", err)
		}
		if seen[sealed] {
			t.Fatal("the same plaintext produced the same ciphertext twice — " +
				"the nonce is being reused, which in GCM is catastrophic rather " +
				"than merely weak")
		}
		seen[sealed] = true
	}
}

func TestATamperedValueFailsRatherThanDecryptingToSomethingElse(t *testing.T) {
	// For a welfare record this distinction matters: a silently altered case
	// note is worse than an unreadable one.
	c, _ := New("k")
	sealed, _ := c.Encrypt("Rent arrears of GHS 400")

	body := []byte(sealed)
	body[len(body)-2] ^= 0x01 // flip a bit in the base64 payload
	if _, err := c.Decrypt(string(body)); err == nil {
		t.Fatal("a tampered value decrypted without complaint")
	}
}

func TestTheWrongKeyCannotRead(t *testing.T) {
	// The whole point of a SEPARATE key: somebody holding the database and the
	// JWT secret still cannot read welfare cases.
	a, _ := New("the-welfare-key")
	b, _ := New("the-jwt-secret")

	sealed, _ := a.Encrypt("Safeguarding disclosure")
	if _, err := b.Decrypt(sealed); !errors.Is(err, ErrCiphertext) {
		t.Fatalf("a different key read the value: %v", err)
	}
}

func TestPlaintextWrittenBeforeEncryptionStillReads(t *testing.T) {
	// A migration that makes every existing case unreadable is a worse outcome
	// than a mixed collection being encrypted forward.
	c, _ := New("k")
	const legacy = "written by the TypeScript API before any of this existed"
	back, err := c.Decrypt(legacy)
	if err != nil {
		t.Fatalf("legacy plaintext failed to read: %v", err)
	}
	if back != legacy {
		t.Fatalf("legacy plaintext changed to %q", back)
	}
	if IsEncrypted(legacy) {
		t.Error("legacy plaintext is reported as encrypted")
	}
}

func TestAValueClaimingToBeEncryptedIsNotShruggedOff(t *testing.T) {
	// The tolerance above is bounded. Something that says it is encrypted and
	// cannot be decrypted is an error, not a value.
	c, _ := New("k")
	for _, bad := range []string{
		prefix + "not-base64!!",
		prefix + "c2hvcnQ=", // valid base64, too short for a nonce
	} {
		if _, err := c.Decrypt(bad); !errors.Is(err, ErrCiphertext) {
			t.Errorf("%q was accepted: %v", bad, err)
		}
	}
}

func TestAnEmptyFieldStaysEmpty(t *testing.T) {
	// Encrypting it would turn "no note" into a value, and make an absent
	// field indistinguishable from a present one in every existence check.
	c, _ := New("k")
	sealed, err := c.Encrypt("")
	if err != nil || sealed != "" {
		t.Fatalf("an empty value became %q (%v)", sealed, err)
	}
}

func TestNoKeyIsAnErrorRatherThanSilentPlaintext(t *testing.T) {
	// The failure that would matter: a misconfigured deployment storing
	// welfare cases in the clear while believing they are encrypted.
	if _, err := New(""); !errors.Is(err, ErrNoKey) {
		t.Fatalf("an empty key was accepted: %v", err)
	}
	if _, err := New("   "); !errors.Is(err, ErrNoKey) {
		t.Fatal("a whitespace key was accepted")
	}
	var nilCipher *Cipher
	if _, err := nilCipher.Encrypt("secret"); !errors.Is(err, ErrNoKey) {
		t.Fatal("a nil cipher encrypted something")
	}
}
