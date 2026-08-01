package service

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
	"github.com/hayfordstanley/altar-os/internal/platform/token"
)

// WP-08's acceptance criterion, exercised through the real stack rather than
// three hand-made spans: a single HTTP request must produce one trace that
// reaches the database.
//
// The unit test proves nesting works when someone wires it correctly. This
// proves the wiring: that the HTTP middleware starts a span, that the span
// survives into the handler's context, and that the database wrapper picks it
// up from there. Any one of those being missed produces a trace that looks
// fine and contains nothing useful.
func TestOneRequestProducesOneTraceReachingTheDatabase(t *testing.T) {
	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	connectCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            uri,
		Database:       "altar_test_tracing",
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	recorder := tracetest.NewSpanRecorder()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(recorder),
		// Sample everything: a ratio sampler would make this test flaky.
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	))
	t.Cleanup(func() { otel.SetTracerProvider(sdktrace.NewTracerProvider()) })

	d := newTestDeps(t)
	d.Mongo = db
	d.Config.ServiceName = "gateway"

	// The real router with the real middleware stack, and a handler that does
	// a real tenant-scoped query.
	root := httpx.NewRouter(d.Config, slog.New(slog.NewTextHandler(io.Discard, nil)))
	api := standalone(func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Get("/members", func(w http.ResponseWriter, req *http.Request) {
				var out []bson.M
				if err := db.Tenant("members").Find(req.Context(), nil, &out); err != nil {
					httpx.Error(w, http.StatusInternalServerError, "query failed")
					return
				}
				httpx.JSON(w, http.StatusOK, out)
			})
		})
	})
	root.Mount("/api/v1", api)

	access := tokenFor(t, d, token.Identity{
		UserID: "user_1", ChurchID: "church_trace", Role: RoleChurchAdmin,
	})
	rec := call(root, http.MethodGet, "/api/v1/members", access)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}

	spans := recorder.Ended()
	if len(spans) < 2 {
		t.Fatalf("want at least an HTTP span and a database span, got %d: %v",
			len(spans), spanNames(spans))
	}

	// One trace, not several.
	traceID := spans[0].SpanContext().TraceID()
	for _, s := range spans {
		if s.SpanContext().TraceID() != traceID {
			t.Fatalf("span %q is on a different trace; the request and the query are not linked",
				s.Name())
		}
	}

	// The database hop must be present, or the trace stops at the handler and
	// cannot answer the question it exists for.
	var sawDB, sawChurch bool
	for _, s := range spans {
		if s.Name() == "mongodb.members.find" {
			sawDB = true
		}
		for _, a := range s.Attributes() {
			if string(a.Key) == "altar.church_id" && a.Value.AsString() == "church_trace" {
				sawChurch = true
			}
		}
	}
	if !sawDB {
		t.Errorf("no database span in the trace: %v", spanNames(spans))
	}
	if !sawChurch {
		t.Error("no span carried the church id; a trace cannot then tell one church's " +
			"slowness from everyone's")
	}
}

func spanNames(spans []sdktrace.ReadOnlySpan) []string {
	names := make([]string, 0, len(spans))
	for _, s := range spans {
		names = append(names, s.Name())
	}
	return names
}
