// Command seed fills a development database with realistic church data.
//
//	make seed          # seed on top of whatever is there
//	make seed-reset    # remove previous seed data, then seed again
//
// It refuses to run against a production environment. That is not caution for
// its own sake: this command writes members, giving records and logins with a
// known password, and the failure mode of getting it wrong is a real church's
// ledger with fabricated tithes in it.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/church"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/logging"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/seed"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "seed: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		reset    = flag.Bool("reset", false, "remove data from a previous seed run first")
		only     = flag.Bool("reset-only", false, "remove seed data and stop")
		members  = flag.Int("members", 120, "members in the largest congregation")
		weeks    = flag.Int("weeks", 12, "weeks of giving history")
		password = flag.String("password", "AltarOS2026!", "password for every seeded login")
		seedNum  = flag.Int64("seed", 20260801, "random seed; the same value reproduces the same data")
		force    = flag.Bool("i-know-what-im-doing", false,
			"permit seeding a non-development environment")
		credentialsPath = flag.String("credentials", "credentials.txt",
			"where to write the seeded logins; empty to skip")
	)
	flag.Parse()

	cfg, err := config.Load("seed")
	if err != nil {
		return err
	}
	log := logging.New("seed", string(cfg.Env), "info")

	// The guard. Seeding writes fabricated giving records, and a church's
	// ledger is the last place anyone should discover invented data.
	if cfg.Env.RequiresRealSecrets() && !*force {
		return fmt.Errorf(
			"refusing to seed with APP_ENV=%s.\n"+
				"This writes members, giving records and logins with a known password.\n"+
				"If that is genuinely what you want, pass -i-know-what-im-doing",
			cfg.Env)
	}

	// A second guard on the database name, because APP_ENV is easy to get
	// right locally and easy to inherit wrongly from a shell that was once
	// pointed at staging.
	if looksProduction(cfg.Mongo.URI, cfg.Mongo.Database) && !*force {
		return fmt.Errorf(
			"refusing to seed %q at %s — the name or host looks like production",
			cfg.Mongo.Database, redactHost(cfg.Mongo.URI))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	db, err := mongodb.Connect(ctx, cfg.Mongo)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Close(closeCtx)
	}()

	seeder := seed.New(db, seed.Options{
		Password:         *password,
		MembersPerChurch: *members,
		WeeksOfGiving:    *weeks,
		Seed:             *seedNum,
		Log:              log,
	})

	if *reset || *only {
		log.Info("removing data from previous seed runs")
		if err := seeder.Reset(ctx); err != nil {
			return err
		}
		if *only {
			fmt.Println("\nSeed data removed. Nothing else was touched.")
			return nil
		}
	}

	started := time.Now()
	result, err := seeder.Run(ctx)
	if err != nil {
		return err
	}

	report(result, cfg.Mongo.Database, time.Since(started))

	if err := writeCredentials(*credentialsPath, result, cfg.Mongo.Database); err != nil {
		// Not fatal: the credentials are already on screen, and failing the
		// whole seed because a convenience file could not be written would be
		// disproportionate.
		log.Warn("could not write the credentials file",
			slog.String("path", *credentialsPath),
			slog.String("error", err.Error()))
	} else {
		fmt.Printf("  Also written to %s\n\n", *credentialsPath)
	}
	return nil
}

// writeCredentials records the seeded logins somewhere greppable.
//
// The file is gitignored. These are development accounts on a local database
// with a published password, so they are not secrets — but a file called
// credentials.txt is exactly where a real one eventually gets pasted, and the
// ignore rule is what stops that becoming a commit.
func writeCredentials(path string, r *seed.Result, database string) error {
	if path == "" {
		return nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "ALTAR OS — seeded development logins\n")
	fmt.Fprintf(&b, "Database: %s\n", database)
	fmt.Fprintf(&b, "Generated: %s\n\n", time.Now().Format(time.RFC3339))
	fmt.Fprintf(&b, "These are fixture accounts on a development database. They are not\n")
	fmt.Fprintf(&b, "secrets, and this file is gitignored so it cannot become one.\n")
	fmt.Fprintf(&b, "Rewritten by `make seed`.\n\n")
	fmt.Fprintf(&b, "Gateway: %s\n\n", gatewayURL())

	// Which app each account signs into, because the accounts are not
	// interchangeable and knowing the password does not tell you where to
	// type it. The platform operator in particular cannot sign into the church
	// dashboard in any useful way, and a church admin is refused by the admin
	// app outright — so a flat list of logins with one URL beside it sends
	// somebody to the wrong door.
	//
	// The ports are read from the environment rather than hard-coded. They were
	// hard-coded to 5173, which on a machine running more than one project is
	// somebody else's app — and the file then confidently points at it.
	fmt.Fprintf(&b, "APPS\n%s\n", strings.Repeat("-", 96))
	for _, app := range appURLs() {
		fmt.Fprintf(&b, "%-12s %-30s %s\n", app.name, app.url, app.who)
	}
	fmt.Fprintf(&b, "\n")

	if len(r.Logins) > 0 {
		fmt.Fprintf(&b, "PASSWORD (all accounts): %s\n\n", r.Logins[0].Password)
	}

	// The platform operator first and called out by name. It is the account
	// somebody looks for when the admin app refuses them, and burying it at the
	// bottom of an alphabetical list is how it gets missed.
	if ops := operatorLogin(r); ops != nil {
		fmt.Fprintf(&b, "PLATFORM OPERATOR — the only account the admin app accepts\n")
		fmt.Fprintf(&b, "%s\n", strings.Repeat("-", 96))
		fmt.Fprintf(&b, "%-42s  %-18s  %s\n\n", ops.Email, ops.Role, ops.Church)
	}

	fmt.Fprintf(&b, "CHURCH ACCOUNTS\n")
	fmt.Fprintf(&b, "%-42s  %-18s  %s\n", "EMAIL", "ROLE", "CHURCH")
	fmt.Fprintf(&b, "%s\n", strings.Repeat("-", 96))
	for _, l := range r.Logins {
		if l.Role == church.RoleSuperAdmin {
			continue
		}
		fmt.Fprintf(&b, "%-42s  %-18s  %s\n", l.Email, l.Role, l.Church)
	}

	fmt.Fprintf(&b, `
The SUPER_ADMIN is the platform operator — ALTAR OS staff, not a church.
It is the only role the admin app accepts, and the only one that may set
the commission rate and the provider rate card. It carries a church so
that its token names one; the role check requires that.

The ORG_ADMIN reads across every branch; a CHURCH_ADMIN sees one. That
difference is what VisibleChurchIDs decides, and it is only visible with
more than one branch seeded.

Quick check:

  curl -s -X POST http://localhost:8080/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"%s","password":"%s","method":"EMAIL"}'
`, firstEmail(r), firstPassword(r))

	return os.WriteFile(path, []byte(b.String()), 0o600)
}

