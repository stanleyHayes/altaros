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
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/logging"
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

	root := httpx.NewRouter(cfg, log)
	root.Mount("/api/v1", build(d))

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.HTTPPort),
		Handler:           root,
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
