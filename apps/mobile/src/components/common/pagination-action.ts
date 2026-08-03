export function paginationActionState(
  itemLabel: string,
  state: {
    offline: boolean;
    loading: boolean;
    refreshing: boolean;
    requiresRefresh: boolean;
  },
) {
  const { offline, loading, refreshing, requiresRefresh } = state;
  return {
    label: loading ? `Loading ${itemLabel}…`
      : refreshing ? 'Refresh in progress…'
        : requiresRefresh ? 'Refresh to continue'
          : offline ? `Reconnect to load ${itemLabel}` : `Load ${itemLabel}`,
    disabled: offline || loading || refreshing || requiresRefresh,
    busy: loading || refreshing,
    hint: offline ? `Reconnect to load ${itemLabel}.`
      : refreshing ? 'Wait for the current refresh to finish.'
        : requiresRefresh ? 'Refresh the current list before loading another page.'
          : `Loads ${itemLabel}.`,
  } as const;
}
