import { resolveReducedMotion } from './splash-motion';

describe('splash motion preference', () => {
  afterEach(() => jest.useRealTimers());

  it('honors the OS preference when discovery succeeds', async () => {
    await expect(resolveReducedMotion(async () => true)).resolves.toBe(true);
    await expect(resolveReducedMotion(async () => false)).resolves.toBe(false);
  });

  it('falls back to standard motion when native discovery rejects', async () => {
    await expect(resolveReducedMotion(async () => {
      throw new Error('accessibility bridge unavailable');
    })).resolves.toBe(false);
  });

  it('cannot leave startup waiting on a native query that never settles', async () => {
    jest.useFakeTimers();
    const result = resolveReducedMotion(() => new Promise<boolean>(() => undefined), 250);
    await jest.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toBe(false);
  });
});
