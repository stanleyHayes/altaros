// Package testsupport holds the shared policy for integration tests.
//
// It exists for one decision: what an unavailable dependency means. Locally it
// means "skip, you haven't run `make infra-up`". In CI it must mean "fail",
// because a skipped integration test is indistinguishable from a passing one
// in a green checkmark — and almost every guarantee in this codebase (tenant
// isolation, payment idempotency, consent gating) is only proven against a
// real database.
//
// Without this, the CI job that runs `make test` would report success having
// executed none of it.
package testsupport

import (
	"os"
	"testing"
)

// RequireInfraEnv is set in CI to turn a skipped dependency into a failure.
const RequireInfraEnv = "REQUIRE_INFRA"

// InfraRequired reports whether missing dependencies must fail the run.
func InfraRequired() bool {
	return os.Getenv(RequireInfraEnv) != ""
}

// SkipOrFail handles an unreachable dependency.
//
// It never returns: it either skips or fails the test.
func SkipOrFail(t *testing.T, dependency string, err error) {
	t.Helper()
	if InfraRequired() {
		t.Fatalf("%s is required when %s is set, but is unavailable: %v",
			dependency, RequireInfraEnv, err)
	}
	t.Skipf("%s unavailable (run `make infra-up`): %v", dependency, err)
}

// MongoURI returns the MongoDB URI for tests.
func MongoURI() string {
	if uri := os.Getenv("MONGODB_URI"); uri != "" {
		return uri
	}
	return "mongodb://localhost:27017"
}

// RedisAddr returns the Redis address for tests.
func RedisAddr() string {
	if addr := os.Getenv("REDIS_ADDR"); addr != "" {
		return addr
	}
	return "127.0.0.1:6379"
}
