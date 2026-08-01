// Command migrate runs the WP-35 workspace-identity index migration.
//
// It is a separate command rather than a step in the service boot, and that is
// the whole point. Dropping a unique index is not idempotent in the way index
// CREATION is: it is a one-way change to a collection two writers share, and it
// must happen once, deliberately, with somebody watching — not on every pod
// restart, and not concurrently across three replicas coming up together.
//
//	make migrate-check   # report collisions, change nothing
//	make migrate         # drop the global uniqueness, if and only if it is safe
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

func main() {
	apply := flag.Bool("apply", false,
		"drop the global unique indexes. Without this, only report what would happen.")
	flag.Parse()

	if err := run(*apply); err != nil {
		fmt.Fprintf(os.Stderr, "\nmigrate: %v\n", err)
		os.Exit(1)
	}
}

func run(apply bool) error {
	cfg, err := config.Load("migrate")
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	db, err := mongodb.Connect(ctx, cfg.Mongo)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close(context.Background()) }()

	// A nil issuer, redis and SMS sender: this command only touches indexes and
	// runs aggregations, and constructing the real ones would make a migration
	// tool refuse to start over a missing SMS credential.
	svc := auth.NewService(db, nil, nil, nil)

	fmt.Printf("database: %s\n\n", cfg.Mongo.Database)

	fmt.Println("Checking for accounts the compound index would reject...")
	collisions, err := svc.PreflightWorkspaceMigration(ctx)
	if err != nil {
		return err
	}

	if len(collisions) > 0 {
		fmt.Printf("\n%d collision(s). Each is one address held more than once "+
			"inside a single church:\n\n", len(collisions))
		for _, c := range collisions {
			fmt.Printf("  %s\n", c)
		}
		fmt.Println("\nThese must be resolved before the migration can run — one of the two")
		fmt.Println("is a real person whose account is about to stop working, so which one")
		fmt.Println("survives is not a decision this tool can make.")
		return errors.New("preflight failed")
	}
	fmt.Println("  none — every address is unique within its church.")

	if !apply {
		fmt.Println("\nSafe to run. Re-run with -apply to drop the global unique indexes.")
		fmt.Println("Before doing so, confirm BOTH writers are deployed with scoped lookups:")
		fmt.Println("  - the Go services (this repo, WP-35)")
		fmt.Println("  - apps/api's Mongoose schema, which recreates email_1 on every boot")
		fmt.Println("    unless its `unique: true` has been removed")
		return nil
	}

	fmt.Println("\nDropping the global unique indexes...")
	dropped, err := svc.DropGlobalUniqueness(ctx)
	if err != nil {
		return err
	}
	if len(dropped) == 0 {
		fmt.Println("  nothing to drop — already migrated.")
	} else {
		fmt.Printf("  dropped: %s\n", strings.Join(dropped, ", "))
	}

	fmt.Println("\nDone. Identity is now unique per (church, address).")
	fmt.Println("If apps/api still declares `email: {unique: true}`, its next boot will")
	fmt.Println("recreate email_1 and undo this.")
	return nil
}
