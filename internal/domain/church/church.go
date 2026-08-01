// Package church models the organisational hierarchy (WP-11).
//
// The original spec has a flat Church, which cannot represent how churches in
// this market are actually organised. Ghanaian and Nigerian churches are
// overwhelmingly branch networks: one denomination, one HQ, tens to hundreds
// of local assemblies, with reporting flowing up and policy flowing down.
// Asoriba — the incumbent — lists "branch integration and reporting" as a core
// feature, so this is table stakes rather than an enhancement.
//
//	Organization (denomination / HQ)
//	  └── Church (branch / local assembly)      <- churchId lives here
//	        └── Department (choir, youth, ushers, media)
//	              └── Group (cell, home fellowship)
//
// Retrofitting a tenancy tier after launch is among the most expensive changes
// a multi-tenant product can make, which is why this lands in Phase 1 rather
// than being deferred.
package church

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// Collections. Organizations and churches are global rather than
// tenant-scoped: a church IS the tenant, so it cannot be filtered by itself,
// and an organization spans tenants by definition.
const (
	CollectionOrganizations = "organizations"
	CollectionChurches      = "churches"
	CollectionDepartments   = "departments"
	CollectionGroups        = "groups"
)

// Roles, matching shared-types UserRole.
const (
	RoleSuperAdmin       = "SUPER_ADMIN"
	RoleOrgAdmin         = "ORG_ADMIN"
	RoleChurchAdmin      = "CHURCH_ADMIN"
	RoleDepartmentLeader = "DEPARTMENT_LEADER"
	RoleMember           = "MEMBER"
)

var (
	// ErrNotFound is returned when a church or organization does not exist.
	ErrNotFound = errors.New("church: not found")
	// ErrForbidden is returned when a caller may not act on a branch.
	ErrForbidden = errors.New("church: not permitted for this branch")
	// ErrCircularParent is returned when a branch would become its own
	// ancestor, which would make the hierarchy walk loop forever.
	ErrCircularParent = errors.New("church: a branch cannot be its own ancestor")
)

// Organization is a denomination or church network.
type Organization struct {
	ID      bson.ObjectID `bson:"_id,omitempty" json:"id"`
	Name    string        `bson:"name"          json:"name"`
	Slug    string        `bson:"slug"          json:"slug"`
	Country string        `bson:"country"       json:"country"`
	// DataRegion pins where this organization's personal data may live. Kept
	// per-organization because expansion markets have divergent regimes
	// (Ghana Act 843, Nigeria NDPA, Kenya DPA).
	DataRegion string    `bson:"dataRegion"    json:"dataRegion"`
	CreatedAt  time.Time `bson:"createdAt"     json:"createdAt"`
	UpdatedAt  time.Time `bson:"updatedAt"     json:"updatedAt"`
}

// Church is a branch, or a standalone church with no organization above it.
type Church struct {
	ID             bson.ObjectID `bson:"_id,omitempty"            json:"id"`
	OrganizationID mongodb.ID    `bson:"organizationId,omitempty" json:"organizationId,omitempty"`
	// ParentChurchID supports sub-branches (a regional office over local
	// assemblies). Empty for a top-level branch.
	ParentChurchID mongodb.ID `bson:"parentChurchId,omitempty" json:"parentChurchId,omitempty"`
	Name           string     `bson:"name"                     json:"name"`
	Slug           string     `bson:"slug"                     json:"slug"`
	Address        string     `bson:"address"                  json:"address"`
	City           string     `bson:"city"                     json:"city"`
	Country        string     `bson:"country"                  json:"country"`
	Phone          string     `bson:"phone"                    json:"phone"`
	Email          string     `bson:"email"                    json:"email"`
	Timezone       string     `bson:"timezone"                 json:"timezone"`
	Currency       string     `bson:"currency"                 json:"currency"`
	Plan           string     `bson:"plan"                     json:"plan"`
	// PayoutSubaccount is the Paystack/Flutterwave subaccount giving settles
	// into. Per ADR-002 funds go directly to the church; ALTAR OS never holds
	// them, which keeps it outside Act 987 payment-aggregation licensing.
	PayoutSubaccount string    `bson:"payoutSubaccountCode,omitempty" json:"payoutSubaccountCode,omitempty"`
	IsActive         bool      `bson:"isActive"                 json:"isActive"`
	CreatedAt        time.Time `bson:"createdAt"                json:"createdAt"`
	UpdatedAt        time.Time `bson:"updatedAt"                json:"updatedAt"`
}

