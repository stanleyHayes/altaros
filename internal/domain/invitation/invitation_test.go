package invitation

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/hayfordstanley/altar-os/internal/domain/auth"
	"github.com/hayfordstanley/altar-os/internal/domain/rbac"
	"github.com/hayfordstanley/altar-os/internal/platform/config"
	"github.com/hayfordstanley/altar-os/internal/platform/mongodb"
	"github.com/hayfordstanley/altar-os/internal/platform/tenancy"
	"github.com/hayfordstanley/altar-os/internal/platform/testsupport"
)

// Two churches, because several of these tests are about an invitation for one
// church not being redeemable into the other.
var (
	churchA = bson.NewObjectID().Hex()
	churchB = bson.NewObjectID().Hex()
)

type harness struct {
	svc   *Service
	roles *rbac.Service
	db    *mongodb.DB
	ctx   context.Context
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	connectCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := mongodb.Connect(connectCtx, config.MongoConfig{
		URI:            testsupport.MongoURI(),
		Database:       "altar_test_invitation",
		ConnectTimeout: 5 * time.Second,
	})
	if err != nil {
		testsupport.SkipOrFail(t, "MongoDB", err)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = db.Database().Drop(c)
		_ = db.Close(c)
	})

	svc := NewService(db)
	roles := rbac.NewService(db)

	ctx := adminOf(churchA)
	if err := svc.EnsureIndexes(ctx); err != nil {
		t.Fatalf("EnsureIndexes: %v", err)
	}
	// The uniqueness the auth flows depend on. Several tests here exercise the
	// duplicate-account path, which is the database's job rather than a check
	// the application performs — without these indexes those tests would pass
	// while the real system created two accounts.
	err = mongodb.EnsureIndexes(ctx, db.Global(auth.Collection), []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "email", Value: 1}},
			Options: options.Index().SetName("email_unique").SetUnique(true).SetSparse(true),
		},
		{
			Keys:    bson.D{{Key: "phone", Value: 1}},
			Options: options.Index().SetName("phone_unique").SetUnique(true).SetSparse(true),
		},
	})
	if err != nil {
		t.Fatalf("user indexes: %v", err)
	}

	for _, church := range []string{churchA, churchB} {
		if err := roles.EnsureSystemRoles(adminOf(church)); err != nil {
			t.Fatalf("EnsureSystemRoles(%s): %v", church, err)
		}
	}
	return &harness{svc: svc, roles: roles, db: db, ctx: ctx}
}

// adminOf builds a request scope for a church.
func adminOf(churchID string) context.Context {
	return tenancy.WithScope(context.Background(), tenancy.Scope{
		ChurchID: churchID,
		UserID:   bson.NewObjectID().Hex(),
		Role:     "CHURCH_ADMIN",
	})
}

// roleID resolves a system role in a church.
func (h *harness) roleID(t *testing.T, ctx context.Context, slug string) string {
	t.Helper()
	role, err := h.roles.RoleBySlug(ctx, slug)
	if err != nil {
		t.Fatalf("RoleBySlug(%s): %v", slug, err)
	}
	return role.ID.Hex()
}

// invite issues an invitation with full admin permissions.
func (h *harness) invite(t *testing.T, in InviteInput) (*Invitation, string) {
	t.Helper()
	if in.RoleID == "" {
		in.RoleID = h.roleID(t, h.ctx, rbac.SystemMember)
	}
	inv, token, err := h.svc.Invite(h.ctx, in, rbac.All())
	if err != nil {
		t.Fatalf("Invite: %v", err)
	}
	return inv, token
}

// stored reads an invitation straight out of the database, bypassing the
// service — several of these assertions are about what is AT REST.
func (h *harness) stored(t *testing.T, id bson.ObjectID) bson.M {
	t.Helper()
	var raw bson.M
	err := h.db.Global(Collection).FindOne(context.Background(), bson.M{"_id": id}).Decode(&raw)
	if err != nil {
		t.Fatalf("read stored invitation: %v", err)
	}
	return raw
}

// --- what is stored --------------------------------------------------------

