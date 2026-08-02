// Command backfill-roles grants newly-introduced resources to system roles that
// already exist.
//
// A separate command with a dry run, for the same reason the index migration is
// one: it rewrites permissions across every church, and an operation like that
// should be asked for deliberately rather than happening on a pod restart.
//
//	go run ./cmd/backfill-roles          # report what would change
//	go run ./cmd/backfill-roles -apply   # do it
//
// See internal/domain/rbac/rolebackfill.go for the rule. In short: a permission
// is added only when the stored role holds NOTHING on that resource, so a
// church that narrowed a role keeps its narrowing.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
)

func main() {
	apply := flag.Bool("apply", false,
		"write the changes. Without this, only report what would happen.")
	flag.Parse()

	if err := run(*apply); err != nil {
		fmt.Fprintf(os.Stderr, "\nbackfill-roles: %v\n", err)
		os.Exit(1)
	}
}

func run(apply bool) error {
	cfg, err := config.Load("backfill-roles")
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

	fmt.Printf("database: %s\n\n", cfg.Mongo.Database)

	out, err := rbac.NewService(db).BackfillSystemRoles(ctx, apply)
	if err != nil {
		return err
	}

	keys := make([]string, 0, len(out.Added))
	for k := range out.Added {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Printf("  %-45s + %v\n", k, out.Added[k])
	}

	fmt.Printf("\nexamined %d system roles, %d need permissions\n",
		out.Examined, out.Changed)
	if out.Truncated {
		fmt.Println("the ceiling was reached — run again to continue")
	}
	if out.DryRun {
		if out.Changed > 0 {
			fmt.Println("\nnothing was written. Re-run with -apply to grant these.")
		}
		return nil
	}
	fmt.Println("written.")
	return nil
}
