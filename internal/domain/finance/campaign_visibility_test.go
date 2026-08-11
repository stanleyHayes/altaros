package finance

import "testing"

// Who can see a campaign is a question about a church's plans becoming public,
// so these test the rules directly rather than through a query. No database:
// the defect this guards against is a wrong predicate, not a wrong fetch.

// Draft is the ZERO VALUE, and that is the whole safety property. A campaign
// written by an older client that has never heard of this field must stay
// private rather than be published by omission.
func TestTheDefaultIsPrivate(t *testing.T) {
	var unset Visibility
	if unset != VisibilityDraft {
		t.Fatalf("the zero visibility is %q, not draft", unset)
	}
	if unset.VisibleToMembers() {
		t.Error("a campaign nobody published is visible to members")
	}
	if unset.VisibleToPublic() {
		t.Error("a campaign nobody published is on the public internet")
	}

	// And a whole Campaign built with no visibility set behaves the same.
	var c Campaign
	if c.Visibility.VisibleToPublic() || c.Visibility.VisibleToMembers() {
		t.Error("a zero-valued campaign is visible to somebody")
	}
	if c.ListedInDirectory {
		t.Error("a zero-valued campaign is listed on the marketing site")
	}
	if c.ShowProgress {
		t.Error("a zero-valued campaign reveals how little it has raised")
	}
}

// Members-only must NOT reach the public site. This is the pairing most likely
// to be got wrong, because "published" reads as one idea and is two.
func TestMembersOnlyIsNotPublic(t *testing.T) {
	if !VisibilityMembers.VisibleToMembers() {
		t.Error("a members campaign is hidden from members")
	}
	if VisibilityMembers.VisibleToPublic() {
		t.Fatal("a members-only appeal is served to the public internet")
	}
}

// Public implies members: somebody who attends the church should not have to
// sign out to see an appeal the whole world can read.
func TestPublicIsAlsoVisibleToMembers(t *testing.T) {
	if !VisibilityPublic.VisibleToMembers() {
		t.Error("a public appeal is hidden from the congregation")
	}
	if !VisibilityPublic.VisibleToPublic() {
		t.Error("a public appeal is not public")
	}
}

func TestOnlyKnownAudiencesAreAccepted(t *testing.T) {
	for _, ok := range []Visibility{VisibilityDraft, VisibilityMembers, VisibilityPublic} {
		if !ok.Valid() {
			t.Errorf("%q is rejected", ok)
		}
	}
	for _, bad := range []Visibility{"published", "PUBLIC", "everyone", "world", " public"} {
		if Visibility(bad).Valid() {
			t.Errorf("%q was accepted; an unrecognised audience must not fall "+
				"through to a permissive default", bad)
		}
	}
}

// Publishing to your own church's website and appearing on a software
// company's marketing site are different consents. Nothing in the type should
// let one imply the other.
func TestDirectoryListingIsNotImpliedByBeingPublic(t *testing.T) {
	c := Campaign{Visibility: VisibilityPublic}
	if c.ListedInDirectory {
		t.Fatal("making an appeal public also listed it on the ALTAR OS " +
			"marketing site — that is a separate decision about the church's " +
			"public identity and must be asked for explicitly")
	}
}
