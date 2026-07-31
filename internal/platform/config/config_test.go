package config

import (
	"errors"
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
