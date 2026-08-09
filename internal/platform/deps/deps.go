// Package deps wires the shared infrastructure a service needs.
//
// Building these once at startup — and failing there if anything is
// unreachable — means a request never discovers halfway through that Redis is
// down. Combined with config's fail-fast on secrets (WP-05), a process that
// starts is a process that can actually serve.
package deps

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"strings"

	"github.com/hayfordstanley/altar-os/internal/domain/notification"
	"github.com/hayfordstanley/altar-os/internal/domain/notification/transport"
	"github.com/hayfordstanley/altar-os/internal/platform/audit"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/events"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

// Deps holds the infrastructure handed to every service.
type Deps struct {
	Config *config.Config
	Log    *slog.Logger
	Mongo  *mongodb.DB
	Redis  *redis.Client
	Tokens *token.Issuer
	Audit  *audit.Logger
	// Events is the Kafka bus. It satisfies the Publisher interface every
	// domain declares, so it drops into the arguments that used to be nil.
	Events *events.Bus
	// Outbox holds events Kafka refused, for the relay to deliver later.
	Outbox *events.Outbox
}

// Build connects everything, verifying each dependency before returning.
func Build(ctx context.Context, cfg *config.Config, log *slog.Logger) (*Deps, error) {
	db, err := mongodb.Connect(ctx, cfg.Mongo)
	if err != nil {
		return nil, err
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		// Redis backs token revocation. Starting without it would mean
		// silently serving tokens that cannot be revoked.
		_ = db.Close(ctx)
		return nil, fmt.Errorf("deps: redis at %s: %w", cfg.Redis.Addr, err)
	}

	issuer, err := token.NewIssuer(token.Options{
		Secret:     cfg.JWT.Secret,
		Issuer:     cfg.JWT.Issuer,
		AccessTTL:  cfg.JWT.AccessTTL,
		RefreshTTL: cfg.JWT.RefreshTTL,
		Redis:      rdb,
	})
	if err != nil {
		_ = db.Close(ctx)
		_ = rdb.Close()
		return nil, err
	}

	bus, err := events.NewBus(ctx, events.Config{
		Brokers:       cfg.Kafka.Brokers,
		ConsumerGroup: cfg.Kafka.ConsumerGroup,
		Source:        cfg.ServiceName,
		Log:           log,
	})
	if err != nil {
		// Kafka is how a completed gift becomes a receipt. Starting without it
		// would mean quietly dropping every domain event, so this is fatal in
		// the same way Redis is — and for the same reason: the failure would
		// otherwise be invisible until a member complains.
		_ = db.Close(ctx)
		_ = rdb.Close()
		return nil, fmt.Errorf("deps: kafka at %v: %w", cfg.Kafka.Brokers, err)
	}

	// The outbox is what makes a Kafka outage recoverable rather than silent:
	// a publish the broker refuses is queued in the same database the domain
	// state lives in, and the relay drains it when Kafka returns.
	outbox := events.NewOutbox(db.Database(), log)
	if err := outbox.EnsureIndexes(ctx); err != nil {
		_ = db.Close(ctx)
		_ = rdb.Close()
		bus.Close()
		return nil, err
	}
	bus.WithOutbox(outbox)

	log.Info("dependencies ready",
		slog.String("mongo", cfg.Mongo.Database),
		slog.String("redis", cfg.Redis.Addr),
		slog.Bool("kafka", bus.Enabled()),
	)

	return &Deps{
		Config: cfg,
		Log:    log,
		Mongo:  db,
		Redis:  rdb,
		Tokens: issuer,
		Audit:  audit.NewLogger(db),
		Events: bus,
		Outbox: outbox,
	}, nil
}

// Close releases every connection.
func (d *Deps) Close(ctx context.Context) {
	if d == nil {
		return
	}
	if d.Events != nil {
		// Before Redis and Mongo: the bus flushes pending produces and leaves
		// its consumer group cleanly, and both of those may need the other
		// connections still open.
		d.Events.Close()
	}
	if d.Redis != nil {
		_ = d.Redis.Close()
	}
	if d.Mongo != nil {
		_ = d.Mongo.Close(ctx)
	}
}

// MongoChecker reports MongoDB reachability for the readiness probe.
type MongoChecker struct{ DB *mongodb.DB }

// Name identifies the dependency.
func (c MongoChecker) Name() string { return "mongodb" }

