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
	// Tracing configures OpenTelemetry (WP-08). Disabled when the endpoint is
	// empty, which is the normal state in development.
	Tracing TracingConfig
	// LegacyAPIURL is the TypeScript API the gateway forwards not-yet-ported
	// routes to (the strangler-fig proxy). Empty means unported paths 404,
	// which is what should happen once the legacy API retires at WP-20.
	LegacyAPIURL string

	// PublicBaseDomain is the domain church subdomains hang off (WP-39).
	//
	// `grace-chapel.altaros.com` is Grace Chapel; `api.altaros.com` is this
	// gateway. Configuration rather than a constant because it differs per
	// environment — staging is not altaros.com — and because a host-resolution
	// rule hard-coded to production silently resolves nothing anywhere else.
	//
	// Empty disables host-based tenancy entirely, which is the correct default
	// for a local gateway reached at localhost:8080.
	PublicBaseDomain string

	// PublicAppURL is where a person lands when they follow a link the platform
	// sent them — currently only invitations (WP-37).
	//
	// Configuration rather than a header off the request. Building the link from
	// the Host of whatever request happened to trigger it means an attacker who
	// can set Host controls where an invitation email points, and the recipient
	// has no way to tell: the mail genuinely comes from us, and the link goes to
	// a credential-harvesting clone of our own login page.
	PublicAppURL string

	Mongo MongoConfig
	Redis RedisConfig
	Kafka KafkaConfig

	JWT JWTConfig

	Paystack PaystackConfig
	// SMS names which provider actually sends, and holds both providers'
	// credentials. A deployment configures one; requiring both would block a
	// boot on a key for a provider it does not use.
	SMS        SMSConfig
	AfricasTkg AfricasTalkingConfig
	Resend     ResendConfig
	Cloudinary CloudinaryConfig
	Anthropic  AnthropicConfig

	// WelfareKey encrypts welfare case contents (WP-27, §3.4(3)).
	//
	// Its OWN secret, deliberately separate from JWT_SECRET and the database
	// credentials. The point of a separate key is that losing any one secret
	// stops short of the most sensitive data in the product; a key that lives
	// beside the thing it protects leaks with it.
	//
	// Absent, the welfare service refuses to store anything rather than
	// writing plaintext — see welfare.NewService.
	WelfareKey string
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

