// Package httpx provides the shared HTTP layer: router construction, common
// middleware, and a consistent JSON envelope.
package httpx

import (
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
	// health belongs on a separate readiness endpoint so a blip in Redis
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

			// /health is polled continuously by probes; logging every hit
			// buries real traffic.
			if r.URL.Path == "/health" {
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
