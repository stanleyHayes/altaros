// Package tracing wires OpenTelemetry across the platform (WP-08).
//
// The problem this solves is specific. A giving request touches the gateway,
// the finance service, MongoDB, and Paystack; when it is slow or wrong, the
// logs show four unrelated lines in four places with no way to tell which
// belong to the same gift. A trace makes that one object with a shape.
//
// Two decisions worth stating:
//
//   - Tracing is OPTIONAL. With no collector configured, everything here
//     becomes a no-op and the service runs normally. Observability that can
//     take the platform down when its collector is unreachable is worse than
//     none, because the failure arrives during exactly the incident you needed
//     it for.
//   - Spans carry churchId but never personal data. A trace backend is a
//     second copy of production data with weaker access controls than the
//     database, and Ghana's Act 843 does not distinguish "it was only in a
//     span attribute".
package tracing

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.27.0"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

// Config controls tracing.
type Config struct {
	// Endpoint is the OTLP gRPC collector, e.g. "otel-collector:4317". Empty
	// disables tracing entirely.
	Endpoint string
	// ServiceName identifies this service in the trace backend.
	ServiceName string
	// Environment separates production traces from staging ones.
	Environment string
	// SampleRatio is the fraction of traces recorded, 0..1. Production runs
	// well below 1: at full sampling the collector becomes a second production
	// dependency sized like the first.
	SampleRatio float64
	// Insecure skips TLS to the collector, which is normal for an in-cluster
	// sidecar and wrong anywhere else.
	Insecure bool
}

// Provider is a running tracing pipeline.
type Provider struct {
	tp       *sdktrace.TracerProvider
	shutdown func(context.Context) error
	enabled  bool
}

// Enabled reports whether traces are actually being exported.
func (p *Provider) Enabled() bool { return p != nil && p.enabled }

// Shutdown flushes pending spans.
//
// Called on the way out with a bounded context: an unreachable collector must
// not delay the shutdown of a service that has already stopped serving.
func (p *Provider) Shutdown(ctx context.Context) error {
	if p == nil || p.shutdown == nil {
		return nil
	}
	return p.shutdown(ctx)
}

// Init sets up tracing, returning a Provider that is safe to use either way.
//
// A missing endpoint is not an error: it is the normal state in development
// and in any deployment that has not adopted a collector yet.
func Init(ctx context.Context, cfg Config) (*Provider, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		// A no-op tracer, not a nil one. Callers can start spans
		// unconditionally, which keeps the instrumentation free of `if
		// tracingEnabled` branches that inevitably drift.
		otel.SetTracerProvider(noop.NewTracerProvider())
		otel.SetTextMapPropagator(propagator())
		return &Provider{enabled: false}, nil
	}

	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(cfg.ServiceName),
			semconv.DeploymentEnvironmentName(cfg.Environment),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("tracing: build resource: %w", err)
	}

	opts := []otlptracegrpc.Option{otlptracegrpc.WithEndpoint(endpoint)}
	if cfg.Insecure {
		opts = append(opts, otlptracegrpc.WithInsecure())
	}

	exporter, err := otlptracegrpc.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("tracing: connect to collector at %s: %w", endpoint, err)
	}

	ratio := cfg.SampleRatio
	if ratio <= 0 || ratio > 1 {
		ratio = 0.1
	}

	tp := sdktrace.NewTracerProvider(
		// ParentBased so a sampled request stays sampled through every hop.
		// Sampling per-service independently produces traces with holes in
		// them, which are harder to read than no trace at all.
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(ratio))),
		sdktrace.WithBatcher(exporter,
			// Bounded queue and a short timeout: if the collector stalls, spans
			// are dropped rather than accumulated until the service runs out
			// of memory. Losing traces is an inconvenience; losing the service
			// to its own telemetry is an outage.
			sdktrace.WithMaxQueueSize(2048),
			sdktrace.WithExportTimeout(10*time.Second),
			sdktrace.WithBatchTimeout(5*time.Second),
		),
		sdktrace.WithResource(res),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagator())

	return &Provider{tp: tp, shutdown: tp.Shutdown, enabled: true}, nil
}

// propagator carries trace context between services.
//
// W3C tracecontext plus baggage: tracecontext is what every backend
// understands, and baggage is what lets churchId travel with a request across
// a service boundary without being threaded through every signature.
func propagator() propagation.TextMapPropagator {
	return propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	)
}

// Tracer returns a named tracer. Safe before Init: the global provider starts
// as a no-op.
func Tracer(name string) trace.Tracer {
	return otel.Tracer(name)
}

// Start begins a span. A convenience so callers do not each pick a tracer name.
func Start(ctx context.Context, name string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	return otel.Tracer("altar-os").Start(ctx, name, opts...)
}

// Attribute keys used across the platform. Defined once so a trace query
// written against one service works against all of them.
const (
	AttrChurchID    = "altar.church_id"
	AttrUserRole    = "altar.user_role"
	AttrService     = "altar.service"
	AttrCollection  = "altar.collection"
	AttrTransaction = "altar.transaction_id"
	AttrProvider    = "altar.payment_provider"
	AttrChannel     = "altar.payment_channel"
)

// TenantAttributes returns the span attributes for a tenant-scoped operation.
//
// churchId and role only. NOT the user id, phone number, email, or member name:
// a trace backend is a second copy of production data with weaker access
// controls than the database, and Act 843 does not distinguish "it was only in
// a span attribute". churchId is the one identifier worth the risk, because
// without it a trace cannot answer "is this slow for everyone or for one
// church" — which is the first question in any incident.
func TenantAttributes(churchID, role string) []attribute.KeyValue {
	attrs := make([]attribute.KeyValue, 0, 2)
	if churchID != "" {
		attrs = append(attrs, attribute.String(AttrChurchID, churchID))
	}
	if role != "" {
		attrs = append(attrs, attribute.String(AttrUserRole, role))
	}
	return attrs
}

// MoneyAttributes describes an amount without revealing who paid it.
//
// The amount and currency are operationally necessary — "are large gifts
// failing?" is a real question — and are not personal data on their own. They
// become personal data when joined to a member, which is exactly why no member
// identifier goes on the same span.
func MoneyAttributes(minor int64, currency string) []attribute.KeyValue {
	return []attribute.KeyValue{
		attribute.Int64("altar.amount_minor", minor),
		attribute.String("altar.currency", currency),
	}
}
