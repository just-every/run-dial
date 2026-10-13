import { jsonSecretScanner } from './json-secret-scanner.mjs';
function contains(bytes, needle) {
 outer: for (let i=0; i<=bytes.length-needle.length; i++) {
  for (let j=0; j<needle.length; j++) if (bytes[i+j] !== needle[j]) continue outer;
  return true;
 }
 return false;
}
// Preserve overlap so a credential split between stream chunks is still refused.
export function secretScanner(secrets = []) {
  const needles = secrets.map(value => new TextEncoder().encode(value));
  const scanJson = jsonSecretScanner(secrets);
  const overlap = needles.reduce((maximum, value) => Math.max(maximum, value.length - 1), 0);
  let tail = new Uint8Array(0);
  return value => {
    const bytes = tail.length ? Uint8Array.from([...tail, ...value]) : value;
    if (needles.some(needle => contains(bytes, needle))) throw new Error('archive-object-contains-credential');
    tail = overlap ? bytes.slice(Math.max(0, bytes.length - overlap)) : tail;
    scanJson(value);
  };
}
