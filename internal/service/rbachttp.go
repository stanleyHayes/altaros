package service

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/deps"
	"github.com/hayfordstanley/altar-os/internal/platform/httpx"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
)

// buildRBAC mounts role and permission management (WP-36).
func buildRBAC(d *deps.Deps) http.Handler { return standalone(rbacRoutes(d)) }

// rbacRoutes registers role management.
//
// Every route is guarded by a PERMISSION rather than a role name, which is what
// makes requirement 1 — "roles can be created by an admin with the right
// permissions" — expressible. A hard-coded role check could not express it,
// because the whole point is that a church defines its own roles.
func rbacRoutes(d *deps.Deps) routeSet {
	svc := rbac.NewService(d.Mongo)

	return func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(authenticated(d))
			r.Use(resolvePermissions(d))

			// The permission catalogue, for building a permission matrix.
			// Readable by anyone who may read roles: you cannot assign what
			// you cannot see the names of.
			r.With(requirePermission(rbac.ResourceRole, rbac.ActionRead)).
				Get("/permissions", handlePermissionCatalogue())

			// What the CALLER may do. Requirement 7's UI half reads this to
			// decide what to render — and it is deliberately about the caller
			// only, so it cannot be used to inspect anyone else.
			r.Get("/me/permissions", handleMyPermissions())

			r.Route("/roles", func(r chi.Router) {
				r.With(requirePermission(rbac.ResourceRole, rbac.ActionRead)).
					Get("/", handleListRoles(svc))
				r.With(requirePermission(rbac.ResourceRole, rbac.ActionRead)).
					Get("/{id}", handleGetRole(svc))
				r.With(requirePermission(rbac.ResourceRole, rbac.ActionCreate)).
					Post("/", handleCreateRole(svc))
				r.With(requirePermission(rbac.ResourceRole, rbac.ActionUpdate)).
					Put("/{id}", handleUpdateRole(svc))
				r.With(requirePermission(rbac.ResourceRole, rbac.ActionDelete)).
					Delete("/{id}", handleDeleteRole(svc))

				// Who holds this role with individual adjustments. The role
				// editor shows this before saving a removal, because under
				// ADR-008 taking a permission off a role does NOT take it from
				// someone granted it individually (Q-11).
				r.With(requirePermission(rbac.ResourceRole, rbac.ActionRead)).
					Get("/{id}/overridden-holders", handleOverriddenHolders(svc))
			})

			r.Route("/users/{userId}", func(r chi.Router) {
				r.With(requirePermission(rbac.ResourceUser, rbac.ActionRead)).
					Get("/permissions", handleUserPermissions(svc))
				r.With(requirePermission(rbac.ResourceUser, rbac.ActionUpdate)).
					Put("/role", handleAssignRole(svc))
				r.With(requirePermission(rbac.ResourceUser, rbac.ActionUpdate)).
					Put("/permissions", handleSetOverrides(svc))
				r.With(requirePermission(rbac.ResourceUser, rbac.ActionUpdate)).
					Delete("/permissions", handleClearOverrides(svc))
			})
		})
	}
}

