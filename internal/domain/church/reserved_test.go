package church

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// TestReservedSlugsMatchTheSharedList reads the TypeScript list and fails if
// the Go mirror has drifted.
//
// This test is the direct lesson of WP-35 (R-23): when two writers each keep
// their own copy of a rule about the same data, they drift, and the drift is
// silent until something is already wrong. There, a `unique: true` in a
// Mongoose schema quietly restored an index the Go services had dropped. Here,
// a slug reserved on one side and not the other means a church takes `api` from
// whichever surface forgot.
//
// Reading the real file rather than duplicating it a third time is the point.
func TestReservedSlugsMatchTheSharedList(t *testing.T) {
	path := filepath.Join("..", "..", "..",
		"packages", "shared-types", "src", "reserved-slugs.ts")

	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the shared list at %s: %v\n\n"+
			"If it moved, this test must follow it — the whole point is that the "+
			"two lists cannot drift apart unnoticed.", path, err)
	}

	// Everything between the array's braces, then every quoted string in it.
	// Deliberately crude: a TypeScript parser here would be a dependency, and
	// the file is a flat list of string literals by construction.
	block := regexp.MustCompile(`RESERVED_SLUGS:\s*readonly string\[\]\s*=\s*\[([\s\S]*?)\];`)
	match := block.FindSubmatch(source)
	if match == nil {
		t.Fatal("could not find RESERVED_SLUGS in the shared list; if its shape " +
			"changed, update this test rather than deleting it")
	}

	quoted := regexp.MustCompile(`"([^"]+)"`)
	var shared []string
	for _, m := range quoted.FindAllSubmatch(match[1], -1) {
		shared = append(shared, string(m[1]))
	}
	if len(shared) == 0 {
		t.Fatal("parsed the shared list and found no entries")
	}

	mine := ReservedSlugs()
	sort.Strings(mine)
	sort.Strings(shared)

	inGo := map[string]bool{}
	for _, s := range mine {
		inGo[s] = true
	}
	inTS := map[string]bool{}
	for _, s := range shared {
		inTS[s] = true
	}

	var missingFromGo, missingFromTS []string
	for _, s := range shared {
		if !inGo[s] {
			missingFromGo = append(missingFromGo, s)
		}
	}
	for _, s := range mine {
		if !inTS[s] {
			missingFromTS = append(missingFromTS, s)
		}
	}

	if len(missingFromGo) > 0 {
		t.Errorf("reserved in TypeScript but not in Go: %s\n"+
			"A church could take these through the Go services.",
			strings.Join(missingFromGo, ", "))
	}
	if len(missingFromTS) > 0 {
		t.Errorf("reserved in Go but not in TypeScript: %s\n"+
			"A church could take these through the legacy API.",
			strings.Join(missingFromTS, ", "))
	}
}

// TestTheAcceptanceCriterion — "a church cannot be created with the slug api".
func TestAChurchCannotTakeAPlatformSubdomain(t *testing.T) {
	for _, slug := range []string{"api", "www", "admin", "app", "postmaster", "cdn"} {
		if err := ValidateSlug(slug); !errors.Is(err, ErrSlugReserved) {
			t.Errorf("ValidateSlug(%q) = %v, want ErrSlugReserved", slug, err)
		}
	}
}

// DNS is case-insensitive, so reserving `api` while allowing `API` reserves
// nothing — the two resolve to the same host.
func TestReservationIsCaseAndWhitespaceInsensitive(t *testing.T) {
	for _, slug := range []string{"API", "Api", "  api  ", "aPi"} {
		if !IsReservedSlug(slug) {
			t.Errorf("IsReservedSlug(%q) = false; DNS would resolve it to the same host as api", slug)
		}
	}
}

func TestARealChurchNameIsAccepted(t *testing.T) {
	// Including one that CONTAINS a reserved word — only the whole label is
	// reserved, or "Apostolic" and "Living Word Assembly" become unusable.
	for _, slug := range []string{
		"grace-chapel",
		"living-word-assembly",
		"apostolic-prayer-international",
		"api-ministries", // contains "api" but is not "api"
		"calvary1",
	} {
		if err := ValidateSlug(slug); err != nil {
			t.Errorf("ValidateSlug(%q) = %v, want nil", slug, err)
		}
	}
}

func TestASlugMustBeAUsableSubdomain(t *testing.T) {
	cases := map[string]string{
		"ab":                      "too short",
		"-grace":                  "leading hyphen",
		"grace-":                  "trailing hyphen",
		"grace chapel":            "space",
		"grace_chapel":            "underscore is not a DNS label character",
		"grace.chapel":            "a dot would make it two labels",
		"Grace-Chapel-With-Caps!": "punctuation",
		strings.Repeat("a", 64):   "longer than a DNS label allows",
	}
	for slug, why := range cases {
		if err := ValidateSlug(slug); !errors.Is(err, ErrSlugInvalid) {
			t.Errorf("ValidateSlug(%q) = %v, want ErrSlugInvalid (%s)", slug, err, why)
		}
	}
}
