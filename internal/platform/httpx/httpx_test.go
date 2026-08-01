package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hayfordstanley/altar-os/internal/platform/config"
)

type stubChecker struct {
	name string
	err  error
	// blocked makes Check honour context cancellation, for the timeout case.
	blocked bool
	calls   int
}

func (s *stubChecker) Name() string { return s.name }

func (s *stubChecker) Check(ctx context.Context) error {
	s.calls++
	if s.blocked {
		<-ctx.Done()
		return ctx.Err()
	}
	return s.err
}

func testConfig() *config.Config {
	return &config.Config{
		ServiceName: "gateway",
		Env:         config.Development,
		CORSOrigins: []string{"http://localhost:5173"},
	}
}

func newTestRouter(checkers ...Checker) http.Handler {
	cfg := testConfig()
	r := NewRouter(cfg, slog.New(slog.NewTextHandler(discard{}, nil)))
	MountReadiness(r, cfg, checkers...)
	return r
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

func probe(t *testing.T, handler http.Handler, path string) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

	var env struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode %s response %q: %v", path, rec.Body.String(), err)
	}
	return rec.Code, env.Data
}

// The split between the two probes is what makes rolling deploys safe, so it
// has to actually be a split: liveness must not consult dependencies.
func TestLivenessIgnoresDependencies(t *testing.T) {
	broken := &stubChecker{name: "mongodb", err: errors.New("connection refused")}
	handler := newTestRouter(broken)

	code, _ := probe(t, handler, "/health")
	if code != http.StatusOK {
		t.Fatalf("liveness = %d with a broken dependency, want 200", code)
	}
	if broken.calls != 0 {
		t.Errorf("liveness consulted the dependency %d times; it must not, or a "+
			"dependency blip restarts every pod at once", broken.calls)
	}
}

func TestReadinessReportsEachDependency(t *testing.T) {
	handler := newTestRouter(
		&stubChecker{name: "mongodb"},
		&stubChecker{name: "redis"},
	)

	code, data := probe(t, handler, "/ready")
	if code != http.StatusOK {
		t.Fatalf("readiness = %d with everything healthy, want 200", code)
	}
	if data["ready"] != true {
		t.Errorf("ready = %v, want true", data["ready"])
	}

	deps, _ := data["dependencies"].(map[string]any)
	if deps["mongodb"] != "ok" || deps["redis"] != "ok" {
		t.Errorf("dependencies = %v, want both ok", deps)
	}
}

// 503 is what removes a pod from the Service's endpoints. Returning 200 with
// a "not ready" body in it would keep sending traffic to an instance that
// cannot serve.
func TestUnreadyReturns503AndNamesTheCause(t *testing.T) {
	handler := newTestRouter(
		&stubChecker{name: "mongodb"},
		&stubChecker{name: "redis", err: errors.New("connection refused")},
	)

	code, data := probe(t, handler, "/ready")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("readiness = %d with a failed dependency, want 503", code)
	}
	if data["ready"] != false {
		t.Errorf("ready = %v, want false", data["ready"])
	}

	deps, _ := data["dependencies"].(map[string]any)
	if deps["mongodb"] != "ok" {
		t.Errorf("the healthy dependency should still report ok, got %v", deps["mongodb"])
	}
	// Naming which dependency failed is the difference between a five-minute
	// diagnosis and an hour of guessing.
	if reason, _ := deps["redis"].(string); reason == "" || reason == "ok" {
		t.Errorf("redis = %v; the failure and its reason must be reported", deps["redis"])
	}
}

// One healthy dependency must not mask an unhealthy one.
func TestAnyFailedDependencyMakesTheInstanceUnready(t *testing.T) {
	handler := newTestRouter(
		&stubChecker{name: "mongodb", err: errors.New("down")},
		&stubChecker{name: "redis"},
	)
	if code, _ := probe(t, handler, "/ready"); code != http.StatusServiceUnavailable {
		t.Fatalf("readiness = %d, want 503", code)
	}
}

// A hanging dependency must produce a "not ready" answer rather than a probe
// timeout: the former says which dependency, the latter says nothing.
func TestHangingDependencyTimesOutAsNotReady(t *testing.T) {
	handler := newTestRouter(&stubChecker{name: "mongodb", blocked: true})

	done := make(chan struct{})
	var code int
	var data map[string]any
	go func() {
		defer close(done)
		code, data = probe(t, handler, "/ready")
	}()

	select {
	case <-done:
	case <-context.Background().Done():
	}

	if code != http.StatusServiceUnavailable {
		t.Fatalf("readiness = %d for a hanging dependency, want 503", code)
	}
	deps, _ := data["dependencies"].(map[string]any)
	if reason, _ := deps["mongodb"].(string); reason == "ok" {
		t.Error("a hanging dependency must not report ok")
	}
}

// A service with nothing to check is ready. This is the standalone case: a
// service run with -service=<name> that needs no dependency should not be
// held out of rotation by an empty checker list.
func TestNoCheckersMeansReady(t *testing.T) {
	code, data := probe(t, newTestRouter(), "/ready")
	if code != http.StatusOK {
		t.Fatalf("readiness = %d with no checkers, want 200", code)
	}
	if data["ready"] != true {
		t.Errorf("ready = %v, want true", data["ready"])
	}
}

// A nil checker in the list must not panic the probe — a panicking readiness
// endpoint takes every pod out of rotation at once.
func TestNilCheckerIsSkipped(t *testing.T) {
	handler := newTestRouter(nil, &stubChecker{name: "redis"})
	if code, _ := probe(t, handler, "/ready"); code != http.StatusOK {
		t.Fatalf("readiness = %d, want 200", code)
	}
}

func TestEnvelopeShape(t *testing.T) {
	rec := httptest.NewRecorder()
	JSON(rec, http.StatusOK, map[string]any{"x": 1})

	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("content type = %q", got)
	}

	var env Envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !env.Success {
		t.Error("JSON should write a success envelope")
	}

	rec = httptest.NewRecorder()
	Error(rec, http.StatusBadRequest, "Nope")
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Success || env.Message != "Nope" {
		t.Errorf("Error should write a failure envelope, got %+v", env)
	}
}
