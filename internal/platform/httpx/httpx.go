// Package httpx provides the shared HTTP layer: router construction, common
// middleware, and a consistent JSON envelope.
package httpx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/logging"
)

// Envelope is the response shape every service returns, matching the
// ApiResponse contract the existing frontends already consume.
type Envelope struct {
	Success bool   `json:"success"`
	Data    any    `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

// JSON writes a success envelope.
func JSON(w http.ResponseWriter, status int, data any) {
	write(w, status, Envelope{Success: true, Data: data})
}

// Error writes a failure envelope. The message is user-facing, so callers must
// not put internal detail in it.
func Error(w http.ResponseWriter, status int, message string) {
	write(w, status, Envelope{Success: false, Message: message})
}

func write(w http.ResponseWriter, status int, body Envelope) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// NewRouter builds a router with the standard middleware stack applied.
func NewRouter(cfg *config.Config, log *slog.Logger) *chi.Mux {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(requestLogger(log))
	r.Use(middleware.Timeout(30 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Liveness. Deliberately dependency-free: this answers "is the process
	// up", which is what a K8s liveness probe should restart on. Dependency
	// health belongs on the readiness endpoint below, so a blip in Redis
	// doesn't cause a restart loop.
	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
		JSON(w, http.StatusOK, map[string]any{
			"status":    "ok",
			"service":   cfg.ServiceName,
			"env":       string(cfg.Env),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	})

	return r
}

// Checker reports whether a dependency is currently usable.
type Checker interface {
	// Name identifies the dependency in the readiness response.
	Name() string
	// Check returns nil when the dependency is reachable.
	Check(ctx context.Context) error
}

// MountReadiness adds /ready, which reports whether this instance can serve.
//
// The split from /health is what makes rolling deploys safe. Liveness failing
// means "restart me"; readiness failing means "stop sending me traffic, I am
// still alive". Answering the same thing to both turns a thirty-second Redis
// blip into a cluster-wide restart storm, because every pod fails its liveness
// probe at once and Kubernetes kills them all.
//
// Readiness is checked live rather than cached: a cached answer tells the load
// balancer what was true a minute ago, which is exactly when it matters least.
func MountReadiness(r chi.Router, cfg *config.Config, checkers ...Checker) {
	r.Get("/ready", func(w http.ResponseWriter, req *http.Request) {
		// Bounded well under the probe's own timeout, so a hanging dependency
		// produces a "not ready" answer rather than a probe timeout — the
		// former says which dependency, the latter says nothing.
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()

		results := make(map[string]string, len(checkers))
		ready := true
		for _, c := range checkers {
			if c == nil {
				continue
			}
			if err := c.Check(ctx); err != nil {
				results[c.Name()] = "unavailable: " + err.Error()
				ready = false
				continue
			}
			results[c.Name()] = "ok"
		}

		status := http.StatusOK
		if !ready {
			status = http.StatusServiceUnavailable
		}
		write(w, status, Envelope{
			Success: ready,
			Data: map[string]any{
				"ready":        ready,
				"service":      cfg.ServiceName,
				"dependencies": results,
			},
		})
	})
}

// requestLogger attaches a request-scoped logger and records the outcome.
func requestLogger(base *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			reqID := middleware.GetReqID(r.Context())

			l := base.With(slog.String("request_id", reqID))
			ctx := logging.WithLogger(r.Context(), l)

			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r.WithContext(ctx))

			// Probes hit /health and /ready continuously; logging every one
			// buries real traffic. A failing readiness check still surfaces —
			// it is the dependency's own error path that logs, not this.
			if r.URL.Path == "/health" || r.URL.Path == "/ready" {
				return
			}

			l.Info("http request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", ww.Status()),
				slog.Int("bytes", ww.BytesWritten()),
				slog.Duration("duration", time.Since(start)),
			)
		})
	}
}
