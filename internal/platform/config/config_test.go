package config

import (
	"errors"
	"os"
	"strings"
	"testing"
)

// clearSecrets removes every secret the tests care about so one test's
// environment cannot leak into another.
func clearSecrets(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"APP_ENV", "PORT", "CORS_ORIGIN", "JWT_SECRET",
		"PAYSTACK_SECRET_KEY", "PAYSTACK_PUBLIC_KEY", "PAYSTACK_WEBHOOK_SECRET",
		"AT_API_KEY", "AT_USERNAME", "RESEND_API_KEY", "RESEND_FROM_EMAIL",
		"FIREBASE_SERVICE_ACCOUNT", "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_BUNDLE_ID", "APNS_PRIVATE_KEY",
		"ANTHROPIC_API_KEY",
	} {
		t.Setenv(k, "")
	}
}

func TestDevelopmentBootsWithoutSecrets(t *testing.T) {
	clearSecrets(t)
	t.Setenv("APP_ENV", "development")

	cfg, err := Load("finance")
	if err != nil {
		t.Fatalf("development should boot without secrets, got: %v", err)
	}
	if cfg.JWT.Secret == "" {
		t.Error("development should fall back to a placeholder JWT secret")
	}
}

// The whole point of WP-05: a production boot with missing secrets must fail
// loudly rather than start with stubs. The TypeScript API it replaces defaulted
// every secret to "" and shipped a payment stub that always reported success.
func TestProductionFailsOnMissingSecrets(t *testing.T) {
	clearSecrets(t)
	t.Setenv("APP_ENV", "production")

	_, err := Load("finance")
	if err == nil {
		t.Fatal("production must not boot with missing secrets")
	}

	var missing *MissingSecretsError
	if !errors.As(err, &missing) {
		t.Fatalf("want *MissingSecretsError, got %T: %v", err, err)
	}

	// The operator needs every missing key at once, not one per restart.
	for _, want := range []string{
		"JWT_SECRET", "PAYSTACK_SECRET_KEY", "PAYSTACK_PUBLIC_KEY", "PAYSTACK_WEBHOOK_SECRET",
	} {
		if !strings.Contains(missing.Error(), want) {
			t.Errorf("error should name %s; got: %s", want, missing.Error())
		}
	}
}

// Requirements are per-service so one service is not blocked by a key it
// never uses.
func TestRequiredSecretsAreScopedPerService(t *testing.T) {
	clearSecrets(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "test-secret")

	if _, err := Load("church"); err != nil {
		t.Errorf("church needs no payment or messaging keys, got: %v", err)
	}

	var missing *MissingSecretsError
	_, err := Load("finance")
	if !errors.As(err, &missing) {
		t.Fatalf("finance requires Paystack keys, got: %v", err)
	}
	if strings.Contains(missing.Error(), "ANTHROPIC_API_KEY") {
		t.Error("finance should not require the AI key")
	}
}

func TestNotificationRequiresBothNativePushProviders(t *testing.T) {
	clearSecrets(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "test-secret")
	var missing *MissingSecretsError
	_, err := Load("notification")
	if !errors.As(err, &missing) {
		t.Fatalf("notification must require provider credentials, got: %v", err)
	}
	for _, want := range []string{
		"FIREBASE_SERVICE_ACCOUNT", "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY",
	} {
		if !strings.Contains(missing.Error(), want) {
			t.Errorf("missing error should name %s; got %s", want, missing.Error())
		}
	}
}

// The gateway fronts every service, so it must hold every downstream secret.
func TestGatewayRequiresEverySecret(t *testing.T) {
	clearSecrets(t)
	t.Setenv("APP_ENV", "production")

	var missing *MissingSecretsError
	if _, err := Load("gateway"); !errors.As(err, &missing) {
		t.Fatalf("want *MissingSecretsError, got: %v", err)
	}
	if len(missing.Keys) < 9 {
		t.Errorf("gateway should require every downstream secret, got %d: %v",
			len(missing.Keys), missing.Keys)
	}
}

