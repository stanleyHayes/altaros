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
	"os"
	"strings"
	"time"

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
	return nil
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

  Sign in with any of these:

`, database, took.Round(time.Millisecond),
		r.Organizations, r.Churches, r.Users, r.Members, r.Consents, r.Transactions)

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
