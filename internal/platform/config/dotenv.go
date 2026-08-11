package config

import (
	"bufio"
	"os"
	"strings"
)

// DotEnvPathVar names the file to load, when the default is not wanted.
const DotEnvPathVar = "ENV_FILE"

// DefaultDotEnvPath is the Go API's own settings, at the module root.
//
// NOT apps/api/.env. That belongs to the legacy TypeScript API, and pointing
// this at it made the gateway adopt another application's configuration —
// including its PORT=3001, which is the very address the gateway proxies
// unported routes TO. The result was a service listening on its own upstream:
// it started cleanly, logged nothing wrong, and answered nothing.
const DefaultDotEnvPath = ".env"

// LoadDotEnv reads KEY=VALUE lines into the process environment.
//
// This exists because the settings were being written to `apps/api/.env` and
// then read by nothing: the config layer calls os.Getenv, `make run` execs the
// binary directly, and no library was loading the file. Every key in it was
// therefore inert — WELFARE_ENCRYPTION_KEY was set in the file and absent from
// the process, so welfare encryption was off in every development run while the
// file said it was on. That is the worst shape a configuration bug can take:
// the operator has evidence the feature is configured, and the running system
// disagrees silently.
//
// A REAL environment variable always wins. Nothing here overwrites a value the
// process already has, which is what makes the file safe in production: an
// orchestrator's secrets take precedence over any file that ends up beside the
// binary, and a stale .env baked into an image cannot quietly replace them.
//
// A missing file is not an error. Production passes real environment variables
// and has no file; refusing to start without one would break the deployment
// this is meant to support.
func LoadDotEnv(path string) error {
	if path == "" {
		path = os.Getenv(DotEnvPathVar)
	}
	if path == "" {
		path = DefaultDotEnvPath
	}

	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		key, value, ok := parseDotEnvLine(scanner.Text())
		if !ok {
			continue
		}
		if _, present := os.LookupEnv(key); present {
			// LookupEnv rather than Getenv: an empty string set deliberately
			// is a decision, and a file must not be able to override it with
			// something non-empty.
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	return scanner.Err()
}

// parseDotEnvLine reads one line, reporting whether it carried a setting.
func parseDotEnvLine(line string) (key, value string, ok bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	// `export FOO=bar` is what people paste from a shell.
	line = strings.TrimPrefix(line, "export ")

	key, value, found := strings.Cut(line, "=")
	if !found {
		return "", "", false
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return "", "", false
	}

	value = strings.TrimSpace(value)
	// Quotes are stripped, because a quoted secret whose quotes survive is a
	// secret that fails authentication with no visible cause.
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			value = value[1 : len(value)-1]
		}
	}
	return key, value, true
}
