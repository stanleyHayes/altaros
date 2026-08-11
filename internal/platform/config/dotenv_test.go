package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeEnvFile(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	return path
}

func TestLoadDotEnvSetsKeysTheProcessDoesNotHave(t *testing.T) {
	path := writeEnvFile(t, "ALTAR_TEST_KEY=from-file\n")
	os.Unsetenv("ALTAR_TEST_KEY")
	t.Cleanup(func() { os.Unsetenv("ALTAR_TEST_KEY") })

	if err := LoadDotEnv(path); err != nil {
		t.Fatalf("LoadDotEnv: %v", err)
	}
	if got := os.Getenv("ALTAR_TEST_KEY"); got != "from-file" {
		t.Fatalf("key not loaded: got %q", got)
	}
}

// The property that makes this safe to run in production: a file that ends up
// beside the binary must never displace what the orchestrator passed in.
func TestLoadDotEnvNeverOverridesTheRealEnvironment(t *testing.T) {
	path := writeEnvFile(t, "ALTAR_TEST_KEY=from-file\n")
	t.Setenv("ALTAR_TEST_KEY", "from-environment")

	if err := LoadDotEnv(path); err != nil {
		t.Fatalf("LoadDotEnv: %v", err)
	}
	if got := os.Getenv("ALTAR_TEST_KEY"); got != "from-environment" {
		t.Fatalf("file overrode the real environment: got %q", got)
	}
}

// An empty value set deliberately is a decision — "this feature is off" — and a
// file must not be able to switch it back on.
func TestLoadDotEnvTreatsAnEmptyRealValueAsSet(t *testing.T) {
	path := writeEnvFile(t, "ALTAR_TEST_KEY=from-file\n")
	t.Setenv("ALTAR_TEST_KEY", "")

	if err := LoadDotEnv(path); err != nil {
		t.Fatalf("LoadDotEnv: %v", err)
	}
	if got := os.Getenv("ALTAR_TEST_KEY"); got != "" {
		t.Fatalf("file filled in a deliberately empty value: got %q", got)
	}
}

func TestLoadDotEnvIgnoresAMissingFile(t *testing.T) {
	if err := LoadDotEnv(filepath.Join(t.TempDir(), "absent")); err != nil {
		t.Fatalf("a missing file must not be an error: %v", err)
	}
}

func TestParseDotEnvLine(t *testing.T) {
	cases := []struct {
		name, line, key, value string
		ok                     bool
	}{
		{name: "plain", line: "A=b", key: "A", value: "b", ok: true},
		{name: "comment", line: "# A=b"},
		{name: "blank", line: "   "},
		{name: "no equals", line: "JUST_A_WORD"},
		{name: "empty key", line: "=orphan"},
		{name: "export prefix", line: "export A=b", key: "A", value: "b", ok: true},
		{name: "empty value", line: "A=", key: "A", value: "", ok: true},
		// Quotes are stripped: a secret carrying its own quote marks fails
		// authentication somewhere far away, with nothing pointing back here.
		{name: "double quoted", line: `A="b c"`, key: "A", value: "b c", ok: true},
		{name: "single quoted", line: "A='b c'", key: "A", value: "b c", ok: true},
		// A base64 key ends in '=' and must survive intact — this is the shape
		// every generated encryption key in this project has.
		{name: "base64 value", line: "A=c2VjcmV0Cg==", key: "A", value: "c2VjcmV0Cg==", ok: true},
		{name: "value contains equals", line: "A=b=c", key: "A", value: "b=c", ok: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			key, value, ok := parseDotEnvLine(tc.line)
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v", ok, tc.ok)
			}
			if ok && (key != tc.key || value != tc.value) {
				t.Fatalf("got (%q, %q), want (%q, %q)", key, value, tc.key, tc.value)
			}
		})
	}
}

// The failure that produced validateNotProxyingItself: a gateway on the same
// port it forwards unported routes to serves its own proxy, and does it
// quietly. It must refuse to start instead.
func TestConfigRefusesToProxyItself(t *testing.T) {
	cases := []struct {
		name       string
		port       int
		legacy     string
		wantRefuse bool
	}{
		{name: "same port on localhost", port: 3001,
			legacy: "http://localhost:3001", wantRefuse: true},
		{name: "same port on loopback ip", port: 3001,
			legacy: "http://127.0.0.1:3001", wantRefuse: true},
		{name: "implied port 80", port: 80,
			legacy: "http://localhost", wantRefuse: true},
		{name: "different port", port: 8080,
			legacy: "http://localhost:3001"},
		// Another machine on the same port is an ordinary deployment.
		{name: "same port, another host", port: 3001,
			legacy: "http://legacy.internal:3001"},
		{name: "no upstream at all", port: 3001, legacy: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &Config{HTTPPort: tc.port, LegacyAPIURL: tc.legacy}
			err := c.validateNotProxyingItself()
			if tc.wantRefuse && err == nil {
				t.Fatal("started while proxying itself")
			}
			if !tc.wantRefuse && err != nil {
				t.Fatalf("refused a valid configuration: %v", err)
			}
		})
	}
}