// Department is a ministry within a branch (choir, youth, ushers, media).
type Department struct {
	ID        bson.ObjectID `bson:"_id,omitempty" json:"id"`
	ChurchID  mongodb.ID    `bson:"churchId"      json:"churchId"`
	Name      string        `bson:"name"          json:"name"`
	LeaderID  mongodb.ID    `bson:"leaderId,omitempty" json:"leaderId,omitempty"`
	CreatedAt time.Time     `bson:"createdAt"     json:"createdAt"`
	UpdatedAt time.Time     `bson:"updatedAt"     json:"updatedAt"`
}

// Group is a cell or home fellowship, usually inside a department.
type Group struct {
	ID           bson.ObjectID `bson:"_id,omitempty"        json:"id"`
	ChurchID     mongodb.ID    `bson:"churchId"             json:"churchId"`
	DepartmentID mongodb.ID    `bson:"departmentId,omitempty" json:"departmentId,omitempty"`
	Name         string        `bson:"name"                 json:"name"`
	LeaderID     mongodb.ID    `bson:"leaderId,omitempty"   json:"leaderId,omitempty"`
	CreatedAt    time.Time     `bson:"createdAt"            json:"createdAt"`
	UpdatedAt    time.Time     `bson:"updatedAt"            json:"updatedAt"`
}

// Service resolves the hierarchy and answers access questions about it.
type Service struct {
	orgs     *mongo.Collection
	churches *mongo.Collection
	depts    *mongodb.TenantCollection
	groups   *mongodb.TenantCollection
}

// NewService builds the church service.
func NewService(db *mongodb.DB) *Service {
	return &Service{
		orgs:     db.Global(CollectionOrganizations),
		churches: db.Global(CollectionChurches),
		depts:    db.Tenant(CollectionDepartments),
		groups:   db.Tenant(CollectionGroups),
	}
}

// EnsureIndexes creates the indexes the hierarchy walk depends on.
func (s *Service) EnsureIndexes(ctx context.Context) error {
	if _, err := s.orgs.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "slug", Value: 1}},
		Options: options.Index().SetName("org_slug_unique").SetUnique(true),
	}); err != nil {
		return fmt.Errorf("church: org indexes: %w", err)
	}

	_, err := s.churches.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			// Listing every branch under an organization is the core
			// org-admin query.
			Keys:    bson.D{{Key: "organizationId", Value: 1}, {Key: "name", Value: 1}},
			Options: options.Index().SetName("org_branches"),
		},
		{
			Keys:    bson.D{{Key: "parentChurchId", Value: 1}},
			Options: options.Index().SetName("sub_branches"),
		},
		{
			Keys:    bson.D{{Key: "slug", Value: 1}},
			Options: options.Index().SetName("church_slug_unique").SetUnique(true),
		},
	})
	if err != nil {
		return fmt.Errorf("church: church indexes: %w", err)
	}
	return nil
}

// ByID returns one church.
func (s *Service) ByID(ctx context.Context, id string) (*Church, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	var c Church
	if err := s.churches.FindOne(ctx, bson.M{"_id": oid}).Decode(&c); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("church: lookup: %w", err)
	}
	return &c, nil
}

// BranchesOf lists every church under an organization.
func (s *Service) BranchesOf(ctx context.Context, organizationID string) ([]Church, error) {
	oid, err := bson.ObjectIDFromHex(organizationID)
	if err != nil {
		return nil, ErrNotFound
	}
	cur, err := s.churches.Find(ctx,
		bson.M{"organizationId": oid},
		options.Find().SetSort(bson.D{{Key: "name", Value: 1}}),
	)
	if err != nil {
		return nil, fmt.Errorf("church: list branches: %w", err)
	}
	var out []Church
	if err := cur.All(ctx, &out); err != nil {
		return nil, fmt.Errorf("church: decode branches: %w", err)
	}
	return out, nil
}

