/** Balance each native snapshot before Import Kit packs several snapshots.
 * Flat AND lists inside nested SELECTs exceed D1's expression-depth limit.
 * Parentheses preserve every comparison and its original binding order. */
export function conjunction(parts: readonly string[]): string {
 const join = (start: number, end: number): string => {
  if (end - start === 1) return `(${parts[start]})`;
  const middle = start + Math.floor((end - start) / 2);
  return `(${join(start, middle)} AND ${join(middle, end)})`;
 };
 return parts.length ? join(0, parts.length) : '0';
}
