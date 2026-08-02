const DEFAULT_MOTION_QUERY_TIMEOUT_MS = 250;

/**
 * Native accessibility discovery must never own application startup. Some
 * devices can reject or indefinitely delay this bridge call during launch, so
 * use the standard animation only after a short bounded wait. A later native
 * preference event can still update the mounted splash.
 */
export function resolveReducedMotion(
  readPreference: () => Promise<boolean>,
  timeoutMs = DEFAULT_MOTION_QUERY_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));

    Promise.resolve()
      .then(readPreference)
      .then((value) => finish(value === true))
      .catch(() => finish(false));
  });
}