func TestTheRawTokenIsNeverStored(t *testing.T) {
	h := newHarness(t)

	inv, token := h.invite(t, InviteInput{Email: "ama@example.org", Name: "Ama Owusu"})

	raw := h.stored(t, inv.ID)
	for field, value := range raw {
		s, ok := value.(string)
		if !ok {
			continue
		}
		if strings.Contains(s, token) {
			t.Fatalf("field %q holds the raw token; a database backup would be a set of working invitations", field)
		}
	}
	if raw["tokenHash"] == token {
		t.Fatal("tokenHash is the raw token")
	}
	if raw["tokenHash"] != hashToken(token) {
		t.Fatal("tokenHash is not the hash of the issued token")
	}
}

func TestTheInvitationCarriesTheRoleItWasIssuedWith(t *testing.T) {
	h := newHarness(t)

	staffRole := h.roleID(t, h.ctx, rbac.SystemStaff)
	inv, _ := h.invite(t, InviteInput{Email: "kofi@example.org", RoleID: staffRole})

	if inv.RoleID != staffRole {
		t.Fatalf("roleId = %q, want %q", inv.RoleID, staffRole)
	}
	if inv.RoleName == "" {
		t.Fatal("the role name should be denormalised onto the invitation for the acceptance page")
	}
}

// --- single use ------------------------------------------------------------

func TestAnInvitationCanOnlyBeAcceptedOnce(t *testing.T) {
	h := newHarness(t)

	_, token := h.invite(t, InviteInput{Email: "once@example.org", Name: "Yaw Mensah"})

	if _, err := h.svc.Accept(context.Background(), token, AcceptInput{Password: "correct horse"}); err != nil {
		t.Fatalf("first accept: %v", err)
	}

	_, err := h.svc.Accept(context.Background(), token, AcceptInput{Password: "correct horse"})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("second accept = %v, want ErrNotFound — a link that works twice is two accounts", err)
	}
}

// TestConcurrentAcceptsCreateExactlyOneAccount is the test that justifies
// claiming the invitation before creating the account.
//
// A forwarded link opened on two devices at once, or a double-submitted form,
// races several redemptions through. Two things have to hold afterwards, and
// they fail for different reasons:
//
//   - Exactly one account. The unique index on email is the backstop here, so
//     this half passes even without the claim.
//   - The invitation is SPENT. This half is what the claim actually buys. The
//     losers each fail to create an account and then release their claim — so
//     without the conditional update they release a claim that was never
//     theirs, rolling the winner's invitation back to pending and leaving a
//     working link to an account that already exists.
func TestConcurrentAcceptsCreateExactlyOneAccount(t *testing.T) {
	h := newHarness(t)

	_, token := h.invite(t, InviteInput{Email: "race@example.org", Name: "Efua Sarpong"})

	const attempts = 8
	var wg sync.WaitGroup
	results := make([]error, attempts)

	for i := range attempts {
		wg.Go(func() {
			_, results[i] = h.svc.Accept(context.Background(), token, AcceptInput{Password: "a-good-password"})
		})
	}
	wg.Wait()

	succeeded := 0
	for _, err := range results {
		if err == nil {
			succeeded++
			continue
		}
		if !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrAlreadyMember) {
			t.Fatalf("unexpected failure: %v", err)
		}
	}
	if succeeded != 1 {
		t.Fatalf("%d of %d concurrent accepts succeeded, want exactly 1", succeeded, attempts)
	}

	count, err := h.db.Global(auth.Collection).
		CountDocuments(context.Background(), bson.M{"email": "race@example.org"})
	if err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	if count != 1 {
		t.Fatalf("%d accounts created, want 1", count)
	}

	// The link must be dead afterwards, and the record must say so.
	if _, err := h.svc.Preview(context.Background(), token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("the link still works after being redeemed under a race: %v", err)
	}
	list, err := h.svc.List(h.ctx, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, inv := range list {
		if inv.Email == "race@example.org" && inv.Status != StatusAccepted {
			t.Fatalf("invitation status = %q after redemption, want %q — a losing "+
				"redemption released a claim that was not its own",
				inv.Status, StatusAccepted)
		}
	}
}

// --- dead links ------------------------------------------------------------

