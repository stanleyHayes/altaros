import { createLatestRequestGate } from './latest-request';

describe('latest request gate', () => {
  it('allows only the newest overlapping read to commit', () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
  });

  it('invalidates an in-flight read when its screen loses ownership', () => {
    const gate = createLatestRequestGate();
    const request = gate.begin();
    gate.invalidate();

    expect(gate.isLatest(request)).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects malformed request ticket %s', (ticket) => {
    const gate = createLatestRequestGate();
    gate.begin();
    expect(gate.isLatest(ticket)).toBe(false);
  });
});