// appEntry is one frontend and who signs into it.
type appEntry struct{ name, url, who string }

// appURLs reports where each app is expected to be.
//
// Overridable, because the defaults collide with whatever else is running on a
// developer's machine — Vite's 5173 is claimed by the first project started,
// and a credentials file that names it is pointing at a stranger's app.
func appURLs() []appEntry {
	return []appEntry{
		{"Dashboard", envOr("DASHBOARD_URL", "http://localhost:5173"),
			"church staff — CHURCH_ADMIN, DEPARTMENT_LEADER, MEMBER"},
		{"Admin", envOr("ADMIN_URL", "http://localhost:5176"),
			"platform operators — SUPER_ADMIN only"},
		{"Member web", envOr("MEMBER_WEB_URL", "http://localhost:5174"),
			"congregation — MEMBER"},
		{"Marketing", envOr("MARKETING_URL", "http://localhost:5175"),
			"public, no sign-in"},
	}
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func gatewayURL() string {
	return envOr("GATEWAY_URL", "http://localhost:8080/api/v1")
}

// operatorLogin finds the platform operator among the seeded accounts.
func operatorLogin(r *seed.Result) *seed.Login {
	for i := range r.Logins {
		if r.Logins[i].Role == church.RoleSuperAdmin {
			return &r.Logins[i]
		}
	}
	return nil
}

func firstEmail(r *seed.Result) string {
	if len(r.Logins) == 0 {
		return "pastor@grace-chapel.org"
	}
	return r.Logins[0].Email
}

func firstPassword(r *seed.Result) string {
	if len(r.Logins) == 0 {
		return ""
	}
	return r.Logins[0].Password
}

// looksProduction is a heuristic, and deliberately a broad one. A false
// positive costs someone a flag; a false negative costs a church its ledger.
func looksProduction(uri, database string) bool {
	haystack := strings.ToLower(uri + " " + database)
	for _, needle := range []string{"prod", "live", "mongodb+srv", "atlas"} {
		if strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}

// redactHost keeps credentials out of an error message that may be pasted into
// a ticket.
func redactHost(uri string) string {
	if at := strings.LastIndex(uri, "@"); at != -1 {
		if scheme := strings.Index(uri, "://"); scheme != -1 && scheme < at {
			return uri[:scheme+3] + "***@" + uri[at+1:]
		}
	}
	return uri
}

func report(r *seed.Result, database string, took time.Duration) {
	fmt.Printf(`
  Seeded %s in %s

    organizations  %d
    churches       %d
    users          %d
    members        %d
    consents       %d
    transactions   %d
    events         %d
    attendance     %d

  Sign in with any of these:

`, database, took.Round(time.Millisecond),
		r.Organizations, r.Churches, r.Users, r.Members, r.Consents, r.Transactions,
		r.Events, r.Attendance)

	fmt.Printf("    %-42s  %-18s  %s\n", "EMAIL", "ROLE", "CHURCH")
	fmt.Printf("    %-42s  %-18s  %s\n", strings.Repeat("─", 42),
		strings.Repeat("─", 18), strings.Repeat("─", 30))
	for _, l := range r.Logins {
		fmt.Printf("    %-42s  %-18s  %s\n", l.Email, l.Role, l.Church)
	}

	if len(r.Logins) > 0 {
		fmt.Printf("\n  Password for all of them: %s\n", r.Logins[0].Password)
	}
	fmt.Printf(`
  The org admin reads across every branch; a church admin sees one.
  That difference is what WP-11's VisibleChurchIDs decides, and it is
  only visible with more than one branch seeded.

  Re-running is additive. Use 'make seed-reset' to remove the previous
  run first — it deletes only documents this command created.

`)
}
