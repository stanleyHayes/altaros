export interface LatestRequestGate {
  begin: () => number;
  isLatest: (ticket: number) => boolean;
  invalidate: () => void;
}

/**
 * Coordinates replace-style reads where only the newest response may own UI
 * state. Mutations use submission locks instead; this gate is for overlapping
 * focus reloads, refreshes, retries, and identity changes.
 */
export function createLatestRequestGate(): LatestRequestGate {
  let revision = 0;
  return {
    begin() {
      revision += 1;
      return revision;
    },
    isLatest(ticket) {
      return Number.isSafeInteger(ticket) && ticket > 0 && ticket === revision;
    },
    invalidate() {
      revision += 1;
    },
  };
}
