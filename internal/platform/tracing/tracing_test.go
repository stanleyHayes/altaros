package tracing

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// A missing collector must not be an error. Observability that stops the
// platform when its collector is unreachable is worse than none, because the
// failure arrives during exactly the incident you needed it for.
func TestNoEndpointDisablesTracingWithoutFailing(t *testing.T) {
	provider, err := Init(context.Background(), Config{ServiceName: "gateway"})
	if err != nil {
		t.Fatalf("an absent collector must not be an error: %v", err)
	}
	if provider.Enabled() {
		t.Error("tracing should be disabled with no endpoint")
	}

	// Spans must still be startable, so instrumentation needs no `if enabled`
	// branches — those inevitably drift from the code they guard.
	ctx, span := Start(context.Background(), "some.operation")
	span.SetAttributes(attribute.String("x", "y"))
	span.End()
	if ctx == nil {
		t.Error("a no-op tracer must still return a usable context")
	}

	if err := provider.Shutdown(context.Background()); err != nil {
		t.Errorf("Shutdown on a disabled provider: %v", err)
	}
}

// Shutdown on a nil provider is what the deferred call in main does when Init
// failed, so it must not panic.
func TestShutdownOnNilProviderIsSafe(t *testing.T) {
	var p *Provider
	if err := p.Shutdown(context.Background()); err != nil {
		t.Fatalf("nil Shutdown: %v", err)
	}
	if p.Enabled() {
		t.Error("a nil provider is not enabled")
	}
}

// The acceptance criterion for WP-08: one trace spans the request, the
// service, and the database. A recorder stands in for the collector.
func TestOneTraceSpansRequestServiceAndDatabase(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	otel.SetTracerProvider(tp)
	t.Cleanup(func() { otel.SetTracerProvider(sdktrace.NewTracerProvider()) })

	// The three hops, nested as they are in a real request.
	ctx, requestSpan := Start(context.Background(), "GET /api/v1/members")
	requestSpan.SetAttributes(TenantAttributes("church_a", "CHURCH_ADMIN")...)

	ctx, serviceSpan := Start(ctx, "member.List")

	_, dbSpan := Start(ctx, "mongodb.members.find")
	dbSpan.SetAttributes(attribute.String(AttrCollection, "members"))
	dbSpan.End()
	serviceSpan.End()
	requestSpan.End()

	spans := recorder.Ended()
	if len(spans) != 3 {
		t.Fatalf("want 3 spans, got %d", len(spans))
	}

	// All three must share one trace id, or they are three unrelated traces
	// and the whole exercise achieves nothing.
	traceID := spans[0].SpanContext().TraceID()
	for _, s := range spans {
		if s.SpanContext().TraceID() != traceID {
			t.Fatalf("span %q is on a different trace; the hops are not linked", s.Name())
		}
	}

	// And they must be nested, not siblings: the database span's parent is the
	// service span, whose parent is the request.
	byName := map[string]sdktrace.ReadOnlySpan{}
	for _, s := range spans {
		byName[s.Name()] = s
	}
	db := byName["mongodb.members.find"]
	service := byName["member.List"]
	request := byName["GET /api/v1/members"]
	if db == nil || service == nil || request == nil {
		t.Fatalf("missing a span: %v", spans)
	}
	if db.Parent().SpanID() != service.SpanContext().SpanID() {
		t.Error("the database span should be a child of the service span")
	}
	if service.Parent().SpanID() != request.SpanContext().SpanID() {
		t.Error("the service span should be a child of the request span")
	}
}

// churchId is the one identifier worth carrying: without it a trace cannot
// answer "is this slow for everyone or for one church", which is the first
// question in any incident.
func TestTenantAttributesCarryChurchAndRole(t *testing.T) {
	attrs := TenantAttributes("church_a", "CHURCH_ADMIN")
	if len(attrs) != 2 {
		t.Fatalf("want 2 attributes, got %d", len(attrs))
	}

	found := map[string]string{}
	for _, a := range attrs {
		found[string(a.Key)] = a.Value.AsString()
	}
	if found[AttrChurchID] != "church_a" {
		t.Errorf("churchId = %q", found[AttrChurchID])
	}
	if found[AttrUserRole] != "CHURCH_ADMIN" {
		t.Errorf("role = %q", found[AttrUserRole])
	}
}

// A trace backend is a second copy of production data with weaker access
// controls than the database, so personal data must never reach it. This test
// exists to make that a decision someone has to consciously reverse.
func TestTenantAttributesCarryNoPersonalData(t *testing.T) {
	attrs := TenantAttributes("church_a", "MEMBER")
	for _, a := range attrs {
		key := string(a.Key)
		for _, forbidden := range []string{"user_id", "phone", "email", "name", "member"} {
			if key == "altar."+forbidden {
				t.Errorf("%q is personal data and must not appear on a span", key)
			}
		}
	}
}

func TestTenantAttributesOmitEmptyValues(t *testing.T) {
	if got := TenantAttributes("", ""); len(got) != 0 {
		t.Errorf("empty values should produce no attributes, got %v", got)
	}
	if got := TenantAttributes("church_a", ""); len(got) != 1 {
		t.Errorf("want just the church, got %v", got)
	}
}

// Amount and currency are operationally necessary — "are large gifts
// failing?" is a real question — and are not personal data on their own. They
// become personal data joined to a member, which is why no member identifier
// goes on the same span.
func TestMoneyAttributesCarryNoPayerIdentity(t *testing.T) {
	attrs := MoneyAttributes(10000, "GHS")
	if len(attrs) != 2 {
		t.Fatalf("want 2 attributes, got %d", len(attrs))
	}
	for _, a := range attrs {
		key := string(a.Key)
		if key != "altar.amount_minor" && key != "altar.currency" {
			t.Errorf("unexpected attribute %q on a money span", key)
		}
	}
}

// Trace context must survive a hop between services, or a distributed trace is
// just several local ones with the same name.
func TestTraceContextPropagatesAcrossAServiceBoundary(t *testing.T) {
	tp := sdktrace.NewTracerProvider()
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagator())
	t.Cleanup(func() { otel.SetTracerProvider(sdktrace.NewTracerProvider()) })

	ctx, span := Start(context.Background(), "outbound")
	defer span.End()
	original := span.SpanContext().TraceID()

	// Inject into headers, as an outbound HTTP call would.
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	if carrier["traceparent"] == "" {
		t.Fatal("no traceparent header was injected; the next service starts a new trace")
	}

	// Extract on the other side, as the receiving middleware would.
	received := otel.GetTextMapPropagator().Extract(context.Background(), carrier)
	_, downstream := Start(received, "inbound")
	defer downstream.End()

	if downstream.SpanContext().TraceID() != original {
		t.Fatal("the trace id did not survive the hop")
	}
}

// A sample ratio outside 0..1 is a configuration mistake, and defaulting is
// safer than sampling everything: at full sampling the collector becomes a
// second production dependency sized like the first.
func TestInvalidSampleRatioFallsBackToTheDefault(t *testing.T) {
	for _, ratio := range []float64{0, -1, 2, 100} {
		provider, err := Init(context.Background(), Config{
			ServiceName: "gateway",
			SampleRatio: ratio,
			// No endpoint, so this exercises the config path without needing
			// a collector.
		})
		if err != nil {
			t.Fatalf("ratio %v: %v", ratio, err)
		}
		_ = provider.Shutdown(context.Background())
	}
}
