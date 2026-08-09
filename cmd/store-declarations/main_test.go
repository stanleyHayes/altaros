package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hayfordstanley/altar-os/internal/domain/privacy"
)

// The four declarations — this generator, the iOS manifest in app.json, App
// Store Connect and the Play console — restate the same facts. These tests
// exist so a fifth category added to Holdings cannot silently leave three of
// them stale, which is how an app ends up telling two regulators different
// things about itself.

func TestEveryHoldingHasAPlayCategory(t *testing.T) {
	for _, h := range privacy.Holdings {
		if _, ok := playCategory[h.Collection]; !ok {
			t.Errorf("%q (%s) has no Play Data Safety category, so the generated "+
				"form would be incomplete and the console answer would be a guess",
				h.Label, h.Collection)
		}
	}
}

// The reverse: a mapping left behind after its holding was removed is a
// category declared to Google that the app no longer collects. Over-declaring
// is not harmless — it is a false statement in the other direction.
func TestNoPlayCategoryOutlivesItsHolding(t *testing.T) {
	live := map[string]bool{}
	for _, h := range privacy.Holdings {
		live[h.Collection] = true
	}
	for collection := range playCategory {
		if !live[collection] {
			t.Errorf("%q is mapped to a Play category but is no longer collected — "+
				"the form would declare data the app does not hold", collection)
		}
	}
}

// The iOS manifest is what App Review compares the binary against. If Holdings
// says money is collected, the manifest must say so too.
func TestTheIOSManifestCoversWhatHoldingsCollect(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "apps", "mobile", "app.json"))
	if err != nil {
		t.Skipf("app.json unreadable: %v", err)
	}
	var cfg struct {
		Expo struct {
			IOS struct {
				PrivacyManifests struct {
					NSPrivacyTracking           bool `json:"NSPrivacyTracking"`
					NSPrivacyCollectedDataTypes []struct {
						Type string `json:"NSPrivacyCollectedDataType"`
					} `json:"NSPrivacyCollectedDataTypes"`
				} `json:"privacyManifests"`
			} `json:"ios"`
		} `json:"expo"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("app.json is not valid JSON: %v", err)
	}

	declared := map[string]bool{}
	for _, d := range cfg.Expo.IOS.PrivacyManifests.NSPrivacyCollectedDataTypes {
		declared[strings.TrimPrefix(d.Type, "NSPrivacyCollectedDataType")] = true
	}
	if len(declared) == 0 {
		t.Fatal("the iOS manifest declares NO collected data types while the app " +
			"collects names, phone numbers and giving records — a false declaration")
	}

	// Each is a fact Holdings asserts, and the manifest key that must carry it.
	for _, want := range []struct{ collection, apple string }{
		{"transactions", "OtherFinancialInfo"},
		{"welfare_cases", "SensitiveInfo"},
		{"social_posts", "OtherUserContent"},
		{"notification_devices", "DeviceID"},
		{"members", "Name"},
		{"users", "EmailAddress"},
	} {
		var collected bool
		for _, h := range privacy.Holdings {
			if h.Collection == want.collection {
				collected = true
			}
		}
		if collected && !declared[want.apple] {
			t.Errorf("the app collects %q but the iOS manifest does not declare %q",
				want.collection, want.apple)
		}
	}

	// Tracking must stay false: there is no ad SDK, no analytics and no broker,
	// and declaring true would require an ATT prompt the app does not show.
	if cfg.Expo.IOS.PrivacyManifests.NSPrivacyTracking {
		t.Error("the manifest declares tracking, but the app has no tracking SDK " +
			"and shows no App Tracking Transparency prompt")
	}
}

// The generator must not emit an UNMAPPED marker into a document somebody
// fills a console form from.
func TestTheGeneratedDocumentHasNoPlaceholders(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "docs", "store-declarations.md"))
	if err != nil {
		t.Skip("declarations not generated yet")
	}
	if strings.Contains(string(raw), "UNMAPPED") {
		t.Error("docs/store-declarations.md contains UNMAPPED — regenerate it " +
			"with `go run ./cmd/store-declarations > docs/store-declarations.md`")
	}
}