// handlePermissionCatalogue lists every permission the platform defines,
// grouped so a UI can render a resource-by-action matrix without hard-coding
// the list and drifting from the server.
func handlePermissionCatalogue() http.HandlerFunc {
	type resourceEntry struct {
		Resource string   `json:"resource"`
		Actions  []string `json:"actions"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		out := make([]resourceEntry, 0, len(rbac.AllResources))
		for _, res := range rbac.AllResources {
			actions := make([]string, 0, len(rbac.AllActions))
			for _, a := range rbac.AllActions {
				actions = append(actions, string(a))
			}
			out = append(out, resourceEntry{Resource: string(res), Actions: actions})
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"resources": out,
			// Stated in the response so a client implements the rule rather
			// than discovering it from a rejected save.
			"rule": "a create, update or delete permission requires read on the same resource",
		})
	}
}

func handleMyPermissions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := callerScope(r)
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"userId":      scope.UserID,
			"churchId":    scope.ChurchID,
			"permissions": permissionsFrom(r.Context()).Strings(),
		})
	}
}

func handleListRoles(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roles, err := svc.Roles(r.Context())
		if err != nil {
			writeRBACError(w, err)
			return
		}
		if roles == nil {
			roles = []rbac.Role{}
		}
		httpx.JSON(w, http.StatusOK, roles)
	}
}

func handleGetRole(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role, err := svc.RoleByID(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeRBACError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, role)
	}
}

type roleBody struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

func handleCreateRole(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body roleBody
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		// The caller's own permissions are passed so the service can refuse an
		// escalation. Without it, anyone with role:create writes themselves an
		// all-permissions role and the model is decorative.
		role, err := svc.CreateRole(r.Context(), rbac.RoleInput{
			Name:        body.Name,
			Description: body.Description,
			Permissions: rbac.SetFromStrings(body.Permissions),
		}, permissionsFrom(r.Context()))
		if err != nil {
			writeRBACError(w, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, role)
	}
}

func handleUpdateRole(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body roleBody
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		role, err := svc.UpdateRole(r.Context(), chi.URLParam(r, "id"), rbac.RoleInput{
			Name:        body.Name,
			Description: body.Description,
			Permissions: rbac.SetFromStrings(body.Permissions),
		}, permissionsFrom(r.Context()))
		if err != nil {
			writeRBACError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, role)
	}
}

func handleDeleteRole(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.DeleteRole(r.Context(), chi.URLParam(r, "id")); err != nil {
			writeRBACError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

func handleOverriddenHolders(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		holders, err := svc.HoldersWithOverrides(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeRBACError(w, err)
			return
		}
		if holders == nil {
			holders = []string{}
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"userIds": holders,
			// Said plainly, because an admin who is not told this believes a
			// revocation worked when it did not.
			"note": "These people have individual permission adjustments. Changing " +
				"this role will not change their individual grants.",
		})
	}
}

func handleUserPermissions(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		assignment, err := svc.AssignmentFor(r.Context(), chi.URLParam(r, "userId"))
		if err != nil {
			writeRBACError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"userId":      assignment.UserID,
			"roleId":      assignment.RoleID,
			"roleName":    assignment.RoleName,
			"granted":     assignment.Overrides.Granted,
			"revoked":     assignment.Overrides.Revoked,
			"permissions": assignment.Effective.Strings(),
		})
	}
}

func handleAssignRole(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RoleID string `json:"roleId"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}
		if err := svc.AssignRole(r.Context(), chi.URLParam(r, "userId"), body.RoleID); err != nil {
			writeRBACError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"roleId": body.RoleID})
	}
}

func handleSetOverrides(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Granted []string `json:"granted"`
			Revoked []string `json:"revoked"`
		}
		if err := decode(r, &body); err != nil {
			httpx.Error(w, http.StatusBadRequest, "Malformed request body")
			return
		}

		err := svc.SetOverrides(r.Context(), chi.URLParam(r, "userId"),
			rbac.SetFromStrings(body.Granted),
			rbac.SetFromStrings(body.Revoked),
			permissionsFrom(r.Context()))
		if err != nil {
			writeRBACError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"updated": true})
	}
}

func handleClearOverrides(svc *rbac.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := svc.ClearOverrides(r.Context(), chi.URLParam(r, "userId")); err != nil {
			writeRBACError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"cleared": true})
	}
}

func writeRBACError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, rbac.ErrRoleNotFound):
		httpx.Error(w, http.StatusNotFound, "Role not found")

	case errors.Is(err, rbac.ErrUserNotFound):
		httpx.Error(w, http.StatusNotFound, "User not found")

	case errors.Is(err, rbac.ErrRoleNameTaken):
		httpx.Error(w, http.StatusConflict, "A role with that name already exists.")

	case errors.Is(err, rbac.ErrSystemRole):
		httpx.Error(w, http.StatusForbidden,
			"Built-in roles cannot be changed or deleted. Copy it and edit the copy.")

	case errors.Is(err, rbac.ErrRoleInUse):
		httpx.Error(w, http.StatusConflict,
			"That role is still assigned to people. Move them to another role first.")

	case errors.Is(err, rbac.ErrNameRequired):
		httpx.Error(w, http.StatusBadRequest, "A role name is required.")

	case errors.Is(err, rbac.ErrMissingRead):
		// The service names the missing permissions, and that detail is useful
		// to the admin rather than sensitive — it is about the request they
		// just made, not about anything they cannot see.
		httpx.Error(w, http.StatusBadRequest, err.Error())

	case errors.Is(err, rbac.ErrEscalation):
		httpx.Error(w, http.StatusForbidden,
			"You cannot grant a permission you do not hold yourself.")

	case errors.Is(err, tenancy.ErrNoTenant):
		httpx.Error(w, http.StatusUnauthorized, "Sign in to continue.")

	default:
		httpx.Error(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
	}
}
