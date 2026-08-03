package deps

import (
	"testing"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/domain/notification/transport"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
)

func TestTransportsWireOnePlatformAwarePushChannel(t *testing.T) {
	d := &Deps{Config: &config.Config{}}
	counts := map[notification.Channel]int{}
	var push notification.Transport
	for _, sender := range d.Transports() {
		counts[sender.Channel()]++
		if sender.Channel() == notification.ChannelPush {
			push = sender
		}
	}
	if counts[notification.ChannelPush] != 1 {
		t.Fatalf("push transports = %d, want one router", counts[notification.ChannelPush])
	}
	if _, ok := push.(*transport.PushRouter); !ok {
		t.Fatalf("push transport = %T, want *transport.PushRouter", push)
	}
}
