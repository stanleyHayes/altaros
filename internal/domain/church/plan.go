package church

import "strings"

// Plans and what they entitle a church to (Q-12, answered 1 Aug 2026).
//
// # Why entitlements are a table rather than checks scattered at call sites
//
// "Is this church on a paid plan?" appears wherever a paid capability is
// guarded, and written inline it becomes a different expression each time —
// `plan != "free"` in one place, `plan == "pro" || plan == "enterprise"` in
// another. The second is what happens when somebody adds a tier and updates
// four of the five checks. One table, one question.
//
// # What is gated, and what deliberately is not
//
// CUSTOM DOMAINS are paid-tier only, and that is the answer to Q-12. The
// reason is cost rather than packaging: every customer domain is its own
// registered domain and needs its own certificate, so it carries a per-tenant
// operational cost that grows with customer count (§13.2). The wildcard
// subdomain every church gets carries none.
//
// THE CMS IS NOT GATED. A free church still gets `grace-chapel.altaros.com`
// and can build its site there. That is a deliberate reading of the decision:
// the question asked was about custom domains, and withdrawing an already-built
// capability from churches who have it is a larger change than the answer
// called for. It is one line here if that is wrong — see FeatureCMS.

// Plan is a church's subscription tier.
type Plan string

const (
	PlanFree       Plan = "free"
	PlanBasic      Plan = "basic"
	PlanPro        Plan = "pro"
	PlanEnterprise Plan = "enterprise"
)

// AllPlans is every tier, cheapest first.
var AllPlans = []Plan{PlanFree, PlanBasic, PlanPro, PlanEnterprise}

// NormalisePlan reads a stored plan value.
//
// An unrecognised value becomes FREE, and that direction matters: a church row
// carrying a typo, a plan name from an older billing model, or an empty field
// must not be handed paid capabilities by accident. Failing to the cheapest
// tier means a billing data problem shows up as a church asking why a feature
// is missing, rather than as unbilled certificate issuance nobody notices.
func NormalisePlan(raw string) Plan {
	switch Plan(strings.ToLower(strings.TrimSpace(raw))) {
	case PlanBasic:
		return PlanBasic
	case PlanPro:
		return PlanPro
	case PlanEnterprise:
		return PlanEnterprise
	default:
		return PlanFree
	}
}

// Feature is a capability a plan may or may not include.
type Feature string

const (
	// FeatureCustomDomain lets a church serve its site from its own domain
	// rather than from its altaros.com subdomain. Paid tiers only (Q-12): each
	// customer domain needs its own certificate, which is the one per-tenant
	// operational cost that grows with customer count.
	FeatureCustomDomain Feature = "custom_domain"

	// FeatureCMS is the website editor. Currently in EVERY plan, including
	// free — see the package comment. If the intent was that only paying
	// churches get a website at all, remove PlanFree from its row below and
	// nothing else changes.
	FeatureCMS Feature = "cms"
)

// entitlements maps each feature to the plans that include it.
//
// Written feature-first rather than plan-first because the question the code
// asks is always "who gets this feature", and a plan-first table answers a
// question nobody asks and has to be read four times to answer this one.
var entitlements = map[Feature][]Plan{
	FeatureCustomDomain: {PlanBasic, PlanPro, PlanEnterprise},
	FeatureCMS:          {PlanFree, PlanBasic, PlanPro, PlanEnterprise},
}

// Includes reports whether a plan entitles a church to a feature.
func (p Plan) Includes(feature Feature) bool {
	for _, allowed := range entitlements[feature] {
		if allowed == p {
			return true
		}
	}
	return false
}

// Entitled reports whether a church may use a feature.
//
// Both conditions, and the second is easy to forget: a DEACTIVATED church on a
// paid plan is not entitled to anything. Without that, a church that stops
// paying keeps its custom domain resolving — which means the platform keeps
// renewing a certificate for a customer it no longer has.
func (c *Church) Entitled(feature Feature) bool {
	if c == nil || !c.IsActive {
		return false
	}
	return NormalisePlan(c.Plan).Includes(feature)
}

// PlansIncluding lists the plans that include a feature, for telling a church
// what it would need to upgrade to.
func PlansIncluding(feature Feature) []Plan {
	out := make([]Plan, 0, len(entitlements[feature]))
	out = append(out, entitlements[feature]...)
	return out
}
