import { createPushRegistrationSyncGate } from './push-registration-sync';

describe('push registration lifecycle gate', () => {
  it('coalesces startup, reconnect, and foreground requests', async () => {
    let resolve!: (value: boolean) => void;
    const sync = jest.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const gate = createPushRegistrationSyncGate(sync, () => true);

    const startup = gate.request();
    const reconnect = gate.request();
    const foreground = gate.request();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(1);

    resolve(true);
    await expect(Promise.all([startup, reconnect, foreground])).resolves.toEqual([true, true, true]);
  });

  it('allows a later reconnect retry after a failed attempt settles', async () => {
    const sync = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(true);
    const gate = createPushRegistrationSyncGate(sync, () => true);

    await expect(gate.request()).rejects.toThrow('offline');
    await expect(gate.request()).resolves.toBe(true);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('rejects late success and future retries after session replacement', async () => {
    let ownsSession = true;
    let resolve!: (value: boolean) => void;
    const sync = jest.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const gate = createPushRegistrationSyncGate(sync, () => ownsSession);

    const pending = gate.request();
    await Promise.resolve();
    ownsSession = false;
    gate.deactivate();
    resolve(true);

    await expect(pending).resolves.toBe(false);
    await expect(gate.request()).resolves.toBe(false);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
