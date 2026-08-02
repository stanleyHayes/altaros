package service

import (
	"testing"
)

// A service can be registered in one place and forgotten in another, and the
// symptom is a 404 that no unit test sees — handler tests call the service
// directly, so they pass while every HTTP client fails. That has happened here
// once already, to the whole CMS.
//
// These tests hold the three lists to each other.

func TestEveryServiceWithRoutesIsRunnable(t *testing.T) {
	for name := range routeBuilders() {
		if _, err := Lookup(name); err != nil {
			t.Errorf("%q serves routes but is not in the registry, so "+
				"-service=%s cannot run it: %v", name, name, err)
		}
	}
}

func TestImplementedMatchesWhatTheGatewayMounts(t *testing.T) {
	mounted := map[string]bool{"gateway": true}
	for name := range routeBuilders() {
		mounted[name] = true
	}

	reported := map[string]bool{}
	for _, name := range Implemented() {
		reported[name] = true
	}

	for name := range mounted {
		if !reported[name] {
			t.Errorf("%q is mounted by the gateway but not reported as implemented", name)
		}
	}
	for name := range reported {
		if !mounted[name] {
			t.Errorf("%q is reported as implemented but the gateway mounts no routes for it",
				name)
		}
	}
}

func TestPlaceholdersDoNotClaimToBeImplemented(t *testing.T) {
	// A placeholder answers "not implemented" and serves no domain routes.
	// Reporting one as implemented tells an operator a work package has landed
	// when it has not, and the list is derived rather than hard-coded so
	// finishing a service updates it by construction.
	serving := routeBuilders()
	for _, name := range Implemented() {
		if name == "gateway" {
			continue
		}
		if _, ok := serving[name]; !ok {
			t.Errorf("%q claims to be implemented but serves no routes", name)
		}
	}
}

func TestImplementedServicesAreAllKnownNames(t *testing.T) {
	known := map[string]bool{}
	for _, name := range Names() {
		known[name] = true
	}
	for _, name := range Implemented() {
		if !known[name] {
			t.Errorf("%q is reported as implemented but is not a runnable service", name)
		}
	}
}
