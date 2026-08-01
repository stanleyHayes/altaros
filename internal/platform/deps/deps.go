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

	"github.com/hayfordstanley/altar-os/internal/platform/audit"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
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

	log.Info("dependencies ready",
		slog.String("mongo", cfg.Mongo.Database),
		slog.String("redis", cfg.Redis.Addr),
	)

	return &Deps{
		Config: cfg,
		Log:    log,
		Mongo:  db,
		Redis:  rdb,
		Tokens: issuer,
		Audit:  audit.NewLogger(db),
	}, nil
}

// Close releases every connection.
func (d *Deps) Close(ctx context.Context) {
	if d == nil {
		return
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
