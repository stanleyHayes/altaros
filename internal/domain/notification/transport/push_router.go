package transport

import (
	"context"
	"fmt"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
)

// PushSender is the provider-specific subset used by the platform router.
type PushSender interface {
	Send(context.Context, string, notification.Message) (string, error)
}

// PushRouter selects FCM for Android and APNs for iOS using the platform that
// was persisted with the delivery. Native token shapes are not a stable API.
type PushRouter struct {
	android PushSender
	ios     PushSender
}

func NewPushRouter(android, ios PushSender) *PushRouter {
	return &PushRouter{android: android, ios: ios}
}

func (*PushRouter) Channel() notification.Channel { return notification.ChannelPush }

func (r *PushRouter) Send(ctx context.Context, address string, msg notification.Message) (string, error) {
	platform, token, err := notification.ParsePushAddress(address)
	if err != nil {
		return "", fmt.Errorf("push router: %w", err)
	}
	var sender PushSender
	if platform == "android" {
		sender = r.android
	} else {
		sender = r.ios
	}
	if sender == nil {
		return "", fmt.Errorf("push router: %s provider is not configured", platform)
	}
	return sender.Send(ctx, token, msg)
}

var _ notification.Transport = (*PushRouter)(nil)