// TestEveryDeadLinkLooksTheSame keeps the redemption endpoint from becoming an
// oracle. Distinguishing "expired" from "revoked" from "never existed" tells an
// unauthenticated caller which invitations were issued.
func TestEveryDeadLinkLooksTheSame(t *testing.T) {
	h := newHarness(t)

	expiredInv, expiredToken := h.invite(t, InviteInput{Email: "expired@example.org"})
	_, revokedToken := h.invite(t, InviteInput{Email: "revoked@example.org"})
	_, usedToken := h.invite(t, InviteInput{Email: "used@example.org"})

	// Expire one by moving the clock past its lifetime.
	_, err := h.db.Global(Collection).UpdateOne(context.Background(),
		bson.M{"_id": expiredInv.ID},
		bson.M{"$set": bson.M{"expiresAt": time.Now().Add(-time.Hour)}})
	if err != nil {
		t.Fatalf("expire: %v", err)
	}

	revoked, err := h.svc.List(h.ctx, StatusPending)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, inv := range revoked {
		if inv.Email == "revoked@example.org" {
			if err := h.svc.Revoke(h.ctx, inv.ID.Hex()); err != nil {
				t.Fatalf("Revoke: %v", err)
			}
		}
	}

	if _, err := h.svc.Accept(context.Background(), usedToken, AcceptInput{
		Name: "Used Once", Password: "a-good-password",
	}); err != nil {
		t.Fatalf("accept: %v", err)
	}

	for name, token := range map[string]string{
		"expired":       expiredToken,
		"revoked":       revokedToken,
		"already used":  usedToken,
		"never existed": "this-token-was-never-issued",
	} {
		if _, err := h.svc.Preview(context.Background(), token); !errors.Is(err, ErrNotFound) {
			t.Errorf("Preview(%s) = %v, want ErrNotFound", name, err)
		}
		if _, err := h.svc.Accept(context.Background(), token, AcceptInput{
			Name: "Someone", Password: "a-good-password",
		}); !errors.Is(err, ErrNotFound) {
			t.Errorf("Accept(%s) = %v, want ErrNotFound", name, err)
		}
	}
}

// TestResendKillsTheOldLink is the property that makes "resend" a fix rather
// than an addition. An admin who resends because the link went to the wrong
// address needs the wrong address's copy to stop working.
func TestResendKillsTheOldLink(t *testing.T) {
	h := newHarness(t)

	inv, firstToken := h.invite(t, InviteInput{Email: "resend@example.org", Name: "Nana Adjei"})

	_, secondToken, err := h.svc.Resend(h.ctx, inv.ID.Hex())
	if err != nil {
		t.Fatalf("Resend: %v", err)
	}
	if secondToken == firstToken {
		t.Fatal("resend reissued the same token")
	}

	if _, err := h.svc.Preview(context.Background(), firstToken); !errors.Is(err, ErrNotFound) {
		t.Fatalf("the first token still works after a resend: %v", err)
	}
	if _, err := h.svc.Preview(context.Background(), secondToken); err != nil {
		t.Fatalf("the reissued token does not work: %v", err)
	}
}

func TestARevokedInvitationCannotBeResurrectedByResending(t *testing.T) {
	h := newHarness(t)

	inv, _ := h.invite(t, InviteInput{Email: "gone@example.org"})
	if err := h.svc.Revoke(h.ctx, inv.ID.Hex()); err != nil {
		t.Fatalf("Revoke: %v", err)
	}

	if _, _, err := h.svc.Resend(h.ctx, inv.ID.Hex()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Resend after revoke = %v, want ErrNotFound — otherwise revoke is a suggestion", err)
	}
}

// --- the church comes from the token ---------------------------------------

// TestTheChurchComesFromTheInvitation is the tenancy property.
//
// Redemption happens with NO tenant in context — the caller is not signed in
// and does not yet belong to anywhere. If the church were read from anything
// the caller sends, an invitation to a small church could be redeemed into a
// large one.
func TestTheChurchComesFromTheInvitation(t *testing.T) {
	h := newHarness(t)

	_, token := h.invite(t, InviteInput{Email: "scoped@example.org", Name: "Abena Boateng"})

	// No tenancy scope at all, which is exactly the real redemption path.
	user, err := h.svc.Accept(context.Background(), token, AcceptInput{Password: "a-good-password"})
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if user.ChurchID.String() != churchA {
		t.Fatalf("account landed in church %q, want %q", user.ChurchID, churchA)
	}
}

