// Package fieldcrypt encrypts individual fields before they reach the database.
//
// It exists for one class of data: welfare cases (§3.4(3)), which record that a
// named person could not pay rent, is being abused, or is ill. Tenant isolation
// and an ACL protect that from other USERS of the platform. Neither protects it
// from anybody who obtains the database — a stolen backup, a misconfigured
// replica, a support engineer with a shell.
//
// # A separate key, and why that is the whole point
//
// The key is NOT the JWT secret and not the database password. It is set on its
// own, so the blast radius of losing any one secret stops short of the most
// sensitive data in the product. A key that lives beside the thing it protects
// is a key that leaks with it.
//
// # What this does not claim
//
// It is not searchable encryption. An encrypted field cannot be queried,
// filtered or sorted, and that is a real cost: welfare cases are found by
// member and by status, never by their narrative. Anything that must be
// queryable stays in plaintext, which means the METADATA of a case — that a
// case exists for this person — is visible to anyone who can read the
// collection. Only the contents are protected. Pretending otherwise would be
// worse than not encrypting at all.
package fieldcrypt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

var (
	// ErrNoKey means encryption was asked for with no key configured.
	ErrNoKey = errors.New("fieldcrypt: no encryption key is configured")
	// ErrCiphertext means a stored value could not be decrypted.
	ErrCiphertext = errors.New("fieldcrypt: this value could not be decrypted")
)

// prefix marks a value this package produced.
//
// Present so a plaintext value written before encryption existed — or by the
// legacy TypeScript API — reads back as itself instead of failing. A migration
// that makes every existing case unreadable is a worse outcome than a mixed
// collection that is being encrypted forward.
const prefix = "enc:v1:"

// Cipher encrypts and decrypts field values.
type Cipher struct {
	aead cipher.AEAD
}

// New builds a cipher from a key.
//
// The key is any length: it is hashed to 32 bytes, so an operator can set a
// passphrase rather than being asked to produce exact key material by hand.
// That is a deliberate trade — a passphrase has less entropy than a random key
// — and it is the right one here, because the alternative in practice is an
// operator who cannot generate a 32-byte key leaving encryption switched off.
func New(key string) (*Cipher, error) {
	if strings.TrimSpace(key) == "" {
		return nil, ErrNoKey
	}
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, fmt.Errorf("fieldcrypt: build cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("fieldcrypt: build aead: %w", err)
	}
	return &Cipher{aead: aead}, nil
}

// Encrypt returns a storable representation of a value.
//
// GCM, so the ciphertext is AUTHENTICATED: a value edited in the database
// fails to decrypt rather than decrypting to something else. For a welfare
// record that distinction matters — a silently altered case note is worse than
// an unreadable one.
//
// A random nonce per value, prepended. Reusing a nonce under one key in GCM is
// catastrophic rather than merely weak, which is why it is generated here and
// never derived from anything about the record.
func (c *Cipher) Encrypt(plaintext string) (string, error) {
	if c == nil {
		return "", ErrNoKey
	}
	if plaintext == "" {
		// An empty field stays empty. Encrypting it would turn "no note" into
		// a value, and make an absent field indistinguishable from a present
		// one in every query that checks for existence.
		return "", nil
	}

	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("fieldcrypt: nonce: %w", err)
	}
	sealed := c.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return prefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt reverses Encrypt.
//
// A value without the marker is returned unchanged, so plaintext written
// before encryption existed still reads. That tolerance is bounded: it applies
// only to values that were never encrypted, and a value that CLAIMS to be
// encrypted and cannot be decrypted is an error rather than a shrug.
func (c *Cipher) Decrypt(stored string) (string, error) {
	if !strings.HasPrefix(stored, prefix) {
		return stored, nil
	}
	if c == nil {
		return "", ErrNoKey
	}

	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, prefix))
	if err != nil {
		return "", fmt.Errorf("%w: not valid base64", ErrCiphertext)
	}
	if len(raw) < c.aead.NonceSize() {
		return "", fmt.Errorf("%w: too short to contain a nonce", ErrCiphertext)
	}

	nonce, body := raw[:c.aead.NonceSize()], raw[c.aead.NonceSize():]
	plain, err := c.aead.Open(nil, nonce, body, nil)
	if err != nil {
		// Either the key is wrong or the value was tampered with, and this
		// cannot tell them apart. Saying which would be a guess.
		return "", fmt.Errorf("%w: wrong key, or the value has been altered", ErrCiphertext)
	}
	return string(plain), nil
}

// IsEncrypted reports whether a stored value carries the marker.
//
// For a test or a migration to tell "already encrypted" from "written before
// this existed" without attempting a decryption.
func IsEncrypted(stored string) bool { return strings.HasPrefix(stored, prefix) }
