import { tapFailureFor, tapMessageFor, type TapFailure } from './quick-give.service';

/**
 * A failed gift during a service is a moment that recovers or does not.
 *
 * Each of these statuses is a different instruction to the person holding the
 * phone. Collapsing them into "that did not work" is how a member who simply
 * needed to save a card gives up on the feature entirely.
 */

describe('tapFailureFor', () => {
  it('maps each server status to a distinct cause', () => {
    const cases: [number, TapFailure][] = [
      [428, 'no-method'],
      [422, 'above-limit'],
      [429, 'duplicate'],
      [412, 'not-reusable'],
      [402, 'declined'],
      [503, 'unavailable'],
    ];
    for (const [status, reason] of cases) {
      expect(tapFailureFor(status)).toBe(reason);
    }
  });

  it('falls back to unknown rather than guessing', () => {
    expect(tapFailureFor(500)).toBe('unknown');
    expect(tapFailureFor(undefined)).toBe('unknown');
  });
});

describe('tapMessageFor', () => {
  it('gives every cause its own words', () => {
    const reasons: TapFailure[] = [
      'no-method',
      'above-limit',
      'duplicate',
      'not-reusable',
      'declined',
      'unavailable',
      'unknown',
    ];
    const messages = reasons.map(tapMessageFor);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  /**
   * A duplicate is not a failure the giver caused: they pressed twice and the
   * second press was absorbed. The message has to say the gift LANDED, or the
   * member presses a third time.
   */
  it('tells someone their duplicate tap was still counted once', () => {
    expect(tapMessageFor('duplicate')).toMatch(/only counted once/i);
  });

  /**
   * Nothing was charged on a decline, and saying so is the difference between
   * a member checking their balance in a panic and one simply trying again.
   */
  it('says nothing was charged when the bank declined', () => {
    expect(tapMessageFor('declined')).toMatch(/nothing has been charged/i);
  });

  /** The fix for having no saved method is an action, so the message names it. */
  it('tells someone with no saved method what to do about it', () => {
    expect(tapMessageFor('no-method')).toMatch(/save your details/i);
  });
});
