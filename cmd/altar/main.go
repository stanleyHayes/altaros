// Command altar runs one ALTAR OS service.
//
// All services ship in this single binary and are selected at runtime:
//
//	altar -service=gateway
//	altar -service=finance
//
// See ADR-004 in agent_plan.md for why the boundaries are real but the
// deployment starts consolidated.
package main

import (
	// Embeds the timezone database. The distroless base image has no
	// /usr/share/zoneinfo, so without this time.LoadLocation always fails and
	// quiet hours silently evaluate in UTC — putting a Ghanaian congregation's
	// 21:00 at the wrong part of the day in every deployed environment.
	_ "time/tzdata"

	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/events"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/logging"
	"github.com/hayfordstanley/altar-os/internal/platform/tracing"
	"github.com/hayfordstanley/altar-os/internal/service"
)

func main() {
	if err := run(); err != nil {
		// Config failures happen before the logger exists, so report them on
		// stderr and exit non-zero — the operator needs the name of the
		// missing secret, not a stack trace.
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		serviceName = flag.String("service", "", "service to run: "+strings.Join(service.Names(), ", "))
		logLevel    = flag.String("log-level", "info", "debug, info, warn or error")
	)
	flag.Parse()

	if *serviceName == "" {
		return fmt.Errorf("-service is required (one of: %s)", strings.Join(service.Names(), ", "))
	}

	build, err := service.Lookup(*serviceName)
	if err != nil {
		return err
	}

	cfg, err := config.Load(*serviceName)
	if err != nil {
		return err
	}

	log := logging.New(cfg.ServiceName, string(cfg.Env), *logLevel)

	// Tracing is optional and fails soft. A service that will not start
	// because its telemetry collector is unreachable is worse than one with no
	// telemetry, because the failure arrives during exactly the incident the
	// traces were for.
	traceCtx, cancelTrace := context.WithTimeout(context.Background(), 10*time.Second)
	tracer, err := tracing.Init(traceCtx, tracing.Config{
		Endpoint:    cfg.Tracing.Endpoint,
		ServiceName: cfg.ServiceName,
		Environment: string(cfg.Env),
		SampleRatio: cfg.Tracing.SampleRatio,
		Insecure:    cfg.Tracing.Insecure,
	})
	cancelTrace()
	if err != nil {
		log.Warn("tracing disabled; the service will run without it",
			slog.String("error", err.Error()))
		tracer = nil
	} else if tracer.Enabled() {
		log.Info("tracing enabled",
			slog.String("collector", cfg.Tracing.Endpoint),
			slog.Float64("sample_ratio", cfg.Tracing.SampleRatio))
	}
	defer func() {
		// Bounded: an unreachable collector must not delay the shutdown of a
		// service that has already stopped serving.
		flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := tracer.Shutdown(flushCtx); err != nil {
			log.Warn("could not flush traces on shutdown",
				slog.String("error", err.Error()))
		}
	}()

	// Connect everything up front: a process that starts is a process that can
	// serve. Discovering mid-request that Redis is unreachable would mean
	// issuing tokens that cannot be revoked.
	startCtx, cancelStart := context.WithTimeout(context.Background(), 30*time.Second)
	d, err := deps.Build(startCtx, cfg, log)
	cancelStart()
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		d.Close(closeCtx)
	}()

	// Indexes before routes. Several are correctness constraints rather than
	// optimisations — the payment idempotency keys and the notification dedupe
	// key are enforced by the database because concurrent requests can race
	// past any check the application performs. Serving traffic before they
	// exist means the window where a retried webhook can record a tithe twice
	// is exactly the window when the service is newest.
	indexCtx, cancelIndexes := context.WithTimeout(context.Background(), 60*time.Second)
	err = service.EnsureIndexes(indexCtx, d)
	cancelIndexes()
	if err != nil {
		return err
	}

	// Provision the topics the platform publishes. Auto-creation is disabled on
	// the broker (correctly — it turns a typo into a silently created topic
	// nobody consumes), so they have to be created explicitly, and doing it at
	// boot follows the same reasoning as the indexes above.
	topicCtx, cancelTopics := context.WithTimeout(context.Background(), 30*time.Second)
	if err := d.Events.EnsureTopics(topicCtx, events.KnownTopics, 3, 1); err != nil {
		cancelTopics()
		return err
	}
	cancelTopics()

	// Start consuming. This is what turns a completed gift into a receipt; it
	// was missing entirely, so both halves of that flow were correct and
	// unconnected.
	consumerCtx, stopConsumers := context.WithCancel(context.Background())
	defer stopConsumers()
	if err := service.StartConsumers(consumerCtx, d); err != nil {
		return err
	}

	root := httpx.NewRouter(cfg, log)
	// Readiness reports whether this instance can actually serve, which is
	// what the load balancer routes on. Liveness (/health) stays
	// dependency-free so a Redis blip removes pods from rotation instead of
	// restarting all of them at once.
	httpx.MountReadiness(root, cfg, d.Checkers()...)
	root.Mount("/api/v1", build(d))

	// Anything else on a church subdomain is that church's public site. WP-40
	// replaces this with the real renderer; today it proves the chain from DNS
	// to Host header to church in a browser.
	root.NotFound(service.PublicSiteFallback(d))

	// Host-based tenancy (WP-39) wraps the FINISHED router rather than being a
	// chi middleware, for two reasons. chi refuses middleware registered after
	// routes, and httpx.NewRouter has already mounted its own — but more
	// usefully, wrapping covers the NotFound handler too, and NotFound is
	// exactly where a church's public site lives.
	//
	// A no-op unless PUBLIC_BASE_DOMAIN is set. Probes arrive with a pod IP for
	// a Host, which resolves to no subdomain and passes straight through.
	var handler http.Handler = root
	if cfg.PublicBaseDomain != "" {
		handler = service.TenantFromHost(d)(root)
		log.Info("serving church subdomains", slog.String("base_domain", cfg.PublicBaseDomain))
	}

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.HTTPPort),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Shut down on SIGINT/SIGTERM so in-flight requests finish; Kubernetes
	// sends SIGTERM before removing the pod from the load balancer.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Info("service listening",
			slog.String("addr", srv.Addr),
			slog.String("region", cfg.DataRegion),
		)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Info("shutdown signal received, draining")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown failed: %w", err)
	}
	log.Info("shutdown complete")
	return nil
}
