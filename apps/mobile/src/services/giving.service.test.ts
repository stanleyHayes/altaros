import { formatMoney } from './giving.service';

describe('giving money formatting', () => {
  it('formats integer minor units without losing pesewas', () => {
    expect(formatMoney(162575)).toContain('1,625.75');
  });

  it('formats zero in Ghana cedis', () => {
    expect(formatMoney(0)).toContain('0.00');
  });
});
