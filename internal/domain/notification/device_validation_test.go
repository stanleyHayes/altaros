package notification

import (
	"context"
	"errors"
	"testing"
)

func TestRegisterDeviceRejectsInvalidInputBeforePersistence(t *testing.T) {
	svc := &Service{}
	for _, test := range []struct{ member, family, token, platform string }{
		{"", "family", "a-valid-looking-device-token-123456789", "ios"},
		{"member", "", "a-valid-looking-device-token-123456789", "ios"},
		{"member", "family", "short", "ios"},
		{"member", "family", "a-valid-looking-device-token-123456789", "web"},
		{"member", "family", "a-valid-looking-device-token-1234\n56789", "android"},
	} {
		if err := svc.RegisterDevice(context.Background(), test.member, test.family, test.token, test.platform); !errors.Is(err, ErrInvalidDevice) {
			t.Fatalf("RegisterDevice(%q, %q) error = %v", test.member, test.platform, err)
		}
	}
}