func TestAnInvitationIsNotVisibleToAnotherChurch(t *testing.T) {
	h := newHarness(t)

	inv, _ := h.invite(t, InviteInput{Email: "private@example.org"})

	other := adminOf(churchB)
	if _, err := h.svc.ByID(other, inv.ID.Hex()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another church can read the invitation: %v", err)
	}
	if err := h.svc.Revoke(other, inv.ID.Hex()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another church can revoke the invitation: %v", err)
	}

	list, err := h.svc.List(other, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("another church sees %d invitations, want 0", len(list))
	}
}

func TestARoleFromAnotherChurchCannotBeInvitedInto(t *testing.T) {
	h := newHarness(t)

	foreignAdmin := h.roleID(t, adminOf(churchB), rbac.SystemAdmin)

	_, _, err := h.svc.Invite(h.ctx, InviteInput{
		Email: "crosschurch@example.org", RoleID: foreignAdmin,
	}, rbac.All())
	if !errors.Is(err, rbac.ErrRoleNotFound) {
		t.Fatalf("Invite with another church's role = %v, want ErrRoleNotFound", err)
	}
}

// --- requirement 4: the role's permissions arrive with the account ----------

func TestAnAcceptedInvitationCarriesItsRolePermissions(t *testing.T) {
	h := newHarness(t)

	staff := h.roleID(t, h.ctx, rbac.SystemStaff)
	_, token := h.invite(t, InviteInput{
		Email: "staffer@example.org", Name: "Kwame Asante", RoleID: staff,
	})

	user, err := h.svc.Accept(context.Background(), token, AcceptInput{Password: "a-good-password"})
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}

	assignment, err := h.roles.AssignmentFor(h.ctx, user.ID.Hex())
	if err != nil {
		t.Fatalf("AssignmentFor: %v", err)
	}
	if assignment.RoleID != staff {
		t.Fatalf("role = %q, want the invited role %q", assignment.RoleID, staff)
	}
	if !assignment.Effective.Can(rbac.ResourceMember, rbac.ActionRead) {
		t.Fatalf("a staff account cannot read members; effective = %v", assignment.Effective.Strings())
	}
}

// TestInvitingIntoARoleYouDoNotHoldIsRefused closes escalation by proxy.
//
// Without it, an admin with only user:create invites an accomplice into the
// Administrator role and is handed back whatever they wanted — which makes
// user:create equivalent to full access.
func TestInvitingIntoARoleYouDoNotHoldIsRefused(t *testing.T) {
	h := newHarness(t)

	adminRole := h.roleID(t, h.ctx, rbac.SystemAdmin)

	// A caller who may create users and nothing else.
	callerHolds := rbac.NewSet(
		rbac.NewPermission(rbac.ResourceUser, rbac.ActionCreate),
		rbac.NewPermission(rbac.ResourceUser, rbac.ActionRead),
	)

	_, _, err := h.svc.Invite(h.ctx, InviteInput{
		Email: "accomplice@example.org", RoleID: adminRole,
	}, callerHolds)
	if !errors.Is(err, rbac.ErrEscalation) {
		t.Fatalf("Invite into Administrator = %v, want ErrEscalation", err)
	}

	// The same caller may still invite into a role they fully hold.
	memberRole := h.roleID(t, h.ctx, rbac.SystemMember)
	memberPermissions, err := h.roles.RoleByID(h.ctx, memberRole)
	if err != nil {
		t.Fatalf("RoleByID: %v", err)
	}
	for p := range memberPermissions.PermissionSet() {
		callerHolds.Add(p)
	}
	if _, _, err := h.svc.Invite(h.ctx, InviteInput{
		Email: "ordinary@example.org", RoleID: memberRole,
	}, callerHolds); err != nil {
		t.Fatalf("inviting into a role the caller fully holds was refused: %v", err)
	}
}

// --- duplicates ------------------------------------------------------------