// TracingConfig configures OpenTelemetry export.
type TracingConfig struct {
	// Endpoint is the OTLP gRPC collector. Empty disables tracing.
	Endpoint string
	// SampleRatio is the fraction of traces recorded. Well below 1 in
	// production: at full sampling the collector becomes a second production
	// dependency sized like the first.
	SampleRatio float64
	Insecure    bool
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

// SMSProvider names the transport that actually sends.
type SMSProvider string

const (
	// SMSArkesel is the Ghana provider chosen on 2 Aug 2026.
	SMSArkesel SMSProvider = "arkesel"
	// SMSAfricasTalking is the original transport, kept behind the same port.
	SMSAfricasTalking SMSProvider = "africastalking"
)

// SMSConfig selects and configures the SMS provider.
//
// Explicit rather than inferred from which credentials happen to be present.
// Inference reads well until a deployment holds keys for both — during a
// provider switch, which is exactly when it matters — and then the transport
// that sends is whichever branch was written first, silently.
type SMSConfig struct {
	Provider SMSProvider
	Arkesel  ArkeselConfig
}

// ArkeselConfig holds the Arkesel credentials.
type ArkeselConfig struct {
	APIKey string
	// SenderID must be REGISTERED with Arkesel. An unregistered one is a 403 on
	// every send, so it is treated as a required secret rather than a nicety.
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
		// Every local frontend port, because the apps now talk to this gateway
		// rather than the legacy API: dashboard/web/admin/marketing on both the
		// preview (4173+) and dev (5173+) ranges, and Expo web on 8081.
		CORSOrigins: getenvList("CORS_ORIGIN", []string{
			"http://localhost:4173", "http://localhost:4174",
			"http://localhost:4175", "http://localhost:4176",
			"http://localhost:5173", "http://localhost:5174",
			"http://localhost:5175", "http://localhost:5176",
			"http://localhost:8081",
		}),
		DataRegion:   getenv("DATA_REGION", "gh"),
		LegacyAPIURL: getenvOptional("LEGACY_API_URL", "http://localhost:3001"),
		PublicAppURL: strings.TrimRight(getenv("PUBLIC_APP_URL", "http://localhost:5173"), "/"),
		// Optional, and empty by default: a developer running the gateway on
		// localhost has no subdomains, and defaulting to the production domain
		// would make every local Host header fail to match rather than be
		// ignored.
		PublicBaseDomain: strings.ToLower(strings.TrimSpace(os.Getenv("PUBLIC_BASE_DOMAIN"))),
		Tracing: TracingConfig{
			Endpoint:    os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
			SampleRatio: getenvFloat("OTEL_TRACES_SAMPLER_ARG", 0.1),
			// In-cluster collectors are reached over the pod network and do
			// not normally present a certificate. Anything outside the cluster
			// must set this false.
			Insecure: getenvBool("OTEL_EXPORTER_OTLP_INSECURE", true),
		},

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
			Brokers:       getenvListOptional("KAFKA_BROKERS", []string{"127.0.0.1:19092"}),
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
		SMS: SMSConfig{
			Provider: normaliseSMSProvider(os.Getenv("SMS_PROVIDER")),
			Arkesel: ArkeselConfig{
				APIKey:   os.Getenv("ARKESEL_API_KEY"),
				SenderID: os.Getenv("ARKESEL_SENDER_ID"),
			},
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
		WelfareKey: os.Getenv("WELFARE_ENCRYPTION_KEY"),
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
func requiredSecrets(service string, sms SMSProvider) map[string]func(*Config) string {
	common := map[string]func(*Config) string{
		"JWT_SECRET": func(c *Config) string { return c.JWT.Secret },
	}

	// Only the ACTIVE provider's credentials are required. Requiring both would
	// mean a deployment that has switched to Arkesel cannot boot without also
	// holding an Africa's Talking username it will never use — which is how a
	// required-secrets check stops being read and starts being worked around.
	smsSecrets := map[string]func(*Config) string{
		"ARKESEL_API_KEY":   func(c *Config) string { return c.SMS.Arkesel.APIKey },
		"ARKESEL_SENDER_ID": func(c *Config) string { return c.SMS.Arkesel.SenderID },
	}
	if sms == SMSAfricasTalking {
		smsSecrets = map[string]func(*Config) string{
			"AT_API_KEY":  func(c *Config) string { return c.AfricasTkg.APIKey },
			"AT_USERNAME": func(c *Config) string { return c.AfricasTkg.Username },
		}
	}

	perService := map[string]map[string]func(*Config) string{
		"finance": {
			"PAYSTACK_SECRET_KEY":     func(c *Config) string { return c.Paystack.SecretKey },
			"PAYSTACK_PUBLIC_KEY":     func(c *Config) string { return c.Paystack.PublicKey },
			"PAYSTACK_WEBHOOK_SECRET": func(c *Config) string { return c.Paystack.WebhookSecret },
		},
		"notification": {
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
	if service == "notification" || service == "gateway" || service == "auth" {
		// auth as well as notification: a login OTP is an SMS, and an auth
		// service that boots without a transport refuses every sign-in.
		for k, v := range smsSecrets {
			out[k] = v
		}
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
	for key, get := range requiredSecrets(c.ServiceName, c.SMS.Provider) {
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

// normaliseSMSProvider reads SMS_PROVIDER, defaulting to Arkesel.
//
// An UNRECOGNISED value falls back to the default rather than erroring, and
// that is a deliberate asymmetry with NormalisePlan, which fails to the
// cheapest tier: there, an unrecognised value granting paid features is a
// revenue leak nobody notices. Here, both options send real messages through a
// configured account, so the safe direction is "use the one this deployment is
// set up for" — and a typo surfaces immediately as a missing-secret failure at
// boot, naming the provider it fell back to.
func normaliseSMSProvider(raw string) SMSProvider {
	switch SMSProvider(strings.ToLower(strings.TrimSpace(raw))) {
	case SMSAfricasTalking:
		return SMSAfricasTalking
	case SMSArkesel:
		return SMSArkesel
	default:
		return SMSArkesel
	}
}

// --- env helpers ---

func getenv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// getenvOptional returns the value whenever the variable is SET, even to the
// empty string, and falls back only when it is absent entirely.
//
// This matters wherever empty is a meaningful setting rather than "not
// configured". LEGACY_API_URL is the case in point: empty means "do not proxy
// anywhere", which is what CI passes and what production needs once the legacy
// API retires. Through getenv, setting it empty silently restored the default
// and the service would have tried to forward production traffic to
// localhost:3001.
func getenvOptional(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return strings.TrimSpace(v)
	}
	return fallback
}

// getenvListOptional reads a comma-separated list, distinguishing an ABSENT
// variable from one explicitly set to empty.
//
// Same reasoning as getenvOptional, and the same bug twice: for KAFKA_BROKERS,
// empty means "run without a broker" — a real deployment shape, and what CI's
// smoke job asserts. Through getenvList, setting it empty silently restored
// the development default and the service tried to reach a broker on localhost
// that was not there, then refused to start.
func getenvListOptional(key string, fallback []string) []string {
	raw, present := os.LookupEnv(key)
	if !present {
		return fallback
	}
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	return getenvList(key, fallback)
}

func getenvFloat(key string, fallback float64) float64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func getenvBool(key string, fallback bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return parsed
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

// getenvList reads a comma-separated list, treating empty as unset.
//
// That is right for most settings — an empty CORS_ORIGIN means "nobody
// configured this", and the default should apply. Where empty is a MEANINGFUL
// value, use getenvListOptional instead.
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
