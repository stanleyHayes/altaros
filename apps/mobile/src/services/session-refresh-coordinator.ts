type RefreshOperation = () => Promise<string>;

const refreshFlights = new Map<string, Promise<string>>();

/**
 * Refresh tokens are rotating, single-use credentials. Requests from one token
 * family must share a flight, while a replacement login must be free to start
 * its own flight instead of inheriting an older family's eventual rejection.
 */
export function coalesceSessionRefresh(
  refreshToken: string,
  operation: RefreshOperation,
): Promise<string> {
  const current = refreshFlights.get(refreshToken);
  if (current) return current;

  const flight = operation();
  refreshFlights.set(refreshToken, flight);
  const release = () => {
    if (refreshFlights.get(refreshToken) === flight) refreshFlights.delete(refreshToken);
  };
  void flight.then(release, release);
  return flight;
}
