import { createKeyedSubmissionLock, createSubmissionLock } from './submission-lock';

describe('submission lock', () => {
  it('rejects a second same-frame acquisition until released', () => {
    const lock = createSubmissionLock();

    expect(lock.acquire()).toBe(true);
    expect(lock.isLocked()).toBe(true);
    expect(lock.acquire()).toBe(false);

    lock.release();
    expect(lock.isLocked()).toBe(false);
    expect(lock.acquire()).toBe(true);
  });

  it('can be safely released more than once across cancel and dismiss paths', () => {
    const lock = createSubmissionLock();
    expect(lock.acquire()).toBe(true);
    lock.release();
    lock.release();
    expect(lock.acquire()).toBe(true);
  });

  it('locks repeated row actions independently by identifier', () => {
    const lock = createKeyedSubmissionLock();
    expect(lock.acquire('first')).toBe(true);
    expect(lock.acquire('first')).toBe(false);
    expect(lock.acquire('second')).toBe(true);
    expect(lock.has('first')).toBe(true);
    lock.release('first');
    expect(lock.acquire('first')).toBe(true);
  });
});
