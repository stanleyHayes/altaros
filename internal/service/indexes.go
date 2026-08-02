package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/domain/consent"
	"github.com/hayfordstanley/altar-os/internal/domain/customdomain"
	"github.com/hayfordstanley/altar-os/internal/domain/finance"
	"github.com/hayfordstanley/altar-os/internal/domain/invitation"
	"github.com/hayfordstanley/altar-os/internal/domain/member"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/domain/site"
	"github.com/hayfordstanley/altar-os/internal/domain/spiritual"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
)

// EnsureIndexes creates every index the platform depends on, at startup.
//
// This is not an optimisation step. Several of these indexes are correctness
// constraints that the application layer deliberately does not duplicate:
// finance's uq_idempotency and uq_provider_ref are what stop a retried payment
// webhook recording a tithe twice, and notification's uq_dedupe is what stops
// a replayed event sending a second receipt. Both are enforced by the database
// precisely so that concurrent requests cannot race past a check the
// application performs.
//
// Running it at boot rather than in a separate migration step is deliberate
// for this stage: index creation is idempotent, and the alternative — a
// migration someone must remember to run — is how a production database ends
// up without the constraint that makes payments safe.
func EnsureIndexes(ctx context.Context, d *deps.Deps) error {
	steps := []struct {
		name string
		run  func(context.Context) error
	}{
		{"auth", auth.NewService(d.Mongo, d.Tokens, d.Redis, smsSenderFor(d)).EnsureIndexes},
		{"church", church.NewService(d.Mongo).EnsureIndexes},
		{"consent", consent.NewService(d.Mongo, d.Events).EnsureIndexes},
		{"member", member.NewService(d.Mongo, d.Events, d.Config.DataRegion).EnsureIndexes},
		{"finance", finance.NewService(d.Mongo, nil, nil, nil).EnsureIndexes},
		{"notification", newNotificationService(d).EnsureIndexes},
		{"rbac", rbac.NewService(d.Mongo).EnsureIndexes},
		{"invitation", invitation.NewService(d.Mongo).EnsureIndexes},
		{"event", newEventService(d).EnsureIndexes},
		{"communication", newCommunicationService(d).EnsureIndexes},
		{"spiritual", spiritual.NewService(d.Mongo).EnsureIndexes},
		{"site", site.NewService(d.Mongo).EnsureIndexes},
		{"customdomain", customdomain.NewService(d.Mongo).EnsureIndexes},
	}

	for _, step := range steps {
		if err := step.run(ctx); err != nil {
			return fmt.Errorf("service: ensure %s indexes: %w", step.name, err)
		}
		d.Log.Debug("indexes ensured", slog.String("domain", step.name))
	}
	d.Log.Info("indexes ensured", slog.Int("domains", len(steps)))
	return nil
}
