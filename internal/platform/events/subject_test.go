package events

import "testing"

// The subject is the church, and every publisher has to make it so. A payload
// without churchId falls back to the caller's key — which for consent and
// member.status_changed was the MEMBER id, putting a member id in the field
// every consumer reads as a church.
func TestSubjectIsTheChurchNotTheEntity(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		payload map[string]any
		want    string
	}{
		{
			"a payload with churchId wins over an entity key",
			"member_123",
			map[string]any{"memberId": "member_123", "churchId": "church_a"},
			"church_a",
		},
		{
			"giving carries its church",
			"tx_1",
			map[string]any{"transactionId": "tx_1", "churchId": "church_a"},
			"church_a",
		},
		{
			"consent carries its church",
			"church_a",
			map[string]any{"memberId": "m1", "churchId": "church_a", "purpose": "communications"},
			"church_a",
		},
	}
	for _, c := range cases {
		e, err := NewEnvelope("test", TopicGivingCompleted, keyOrSubject(c.key, c.payload), c.payload)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if e.Subject != c.want {
			t.Errorf("%s: subject = %q, want %q", c.name, e.Subject, c.want)
		}
	}
}
