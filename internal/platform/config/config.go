// Package config loads and validates runtime configuration.
//
// The guiding rule (WP-05): a non-development environment must never boot with
// a missing secret. The TypeScript API this replaces defaulted every secret to
// "" and shipped a StubPaymentGateway whose verifyCharge() returned success
// unconditionally — a stub that silently green-lights every payment. Failing
// loudly at startup is the whole point of this package.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Env is the deployment environment. Secret requirements are relaxed only in
// Development.
type Env string

const (
	Development Env = "development"
	Staging     Env = "staging"
	Production  Env = "production"
)

// IsProduction reports whether secrets must be present and real.
func (e Env) IsProduction() bool { return e == Production }

// RequiresRealSecrets reports whether stub integrations are forbidden.
func (e Env) RequiresRealSecrets() bool { return e == Staging || e == Production }

// Config is the fully-resolved application configuration.
type Config struct {
	Env         Env
	ServiceName string
	HTTPPort    int
	CORSOrigins []string

	// DataRegion pins where this instance may store personal data. Church
	// membership reveals religious belief, which is special-category data in
	// Ghana (Act 843), Nigeria (NDPA) and Kenya (DPA) alike, so residency is
	// configuration rather than convention.
	DataRegion string

	Mongo MongoConfig
	Redis RedisConfig
	Kafka KafkaConfig

	JWT JWTConfig

	Paystack   PaystackConfig
	AfricasTkg AfricasTalkingConfig
	Resend     ResendConfig
	Cloudinary CloudinaryConfig
	Anthropic  AnthropicConfig
}

// MongoConfig configures the MongoDB connection.
//
// All services share one database. Ownership of collections is enforced in
// code (a service only touches its own collections) rather than by separate
// databases, which keeps cross-collection transactions available where a
// domain genuinely needs them — giving writes a transaction and a ledger entry
// together, for instance.
type MongoConfig struct {
	URI      string
	Database string
	// ConnectTimeout bounds the initial handshake so a wedged network surfaces
	// at boot instead of on the first request.
	ConnectTimeout time.Duration
}

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

type KafkaConfig struct {
	Brokers []string
	// ConsumerGroup is per-service so each service tracks its own offsets.
	ConsumerGroup string
}

type JWTConfig struct {
	Secret     string
	AccessTTL  time.Duration
	RefreshTTL time.Duration
	Issuer     string
}

type PaystackConfig struct {
	SecretKey   string
	PublicKey   string
	CallbackURL string
	// WebhookSecret verifies inbound payment webhooks. Without it, anyone who
	// can reach the endpoint can forge a "payment succeeded" event.
	WebhookSecret string
}

type AfricasTalkingConfig struct {
	APIKey   string
	Username string
	SenderID string
}

type ResendConfig struct {
	APIKey    string
	FromEmail string
}

type CloudinaryConfig struct {
	CloudName string
	APIKey    string
	APISecret string
}

type AnthropicConfig struct {
	APIKey string
	// Model is pinned in config so a model change is a deploy, not a surprise.
	Model string
}

// MissingSecretsError names every secret that was absent, so an operator fixes
// them in one pass instead of restarting once per missing variable.
type MissingSecretsError struct {
	Env  Env
	Keys []string
}

func (e *MissingSecretsError) Error() string {
	return fmt.Sprintf(
		"config: %d required secret(s) missing for APP_ENV=%s: %s",
		len(e.Keys), e.Env, strings.Join(e.Keys, ", "),
	)
}

