/** Date preserves milliseconds only; never silently discard a nonzero fraction. */
export function hasSupportedInstantPrecision(value: string) {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1];
  return !fraction || !/[1-9]/.test(fraction.slice(3));
}
