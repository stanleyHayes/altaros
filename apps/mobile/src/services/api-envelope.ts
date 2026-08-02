/**
 * The Go gateway wraps every successful body in `{ success: true, data }`.
 * During the strangler migration, proxied legacy routes may still return the
 * payload directly. Support both deliberately, but never accept a response
 * that claims to be an envelope without explicitly confirming success.
 */
export function unwrapApiData(value: unknown, errorMessage: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'success')) return value;
  if (record.success !== true || !Object.prototype.hasOwnProperty.call(record, 'data')) {
    throw new Error(errorMessage);
  }
  return record.data;
}

export function envelopeTotal(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const pagination = (value as { pagination?: unknown }).pagination;
  if (typeof pagination !== 'object' || pagination === null || Array.isArray(pagination)) {
    return undefined;
  }
  return (pagination as { total?: unknown }).total;
}