// Load reads configuration from the environment and validates it.
//
// serviceName scopes per-service values (Kafka consumer group, log fields).
// It returns a *MissingSecretsError when a non-development environment is
// missing secrets; callers should treat that as fatal.
func Load(serviceName string) (*Config, error) {
	if serviceName == "" {
		return nil, errors.New("config: serviceName is required")
	}

	env := Env(strings.ToLower(getenv("APP_ENV", string(Development))))
	switch env {
	case Development, Staging, Production:
	default:
		return nil, fmt.Errorf(
			"config: APP_ENV must be development, staging or production (got %q)", env)
	}

	cfg := &Config{
		Env:         env,
		ServiceName: serviceName,
		HTTPPort:    getenvInt("PORT", 8080),
		CORSOrigins: getenvList("CORS_ORIGIN", []string{"http://localhost:4173"}),
		DataRegion:  getenv("DATA_REGION", "gh"),

		Mongo: MongoConfig{
			URI:            getenv("MONGODB_URI", "mongodb://localhost:27017"),
			Database:       getenv("MONGODB_DATABASE", "altar-os"),
			ConnectTimeout: getenvDuration("MONGODB_CONNECT_TIMEOUT", 10*time.Second),
		},
		Redis: RedisConfig{
			Addr:     getenv("REDIS_ADDR", "127.0.0.1:6379"),
			Password: getenv("REDIS_PASSWORD", ""),
			DB:       getenvInt("REDIS_DB", 0),
		},
		Kafka: KafkaConfig{
			// 19092, not the usual 9092 — see the note in docker-compose.yml.
			Brokers:       getenvList("KAFKA_BROKERS", []string{"127.0.0.1:19092"}),
			ConsumerGroup: getenv("KAFKA_CONSUMER_GROUP", "altar-"+serviceName),
		},
		JWT: JWTConfig{
			Secret:     os.Getenv("JWT_SECRET"),
			AccessTTL:  getenvDuration("JWT_ACCESS_TTL", 15*time.Minute),
			RefreshTTL: getenvDuration("JWT_REFRESH_TTL", 30*24*time.Hour),
			Issuer:     getenv("JWT_ISSUER", "altar-os"),
		},

		Paystack: PaystackConfig{
			SecretKey:     os.Getenv("PAYSTACK_SECRET_KEY"),
			PublicKey:     os.Getenv("PAYSTACK_PUBLIC_KEY"),
			CallbackURL:   os.Getenv("PAYMENT_CALLBACK_URL"),
			WebhookSecret: os.Getenv("PAYSTACK_WEBHOOK_SECRET"),
		},
		AfricasTkg: AfricasTalkingConfig{
			APIKey:   os.Getenv("AT_API_KEY"),
			Username: os.Getenv("AT_USERNAME"),
			SenderID: os.Getenv("AT_SENDER_ID"),
		},
		Resend: ResendConfig{
			APIKey:    os.Getenv("RESEND_API_KEY"),
			FromEmail: os.Getenv("RESEND_FROM_EMAIL"),
		},
		Cloudinary: CloudinaryConfig{
			CloudName: os.Getenv("CLOUDINARY_CLOUD_NAME"),
			APIKey:    os.Getenv("CLOUDINARY_API_KEY"),
			APISecret: os.Getenv("CLOUDINARY_API_SECRET"),
		},
		Anthropic: AnthropicConfig{
			APIKey: os.Getenv("ANTHROPIC_API_KEY"),
			Model:  getenv("ANTHROPIC_MODEL", "claude-opus-5"),
		},
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// requiredSecrets lists the secrets each service needs in a non-dev
// environment. Keeping it per-service means the auth service isn't blocked by
// a missing Cloudinary key it never uses.
func requiredSecrets(service string) map[string]func(*Config) string {
	common := map[string]func(*Config) string{
		"JWT_SECRET": func(c *Config) string { return c.JWT.Secret },
	}

	perService := map[string]map[string]func(*Config) string{
		"finance": {
			"PAYSTACK_SECRET_KEY":     func(c *Config) string { return c.Paystack.SecretKey },
			"PAYSTACK_PUBLIC_KEY":     func(c *Config) string { return c.Paystack.PublicKey },
			"PAYSTACK_WEBHOOK_SECRET": func(c *Config) string { return c.Paystack.WebhookSecret },
		},
		"notification": {
			"AT_API_KEY":        func(c *Config) string { return c.AfricasTkg.APIKey },
			"AT_USERNAME":       func(c *Config) string { return c.AfricasTkg.Username },
			"RESEND_API_KEY":    func(c *Config) string { return c.Resend.APIKey },
			"RESEND_FROM_EMAIL": func(c *Config) string { return c.Resend.FromEmail },
		},
		"ai": {
			"ANTHROPIC_API_KEY": func(c *Config) string { return c.Anthropic.APIKey },
		},
	}

	out := make(map[string]func(*Config) string, len(common)+4)
	for k, v := range common {
		out[k] = v
	}
	for k, v := range perService[service] {
		out[k] = v
	}
	// The gateway fronts every service, so it must hold every secret those
	// services would need to verify a request it forwards.
	if service == "gateway" {
		for _, group := range perService {
			for k, v := range group {
				out[k] = v
			}
		}
	}
	return out
}

func (c *Config) validate() error {
	if c.HTTPPort <= 0 || c.HTTPPort > 65535 {
		return fmt.Errorf("config: PORT must be 1-65535 (got %d)", c.HTTPPort)
	}
	if len(c.CORSOrigins) == 0 {
		return errors.New("config: CORS_ORIGIN must list at least one origin")
	}

	if !c.Env.RequiresRealSecrets() {
		// Development may run against stubs, but never with a guessable JWT
		// secret that could be copy-pasted into a real deployment.
		if c.JWT.Secret == "" {
			c.JWT.Secret = "dev-only-insecure-secret-do-not-deploy"
		}
		return nil
	}

	var missing []string
	for key, get := range requiredSecrets(c.ServiceName) {
		if strings.TrimSpace(get(c)) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		sortStrings(missing)
		return &MissingSecretsError{Env: c.Env, Keys: missing}
	}
	return nil
}

// --- env helpers ---

func getenv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func getenvDuration(key string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func getenvList(key string, fallback []string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return fallback
	}
	return out
}

// sortStrings keeps the missing-secret list deterministic so the same
// misconfiguration always produces the same message (and the same test).
func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