func TestProductionBootsWhenSecretsPresent(t *testing.T) {
	clearSecrets(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "s")
	t.Setenv("PAYSTACK_SECRET_KEY", "s")
	t.Setenv("PAYSTACK_PUBLIC_KEY", "s")
	t.Setenv("PAYSTACK_WEBHOOK_SECRET", "s")

	cfg, err := Load("finance")
	if err != nil {
		t.Fatalf("should boot with all required secrets: %v", err)
	}
	if cfg.Env != Production {
		t.Errorf("want production, got %s", cfg.Env)
	}
}

// Whitespace-only is not a secret. Without TrimSpace a stray space in a
// deployment manifest would satisfy the check.
func TestWhitespaceIsNotASecret(t *testing.T) {
	clearSecrets(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "   ")

	var missing *MissingSecretsError
	if _, err := Load("church"); !errors.As(err, &missing) {
		t.Fatal("a whitespace-only secret must be treated as missing")
	}
}

func TestRejectsUnknownEnv(t *testing.T) {
	clearSecrets(t)
	t.Setenv("APP_ENV", "prod") // not one of the three valid values

	if _, err := Load("gateway"); err == nil {
		t.Fatal("APP_ENV=prod should be rejected rather than silently treated as production")
	}
}

// Empty is a meaningful value for the legacy proxy: it means "do not forward
// anywhere". Treating it as unset restored the default, so a production
// deployment that explicitly disabled the proxy would have tried to forward
// traffic to localhost:3001 — and CI, which passes it empty, would have hung
// against a legacy API that is not running.
func TestEmptyLegacyAPIURLDisablesTheProxy(t *testing.T) {
	t.Setenv("LEGACY_API_URL", "")

	cfg, err := Load("gateway")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LegacyAPIURL != "" {
		t.Fatalf("LegacyAPIURL = %q; setting it empty must disable the proxy, not restore the default",
			cfg.LegacyAPIURL)
	}
}

// Absent, on the other hand, should keep the development default so a
// developer running `make run` gets a working platform without configuration.
func TestAbsentLegacyAPIURLUsesTheDevelopmentDefault(t *testing.T) {
	os.Unsetenv("LEGACY_API_URL")

	cfg, err := Load("gateway")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LegacyAPIURL == "" {
		t.Fatal("with the variable absent, the development default should apply")
	}
}

func TestLegacyAPIURLIsTrimmed(t *testing.T) {
	t.Setenv("LEGACY_API_URL", "  http://legacy.internal:3001  ")

	cfg, err := Load("gateway")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LegacyAPIURL != "http://legacy.internal:3001" {
		t.Errorf("LegacyAPIURL = %q, want it trimmed", cfg.LegacyAPIURL)
	}
}

// The same empty-versus-absent distinction as LEGACY_API_URL, and it bit
// twice. For KAFKA_BROKERS, empty means "run without a broker" — a real
// deployment shape and what CI's smoke job uses. Treating it as unset
// restored the development default, so the service tried to reach a broker on
// localhost that was not there and refused to start.
func TestEmptyKafkaBrokersMeansNoBroker(t *testing.T) {
	t.Setenv("KAFKA_BROKERS", "")

	cfg, err := Load("gateway")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.Kafka.Brokers) != 0 {
		t.Fatalf("brokers = %v; setting the variable empty must mean no broker",
			cfg.Kafka.Brokers)
	}
}

func TestAbsentKafkaBrokersUsesTheDevelopmentDefault(t *testing.T) {
	os.Unsetenv("KAFKA_BROKERS")

	cfg, err := Load("gateway")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.Kafka.Brokers) == 0 {
		t.Fatal("with the variable absent, the development default should apply")
	}
}

// A list with blank entries must not produce empty broker addresses, which
// the client would then try to dial.
func TestBrokerListIgnoresBlankEntries(t *testing.T) {
	t.Setenv("KAFKA_BROKERS", " a:9092 , , b:9092 ,")

	cfg, err := Load("gateway")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.Kafka.Brokers) != 2 {
		t.Fatalf("brokers = %v, want two", cfg.Kafka.Brokers)
	}
}