func TestASecondLiveInvitationToTheSamePersonIsRefused(t *testing.T) {
	h := newHarness(t)

	h.invite(t, InviteInput{Email: "twice@example.org"})

	_, _, err := h.svc.Invite(h.ctx, InviteInput{
		Email: "twice@example.org", RoleID: h.roleID(t, h.ctx, rbac.SystemMember),
	}, rbac.All())
	if !errors.Is(err, ErrAlreadyInvited) {
		t.Fatalf("second invitation = %v, want ErrAlreadyInvited — two live links is two accounts", err)
	}
}

// TestPhoneOnlyInvitationsDoNotCollide is the compound-sparse-index trap.
//
// A compound SPARSE unique index on {churchId, email} only skips a document
// when every indexed field is missing, so two phone-only invitations both index
// as {church, null} and the second is rejected as a duplicate. The partial
// filter is what makes this pass.
func TestPhoneOnlyInvitationsDoNotCollide(t *testing.T) {
	h := newHarness(t)

	h.invite(t, InviteInput{Phone: "024 555 0101", Name: "First"})

	if _, _, err := h.svc.Invite(h.ctx, InviteInput{
		Phone: "024 555 0202", Name: "Second",
		RoleID: h.roleID(t, h.ctx, rbac.SystemMember),
	}, rbac.All()); err != nil {
		t.Fatalf("a second phone-only invitation was refused: %v", err)
	}
}

// TestAnAddressCanBeReInvitedAfterARevoke is the other half of the partial
// filter — the one keyed on status.
//
// Without it the unique index holds against every invitation ever issued, so an
// address revoked by mistake can never be invited again and the only fix is a
// hand-edit of the database.
func TestAnAddressCanBeReInvitedAfterARevoke(t *testing.T) {
	h := newHarness(t)

	inv, _ := h.invite(t, InviteInput{Email: "second-thoughts@example.org"})
	if err := h.svc.Revoke(h.ctx, inv.ID.Hex()); err != nil {
		t.Fatalf("Revoke: %v", err)
	}

	if _, _, err := h.svc.Invite(h.ctx, InviteInput{
		Email: "second-thoughts@example.org", RoleID: h.roleID(t, h.ctx, rbac.SystemMember),
	}, rbac.All()); err != nil {
		t.Fatalf("re-inviting a revoked address was refused: %v", err)
	}
}

func TestInvitingSomeoneWhoAlreadyHasAnAccountIsRefused(t *testing.T) {
	h := newHarness(t)

	_, token := h.invite(t, InviteInput{Email: "existing@example.org", Name: "Already Here"})
	if _, err := h.svc.Accept(context.Background(), token, AcceptInput{Password: "a-good-password"}); err != nil {
		t.Fatalf("Accept: %v", err)
	}

	_, _, err := h.svc.Invite(h.ctx, InviteInput{
		Email: "existing@example.org", RoleID: h.roleID(t, h.ctx, rbac.SystemMember),
	}, rbac.All())
	if !errors.Is(err, ErrAlreadyMember) {
		t.Fatalf("re-inviting an existing account = %v, want ErrAlreadyMember", err)
	}
}

// --- phone verification ----------------------------------------------------

// TestAnSMSInvitationProvesThePhone records the reasoning: following a link
// that arrived by SMS proves control of that number, and following one that
// arrived by email does not.
func TestAnSMSInvitationProvesThePhone(t *testing.T) {
	h := newHarness(t)

	_, smsToken := h.invite(t, InviteInput{Phone: "024 555 0303", Name: "By SMS"})
	bySMS, err := h.svc.Accept(context.Background(), smsToken, AcceptInput{Password: "a-good-password"})
	if err != nil {
		t.Fatalf("Accept (sms): %v", err)
	}
	if !bySMS.PhoneVerified {
		t.Error("a phone invitation redeemed with the invited number should mark the phone verified")
	}

	_, emailToken := h.invite(t, InviteInput{Email: "byemail@example.org", Name: "By Email"})
	byEmail, err := h.svc.Accept(context.Background(), emailToken, AcceptInput{
		Phone: "024 555 0404", Password: "a-good-password",
	})
	if err != nil {
		t.Fatalf("Accept (email): %v", err)
	}
	if byEmail.PhoneVerified {
		t.Error("an emailed invitation does not prove control of a phone number typed into the form")
	}
}

// --- direct creation (requirement 9) ---------------------------------------

