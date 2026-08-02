export function insertUniqueById<T extends { id: string }>(
  items: T[],
  item: T,
  position: 'start' | 'end',
): T[] {
  if (items.some((current) => current.id === item.id)) return items;
  return position === 'start' ? [item, ...items] : [...items, item];
}

export interface ToggleCountState {
  selected: boolean;
  count: number;
}

export function reconcileToggleCount(
  current: ToggleCountState,
  selected: boolean,
  authoritativeCount?: number,
): ToggleCountState {
  const delta = current.selected === selected ? 0 : selected ? 1 : -1;
  return {
    selected,
    count: authoritativeCount ?? Math.max(0, current.count + delta),
  };
}

export function rollbackOptimisticToggle(
  current: ToggleCountState,
  optimistic: ToggleCountState,
  previous: ToggleCountState,
): ToggleCountState {
  return current.selected === optimistic.selected && current.count === optimistic.count
    ? previous
    : current;
}

export function reconcileIncrementCount(
  current: number,
  startedAt: number,
  authoritativeCount?: number,
): number {
  const incremented = startedAt < Number.MAX_SAFE_INTEGER ? startedAt + 1 : startedAt;
  if (authoritativeCount !== undefined) {
    return Math.max(current, incremented, authoritativeCount);
  }
  return current <= startedAt ? incremented : current;
}
