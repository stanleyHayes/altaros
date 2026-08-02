import { envelopeTotal, unwrapApiData } from './api-envelope';

describe('shared API success envelope', () => {
  it('unwraps canonical Go data and preserves explicit legacy raw payloads', () => {
    expect(unwrapApiData({ success: true, data: { id: 'one' } }, 'invalid'))
      .toEqual({ id: 'one' });
    expect(unwrapApiData({ id: 'legacy' }, 'invalid')).toEqual({ id: 'legacy' });
    expect(unwrapApiData(['legacy'], 'invalid')).toEqual(['legacy']);
  });

  it('rejects unsuccessful or data-less envelope-shaped responses', () => {
    expect(() => unwrapApiData({ success: false, data: [] }, 'invalid list')).toThrow('invalid list');
    expect(() => unwrapApiData({ success: true }, 'invalid list')).toThrow('invalid list');
  });

  it('reads only an object pagination total', () => {
    expect(envelopeTotal({ pagination: { total: 12 } })).toBe(12);
    expect(envelopeTotal({ pagination: '12' })).toBeUndefined();
  });
});