// VisibleChurchIDs returns every church the caller may read.
//
// This is the function the whole hierarchy exists to provide: a Church Admin
// sees exactly one branch, an Org Admin sees every branch beneath their
// organization, and a Super Admin sees everything. Any query that spans
// branches must derive its filter from this rather than deciding for itself.
func (s *Service) VisibleChurchIDs(ctx context.Context) ([]string, error) {
	scope, err := tenancy.FromContext(ctx)
	if err != nil {
		return nil, err
	}

	switch scope.Role {
	case RoleSuperAdmin:
		// Platform staff: every church. Deliberately explicit — this is the
		// one role that escapes tenant scoping, and it should be greppable.
		cur, err := s.churches.Find(ctx, bson.M{}, options.Find().SetProjection(bson.M{"_id": 1}))
		if err != nil {
			return nil, fmt.Errorf("church: list all: %w", err)
		}
		return decodeIDs(ctx, cur)

	case RoleOrgAdmin:
		if scope.OrganizationID == "" {
			// An org admin with no organization can only be a bug. Fall back
			// to their own branch rather than to everything.
			return []string{scope.ChurchID}, nil
		}
		branches, err := s.BranchesOf(ctx, scope.OrganizationID)
		if err != nil {
			return nil, err
		}
		ids := make([]string, 0, len(branches))
		for _, b := range branches {
			ids = append(ids, b.ID.Hex())
		}
		if len(ids) == 0 {
			return []string{scope.ChurchID}, nil
		}
		return ids, nil

	default:
		// Church admins, department leaders and members: their branch only.
		return []string{scope.ChurchID}, nil
	}
}

// CanAccessChurch reports whether the caller may act on a specific branch.
func (s *Service) CanAccessChurch(ctx context.Context, churchID string) error {
	visible, err := s.VisibleChurchIDs(ctx)
	if err != nil {
		return err
	}
	for _, id := range visible {
		if id == churchID {
			return nil
		}
	}
	return ErrForbidden
}

// SetParent re-parents a branch, rejecting anything that would make it its own
// ancestor. Without this check the hierarchy walk would loop forever.
func (s *Service) SetParent(ctx context.Context, childID, parentID string) error {
	if childID == parentID {
		return ErrCircularParent
	}

	// Walk up from the proposed parent; if we meet the child, this would
	// create a cycle.
	seen := map[string]bool{}
	for cursor := parentID; cursor != ""; {
		if cursor == childID {
			return ErrCircularParent
		}
		if seen[cursor] {
			// Already-corrupt data: stop rather than spin.
			return ErrCircularParent
		}
		seen[cursor] = true

		parent, err := s.ByID(ctx, cursor)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				break
			}
			return err
		}
		cursor = parent.ParentChurchID.String()
	}

	childOID, err := bson.ObjectIDFromHex(childID)
	if err != nil {
		return ErrNotFound
	}
	parentOID, err := bson.ObjectIDFromHex(parentID)
	if err != nil {
		return ErrNotFound
	}

	_, err = s.churches.UpdateOne(ctx,
		bson.M{"_id": childOID},
		bson.M{"$set": bson.M{"parentChurchId": parentOID, "updatedAt": time.Now().UTC()}},
	)
	if err != nil {
		return fmt.Errorf("church: set parent: %w", err)
	}
	return nil
}

func decodeIDs(ctx context.Context, cur *mongo.Cursor) ([]string, error) {
	var docs []struct {
		ID bson.ObjectID `bson:"_id"`
	}
	if err := cur.All(ctx, &docs); err != nil {
		return nil, fmt.Errorf("church: decode ids: %w", err)
	}
	ids := make([]string, 0, len(docs))
	for _, d := range docs {
		ids = append(ids, d.ID.Hex())
	}
	return ids, nil
}
