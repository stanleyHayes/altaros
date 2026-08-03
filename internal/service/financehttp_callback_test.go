package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGivingCallbackURLAllowsOnlyTheFirstPartyHTTPSReturnBridge(t *testing.T) {
	for _, allowed := range []string{"", mobileGivingCallbackURL} {
		if !validGivingCallbackURL(allowed) {
			t.Fatalf("validGivingCallbackURL(%q) = false, want true", allowed)
		}
	}

	for _, rejected := range []string{
		"altaros://giving/complete",
		"http://altaros.com/giving/complete",
		"https://altaros.com/giving/complete/",
		"https://altaros.com/giving/complete?next=https://evil.example",
		"https://evil.example/giving/complete",
		" https://altaros.com/giving/complete",
	} {
		if validGivingCallbackURL(rejected) {
			t.Fatalf("validGivingCallbackURL(%q) = true, want false", rejected)
		}
	}
}

func TestStartGivingRejectsAnArbitraryCallbackBeforePaymentWork(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/finance/give", strings.NewReader(`{
		"type":"offering",
		"amount":"10.00",
		"currency":"GHS",
		"channel":"mobile_money",
		"callbackUrl":"https://evil.example/complete",
		"acceptedTotalMinor":1000
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleStartGiving(nil, nil, nil).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "payment return address") {
		t.Fatalf("body = %s, want callback validation error", rec.Body.String())
	}
}
