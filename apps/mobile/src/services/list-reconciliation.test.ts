import {
  insertUniqueById,
  reconcileIncrementCount,
  reconcileToggleCount,
  rollbackOptimisticToggle,
} from './list-reconciliation';

describe('refreshed-list mutation reconciliation', () => {
  it('does not insert a mutation result already returned by a newer refresh', () => {
    const item = { id: 'item-1', value: 'fresh' };
    const current = [item];
    expect(insertUniqueById(current, { id: 'item-1', value: 'mutation' }, 'start')).toBe(current);
    expect(insertUniqueById([], item, 'end')).toEqual([item]);
  });

  it('changes a toggle count only when refreshed state has not already reached the target', () => {
    expect(reconcileToggleCount({ selected: false, count: 4 }, true)).toEqual({ selected: true, count: 5 });
    expect(reconcileToggleCount({ selected: true, count: 5 }, true)).toEqual({ selected: true, count: 5 });
    expect(reconcileToggleCount({ selected: true, count: 5 }, false, 3)).toEqual({ selected: false, count: 3 });
  });

  it('rolls back only the exact optimistic state and preserves a newer refresh', () => {
    const previous = { selected: false, count: 4 };
    const optimistic = { selected: true, count: 5 };
    expect(rollbackOptimisticToggle(optimistic, optimistic, previous)).toEqual(previous);
    expect(rollbackOptimisticToggle({ selected: true, count: 8 }, optimistic, previous))
      .toEqual({ selected: true, count: 8 });
  });

  it('does not double-increment a count already advanced by a refresh', () => {
    expect(reconcileIncrementCount(4, 4)).toBe(5);
    expect(reconcileIncrementCount(6, 4)).toBe(6);
    expect(reconcileIncrementCount(6, 4, 7)).toBe(7);
    expect(reconcileIncrementCount(6, 4, 3)).toBe(6);
    expect(reconcileIncrementCount(4, 4, 3)).toBe(5);
    expect(reconcileIncrementCount(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .toBe(Number.MAX_SAFE_INTEGER);
  });
});
