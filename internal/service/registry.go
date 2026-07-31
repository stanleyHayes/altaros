// Package service maps a service name to the routes it serves.
//
// Per ADR-004 the eight services from the spec are separate modules with their
// own boundaries, but they compile into a single binary selected with
// -service. Splitting one out later is a deploy-config change (run the same
// image with a different flag), never a refactor.
package service

import (
	"fmt"
	"log/slog"
	"net/http"
	"sort"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
)

// Builder returns the routes a service mounts under /api/v1.
type Builder func(cfg *config.Config, log *slog.Logger) http.Handler

// registry is the full set of runnable services.
//
// Populated in init() rather than as a composite literal: buildGateway calls
// Names(), which reads registry, and Go rejects that as an initialization
// cycle when the map is initialized statically.
var registry map[string]Builder

func init() {
	registry = map[string]Builder{
		"gateway":       buildGateway,
		"auth":          placeholder("auth", "login, OTP, JWT issue/refresh, RBAC"),
		"church":        placeholder("church", "organizations, branches, departments, groups"),
		"member":        placeholder("member", "member CRM, households, status pipeline"),
		"finance":       placeholder("finance", "giving, campaigns, pledges, ledger"),
		"event":         placeholder("event", "events, RSVP, QR check-in, attendance"),
		"communication": placeholder("communication", "broadcast + targeted messaging"),
		"ai":            placeholder("ai", "sermon assistant, member insights, prayer chat"),
		"notification":  placeholder("notification", "push, SMS, email, WhatsApp fan-out"),
	}
}

// Names lists every runnable service, sorted for stable help output.
func Names() []string {
	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Lookup resolves a service by name.
func Lookup(name string) (Builder, error) {
	b, ok := registry[name]
	if !ok {
		return nil, fmt.Errorf("unknown service %q (available: %v)", name, Names())
	}
	return b, nil
}

// buildGateway fronts the platform: it terminates client requests, and will
// authenticate, rate-limit and resolve tenancy before forwarding over gRPC.
func buildGateway(cfg *config.Config, log *slog.Logger) http.Handler {
	r := chi.NewRouter()
	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{
			"service":  "gateway",
			"services": Names(),
			"region":   cfg.DataRegion,
		})
	})
	return r
}

// placeholder is a service that boots and reports itself but serves no domain
// routes yet. It exists so the topology is real and runnable from day one;
// each is replaced as its work package lands.
func placeholder(name, responsibility string) Builder {
	return func(cfg *config.Config, log *slog.Logger) http.Handler {
		r := chi.NewRouter()
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
			httpx.JSON(w, http.StatusOK, map[string]any{
				"service":        name,
				"responsibility": responsibility,
				"status":         "not implemented",
			})
		})
		return r
	}
}
