export interface PushRegistrationSyncGate {
  request(): Promise<boolean>;
  deactivate(): void;
}

export function createPushRegistrationSyncGate(
  sync: () => Promise<boolean>,
  ownsSession: () => boolean,
): PushRegistrationSyncGate {
  let active = true;
  let pending: Promise<boolean> | null = null;

  return {
    request() {
      if (!active || !ownsSession()) return Promise.resolve(false);
      if (pending) return pending;
      const attempt = Promise.resolve()
        .then(sync)
        .then((registered) => active && ownsSession() && registered)
        .finally(() => {
          if (pending === attempt) pending = null;
        });
      pending = attempt;
      return attempt;
    },
    deactivate() {
      active = false;
    },
  };
}
