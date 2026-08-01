package token

import (
	"crypto/rand"
	"encoding/hex"
)

// newID returns a 128-bit random identifier, used for JTIs and token families.
//
// crypto/rand, not math/rand: a guessable JTI would let an attacker revoke
// someone else's session, and a guessable family id would let them revoke an
// entire login tree.
//
// crypto/rand.Read never returns an error on any platform Go supports, and
// panicking here is correct — continuing with a weak or empty identifier
// would silently undermine revocation.
func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("token: crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(b)
}
