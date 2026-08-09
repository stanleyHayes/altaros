package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"golang.org/x/crypto/bcrypt"
)

// Password reset.
//
// Its absence was a production blocker rather than a missing nicety: the
// dashboard's login screen has always linked to /forgot-password, and there
// was no page, no route and no endpoint behind it. Anyone who forgot their
// password was locked out permanently with a 404 for an explanation.
//
// # Why the code goes to the PHONE and not the email
//
// OTP is already the primary login method for this market — see the note on
// otp.go — because a Ghanaian congregation is reachable by phone far more
// reliably than by email, and many members have no email at all. A reset that
// depends on email would be unusable by the people most likely to need it, and
// would add a second delivery path to keep working when one already exists and
// is tested.
//
// # Three properties that matter more than the flow
//
//   - **No account enumeration.** Requesting a reset returns the same answer
//     whether or not the account exists. A form that says "no account with
//     that number" is a tool for discovering who attends a church, which in
//     some congregations is genuinely dangerous information.
//   - **Every session dies.** Resetting a password is what somebody does when
//     they believe it is compromised. Leaving existing refresh tokens alive
//     would mean the attacker keeps the access the reset was meant to remove.
//   - **The code is single-use and rate-limited**, which it already is: this
//     reuses the OTP store rather than inventing a second challenge with its
//     own bugs.

var (
	// ErrResetCodeInvalid means the code was wrong, expired, or already used.
	//
	// One error for all three on purpose. Distinguishing "expired" from
	// "wrong" tells somebody testing codes which guesses were close.
	ErrResetCodeInvalid = errors.New("auth: that code is not valid")
	// ErrPasswordTooWeak means the new password fails the same rule as
	// registration.
	ErrPasswordTooWeak = errors.New("auth: password must be 8 to 72 characters")
	// ErrSamePassword means the new password equals the old one.
	ErrSamePassword = errors.New("auth: choose a password you have not used here before")
)

// RequestPasswordReset sends a reset code to a registered phone.
//
// Returns nil whether or not the account exists — see the note above on
// enumeration. The caller must not vary its response either.
func (s *Service) RequestPasswordReset(ctx context.Context, workspace, phone string) error {
	churchID, err := s.workspaceForOTP(ctx, workspace)
	if err != nil {
		// An unknown workspace is indistinguishable from an unknown phone, and
		// both are indistinguishable from success.
		return nil
	}
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return nil
	}

	user, err := s.findOneCredential(ctx, "phone", phone, churchID)
	if err != nil || user == nil {
		return nil
	}
	if !user.IsActive {
		// A deactivated account must not be resettable back into use.
		return nil
	}

	code, err := s.otp.issue(ctx, churchID, phone)
	if err != nil {
		// A throttled resend is not an error the caller should be able to
		// observe either — it would reveal that the number is registered.
		return nil
	}

	if s.sms != nil {
		_ = s.sms.Send(ctx, phone, fmt.Sprintf(
			"%s is your ALTAR OS password reset code. It expires in 5 minutes. "+
				"If you did not ask for this, ignore this message.", code))
	}
	return nil
}

// ResetPassword verifies a code and sets a new password.
//
// On success every existing session is invalidated, because the reason people
// reset a password is that they think somebody else has it.
func (s *Service) ResetPassword(ctx context.Context, workspace, phone, code, newPassword string) error {
	if len(newPassword) < 8 || len(newPassword) > 72 {
		return ErrPasswordTooWeak
	}
	churchID, err := s.workspaceForOTP(ctx, workspace)
	if err != nil {
		return ErrResetCodeInvalid
	}
	phone = strings.TrimSpace(phone)

	// Verify FIRST. Looking the user up before checking the code would let an
	// attacker time the difference between a known and an unknown number.
	if err := s.otp.verify(ctx, churchID, phone, code); err != nil {
		return ErrResetCodeInvalid
	}

	user, err := s.findOneCredential(ctx, "phone", phone, churchID)
	if err != nil || user == nil || !user.IsActive {
		return ErrResetCodeInvalid
	}

	// Reusing the current password is not a reset. Checked after the code is
	// verified so it cannot be used as an oracle.
	if user.PasswordHash != "" &&
		bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(newPassword)) == nil {
		return ErrSamePassword
	}

	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	if _, err := s.users.UpdateOne(ctx,
		bson.M{"_id": user.ID},
		bson.M{"$set": bson.M{"passwordHash": hash, "updatedAt": now}},
	); err != nil {
		return fmt.Errorf("auth: set password: %w", err)
	}

	// Every existing session dies. This is the half that makes a reset
	// meaningful: somebody resets because they believe another person has
	// their password, and leaving that person's tokens alive would preserve
	// exactly the access the reset was meant to remove.
	//
	// Best-effort by design. The password IS already changed at this point, so
	// failing the whole request here would tell the user the reset did not
	// work when it did — and they would be unable to sign in with either
	// password. Logged loudly instead of swallowed silently.
	if s.tokens != nil {
		if err := s.tokens.RevokeAllForUser(ctx, user.ID.Hex(), 31*24*time.Hour); err != nil {
			return fmt.Errorf("auth: password changed but sessions survive: %w", err)
		}
	}

	// The code is single-use: consumed on success so it cannot be replayed.
	s.otp.clear(ctx, churchID, phone)
	return nil
}