func TestDirectlyCreatedUsersMustChangeTheirPassword(t *testing.T) {
	h := newHarness(t)

	user, err := h.svc.Create(h.ctx, CreateInput{
		Email:    "desk@example.org",
		Name:     "Desk Signup",
		RoleID:   h.roleID(t, h.ctx, rbac.SystemMember),
		Password: "set-by-the-admin",
	}, rbac.All())
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	var raw bson.M
	err = h.db.Global(auth.Collection).
		FindOne(context.Background(), bson.M{"_id": user.ID}).Decode(&raw)
	if err != nil {
		t.Fatalf("read created user: %v", err)
	}
	if raw["mustChangePassword"] != true {
		t.Fatal("an admin who sets someone's password knows a working credential for that account")
	}
	if raw["passwordHash"] == "set-by-the-admin" {
		t.Fatal("the password was stored in plaintext")
	}
}

func TestDirectCreationRefusesAnEscalation(t *testing.T) {
	h := newHarness(t)

	_, err := h.svc.Create(h.ctx, CreateInput{
		Email:    "backdoor@example.org",
		Name:     "Back Door",
		RoleID:   h.roleID(t, h.ctx, rbac.SystemAdmin),
		Password: "a-good-password",
	}, rbac.NewSet(rbac.NewPermission(rbac.ResourceUser, rbac.ActionCreate)))
	if !errors.Is(err, rbac.ErrEscalation) {
		t.Fatalf("Create into Administrator = %v, want ErrEscalation", err)
	}
}

// --- the acceptance page ---------------------------------------------------

func TestPreviewNamesTheChurchWithoutRevealingIt(t *testing.T) {
	h := newHarness(t)

	churchOID, _ := bson.ObjectIDFromHex(churchA)
	_, err := h.db.Global("churches").InsertOne(context.Background(), bson.M{
		"_id": churchOID, "name": "Grace Chapel International", "isActive": true,
	})
	if err != nil {
		t.Fatalf("seed church: %v", err)
	}

	_, token := h.invite(t, InviteInput{
		Email: "preview@example.org", Name: "Adwoa Nyarko",
		Message: "Looking forward to having you on the media team.",
	})

	preview, err := h.svc.Preview(context.Background(), token)
	if err != nil {
		t.Fatalf("Preview: %v", err)
	}
	if preview.ChurchName != "Grace Chapel International" {
		t.Errorf("churchName = %q; an unnamed invitation reads as phishing", preview.ChurchName)
	}
	if preview.Message == "" {
		t.Error("the inviter's note should reach the acceptance page")
	}
	if preview.Name != "Adwoa Nyarko" {
		t.Errorf("name = %q, want the invited name", preview.Name)
	}
}

// --- validation ------------------------------------------------------------

func TestAcceptRefusesAWeakPassword(t *testing.T) {
	h := newHarness(t)

	_, token := h.invite(t, InviteInput{Email: "weak@example.org", Name: "Short Password"})

	if _, err := h.svc.Accept(context.Background(), token, AcceptInput{Password: "short"}); !errors.Is(err, ErrPasswordWeak) {
		t.Fatalf("Accept with a 5-character password = %v, want ErrPasswordWeak", err)
	}

	// And the invitation survives the rejection — a failed attempt must not
	// burn the link.
	if _, err := h.svc.Preview(context.Background(), token); err != nil {
		t.Fatalf("a rejected password consumed the invitation: %v", err)
	}
}

func TestAnInvitationNeedsSomewhereToSendIt(t *testing.T) {
	h := newHarness(t)

	_, _, err := h.svc.Invite(h.ctx, InviteInput{
		Name: "Nowhere To Send", RoleID: h.roleID(t, h.ctx, rbac.SystemMember),
	}, rbac.All())
	if !errors.Is(err, ErrContactRequired) {
		t.Fatalf("Invite with neither email nor phone = %v, want ErrContactRequired", err)
	}
}

func TestAnInvitationNeedsARole(t *testing.T) {
	h := newHarness(t)

	_, _, err := h.svc.Invite(h.ctx, InviteInput{Email: "norole@example.org"}, rbac.All())
	if !errors.Is(err, ErrRoleRequired) {
		t.Fatalf("Invite without a role = %v, want ErrRoleRequired", err)
	}
}