// Check pings the database.
func (c MongoChecker) Check(ctx context.Context) error {
	if c.DB == nil {
		return fmt.Errorf("mongodb: not configured")
	}
	return c.DB.Ping(ctx)
}

// RedisChecker reports Redis reachability for the readiness probe.
type RedisChecker struct{ Client *redis.Client }

// Name identifies the dependency.
func (c RedisChecker) Name() string { return "redis" }

// Check pings Redis.
//
// Redis backs token revocation, and revocation checks fail closed — so an
// instance that cannot reach Redis rejects every authenticated request. It is
// genuinely not ready, not merely degraded.
func (c RedisChecker) Check(ctx context.Context) error {
	if c.Client == nil {
		return fmt.Errorf("redis: not configured")
	}
	return c.Client.Ping(ctx).Err()
}

// Checkers returns the readiness checks for these dependencies.
func (d *Deps) Checkers() []httpx.Checker {
	if d == nil {
		return nil
	}
	return []httpx.Checker{
		MongoChecker{DB: d.Mongo},
		RedisChecker{Client: d.Redis},
	}
}

// Transports returns the notification transports for this environment.
//
// Each refuses to send when unconfigured rather than pretending to succeed, so
// a deployment missing SMS credentials records suppressed messages with a
// reason instead of reporting delivery for messages nobody received. That
// distinction is the whole point: an SMS that was never sent is
// indistinguishable from one the member ignored.
//
// Exactly ONE SMS transport, chosen by SMS_PROVIDER. Returning both would put
// two transports on the same channel, and the notification service picks by
// channel — so which one sent would be decided by slice order.
func (d *Deps) Transports() []notification.Transport {
	if d == nil || d.Config == nil {
		return nil
	}
	return []notification.Transport{
		d.smsTransport(),
		transport.NewEmail(transport.EmailConfig{
			APIKey: d.Config.Resend.APIKey,
			From:   d.Config.Resend.FromEmail,
		}),
		d.pushTransport(),
	}
}

func (d *Deps) pushTransport() notification.Transport {
	var android notification.Transport
	source, err := transport.NewGoogleServiceAccountTokenSource(d.Config.Firebase.ServiceAccount, nil)
	if err == nil {
		android = transport.NewPush(transport.PushConfig{
			ProjectID:   source.ProjectID(),
			TokenSource: source,
		})
	} else {
		android = transport.NewPush(transport.PushConfig{})
	}
	ios := transport.NewAPNS(transport.APNSConfig{
		TeamID: d.Config.APNS.TeamID, KeyID: d.Config.APNS.KeyID,
		BundleID: d.Config.APNS.BundleID, PrivateKey: d.Config.APNS.PrivateKey,
		Sandbox: d.Config.APNS.Sandbox,
	})
	return transport.NewPushRouter(android, ios)
}

// smsTransport builds the SMS transport.
//
// Always returns a transport, never nil: an unconfigured one refuses each send
// with a named reason, which is what turns "no credentials" into a suppressed
// message somebody can see rather than a channel that silently does not exist.
func (d *Deps) smsTransport() notification.Transport {
	return transport.NewArkesel(transport.ArkeselConfig{
		APIKey:   d.Config.SMS.Arkesel.APIKey,
		SenderID: d.Config.SMS.Arkesel.SenderID,
	})
}

// Location is the timezone quiet hours are evaluated in.
//
// Derived from the data region rather than hard-coded to UTC: quiet hours in
// UTC put a Ghanaian congregation's 21:00 at the wrong part of the day for
// every market east or west of it, and "we texted them at 3am" is not a bug
// anyone reports — they simply stop reading the messages.
func (d *Deps) Location() *time.Location {
	if d == nil || d.Config == nil {
		return time.UTC
	}
	zones := map[string]string{
		"gh": "Africa/Accra",
		"ng": "Africa/Lagos",
		"ke": "Africa/Nairobi",
		"za": "Africa/Johannesburg",
	}
	name, ok := zones[strings.ToLower(d.Config.DataRegion)]
	if !ok {
		return time.UTC
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		// The distroless image has no tzdata unless the binary embeds it, so
		// this can genuinely fail. UTC is wrong but predictable, and the log
		// says so rather than leaving someone to work it out from complaints.
		d.Log.Warn("timezone unavailable; quiet hours will use UTC",
			slog.String("zone", name), slog.String("error", err.Error()))
		return time.UTC
	}
	return loc
}
