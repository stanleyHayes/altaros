export interface SubmissionLock {
  acquire: () => boolean;
  release: () => void;
  isLocked: () => boolean;
}

export interface KeyedSubmissionLock {
  acquire: (key: string) => boolean;
  release: (key: string) => void;
  has: (key: string) => boolean;
}

/**
 * State updates disable buttons on the next React commit. This synchronous lock
 * closes the same-frame window in which two taps can start duplicate requests.
 */
export function createSubmissionLock(): SubmissionLock {
  let locked = false;
  return {
    acquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    isLocked() {
      return locked;
    },
  };
}

export function createKeyedSubmissionLock(): KeyedSubmissionLock {
  const lockedKeys = new Set<string>();
  return {
    acquire(key) {
      if (lockedKeys.has(key)) return false;
      lockedKeys.add(key);
      return true;
    },
    release(key) {
      lockedKeys.delete(key);
    },
    has(key) {
      return lockedKeys.has(key);
    },
  };
}
