package service

import (
	"context"
	"fmt"
	"html"
	"log/slog"
	"strings"

	"github.com/hayfordstanley/altar-os/internal/domain/invitation"
	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
)

// invitationCourier delivers an invitation link.
//
// It talks to the transports directly rather than going through the
// notification service, and that is deliberate rather than a shortcut. The
// notification service resolves a MEMBER and checks their communications
// consent — an invitee has neither: there is no member record yet, and the
// consent this platform records is consent to be sent announcements, which a
// person cannot have given before they have an account. Routing an invitation
// through that gate would suppress every one of them for want of a consent the
// invitee had no way to give.
//
// Kind is transactional throughout for the same reason quiet hours do not apply
// to a login code: someone was told to expect this, and holding it until 08:00
// helps nobody.
type invitationCourier struct {
	transports map[notification.Channel]notification.Transport
	log        *slog.Logger
	// logOnly prints the link instead of sending it. Development only, and
	// gated on the environment rather than on "no credentials configured" —
	// the same call smsSenderFor makes, for the same reason: a staging or
	// production deployment missing its email key has to FAIL, not quietly log
	// invitations to a console nobody is reading.
	logOnly bool
}

func newInvitationCourier(d *deps.Deps) *invitationCourier {
	c := &invitationCourier{
		transports: map[notification.Channel]notification.Transport{},
		log:        d.Log,
		logOnly:    d.Config != nil && !d.Config.Env.RequiresRealSecrets(),
	}
	for _, t := range d.Transports() {
		c.transports[t.Channel()] = t
	}
	return c
}

// deliver sends the link by whichever channel the invitation was addressed to.
//
// Email is preferred when both are present: the link is long, an SMS carrying
// it costs two or three segments, and a tapped link in an email client is more
// reliable than one wrapped across lines in an SMS.
func (c *invitationCourier) deliver(ctx context.Context, inv *invitation.Invitation, link string) (string, error) {
	if c.logOnly {
		// WARNING rather than INFO, so it is obvious in the output that this is
		// a live invitation link sitting in a log file and not a real send.
		c.log.Warn("INVITATION NOT SENT — development transport",
			slog.String("to", inv.Contact()),
			slog.String("link", link))
		return "log", nil
	}

	if inv.Email != "" {
		if t, ok := c.transports[notification.ChannelEmail]; ok {
			if _, err := t.Send(ctx, inv.Email, emailInvitation(inv, link)); err != nil {
				return "", fmt.Errorf("invitation: send email: %w", err)
			}
			return string(notification.ChannelEmail), nil
		}
	}

	if inv.Phone != "" {
		if t, ok := c.transports[notification.ChannelSMS]; ok {
			if _, err := t.Send(ctx, inv.Phone, smsInvitation(inv, link)); err != nil {
				return "", fmt.Errorf("invitation: send sms: %w", err)
			}
			return string(notification.ChannelSMS), nil
		}
	}

	return "", fmt.Errorf("invitation: no transport configured for %s", inv.Contact())
}

// emailInvitation composes the message.
//
// Named senders and a stated reason, because the failure mode of a bare "you
// have been invited, click here" from an unfamiliar system is not that it is
// ignored — it is that it trains a congregation to click unexplained links.
func emailInvitation(inv *invitation.Invitation, link string) notification.Message {
	greeting := "Hello"
	if inv.Name != "" {
		greeting = "Hello " + inv.Name
	}

	var note string
	if inv.Message != "" {
		note = fmt.Sprintf("<p style=\"margin:0 0 16px\"><em>%s</em></p>", html.EscapeString(inv.Message))
	}

	role := inv.RoleName
	if role == "" {
		role = "member"
	}

	body := fmt.Sprintf(`<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a">
<p style="margin:0 0 16px">%s,</p>
<p style="margin:0 0 16px">You have been invited to join your church on ALTAR OS as <strong>%s</strong>.</p>
%s
<p style="margin:0 0 24px"><a href="%s" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:10px">Accept the invitation</a></p>
<p style="margin:0 0 8px;font-size:14px;color:#666">This link works once and expires in 7 days.</p>
<p style="margin:0;font-size:14px;color:#666">If you were not expecting this, you can ignore this email — nothing will be created.</p>
</div>`,
		html.EscapeString(greeting), html.EscapeString(role), note, html.EscapeString(link))

	return notification.Message{
		Channel: notification.ChannelEmail,
		Kind:    notification.KindTransactional,
		Subject: "You have been invited to ALTAR OS",
		Body:    body,
	}
}

// smsInvitation is the same message in the space an SMS has.
func smsInvitation(inv *invitation.Invitation, link string) notification.Message {
	name := strings.TrimSpace(inv.Name)
	if name != "" {
		name = " " + name
	}
	return notification.Message{
		Channel: notification.ChannelSMS,
		Kind:    notification.KindTransactional,
		Body: fmt.Sprintf(
			"Hello%s, you have been invited to join your church on ALTAR OS. Set up your account here: %s (expires in 7 days).",
			name, link),
	}
}
