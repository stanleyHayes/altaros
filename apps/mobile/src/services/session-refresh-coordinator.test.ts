import { coalesceSessionRefresh } from './session-refresh-coordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('session refresh flight ownership', () => {
  it('coalesces simultaneous 401 recovery only within one refresh-token family', async () => {
    const oldFlight = deferred<string>();
    const newFlight = deferred<string>();
    const rotateOld = jest.fn(() => oldFlight.promise);
    const rotateNew = jest.fn(() => newFlight.promise);

    const oldRequestA = coalesceSessionRefresh('family-old', rotateOld);
    const oldRequestB = coalesceSessionRefresh('family-old', rotateOld);
    const newRequest = coalesceSessionRefresh('family-new', rotateNew);

    expect(oldRequestA).toBe(oldRequestB);
    expect(newRequest).not.toBe(oldRequestA);
    expect(rotateOld).toHaveBeenCalledTimes(1);
    expect(rotateNew).toHaveBeenCalledTimes(1);

    newFlight.resolve('new-access');
    oldFlight.reject(new Error('old family rejected'));
    await expect(newRequest).resolves.toBe('new-access');
    await expect(oldRequestA).rejects.toThrow('old family rejected');
    await expect(oldRequestB).rejects.toThrow('old family rejected');
  });

  it('releases settled flights so a later 401 can perform a fresh rotation', async () => {
    const first = jest.fn().mockResolvedValue('access-one');
    await expect(coalesceSessionRefresh('family-retry', first)).resolves.toBe('access-one');
    await Promise.resolve();

    const second = jest.fn().mockResolvedValue('access-two');
    await expect(coalesceSessionRefresh('family-retry', second)).resolves.toBe('access-two');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
