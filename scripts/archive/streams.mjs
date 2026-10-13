import { createHash } from 'node:crypto';
import { jsonSecretScanner } from './json-secret-scanner.mjs';
export async function* chunks(body) {
  if (body instanceof Uint8Array) { yield Buffer.from(body.buffer, body.byteOffset, body.byteLength); return; }
  for await (const value of body) {
    if (!(value instanceof Uint8Array)) throw new Error('archive-invalid-object-stream');
    yield Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
}
// Preserve overlap so a credential split between stream chunks is still refused.
export function secretScanner(secrets = []) {
  const needles = secrets.map(value => Buffer.from(value));
  const scanJson = jsonSecretScanner(secrets);
  const overlap = needles.reduce((maximum, value) => Math.max(maximum, value.length - 1), 0);
  let tail = Buffer.alloc(0);
  return value => {
    const bytes = tail.length ? Buffer.concat([tail, value]) : value;
    if (needles.some(needle => bytes.includes(needle))) throw new Error('archive-object-contains-credential');
    tail = overlap ? Buffer.from(bytes.subarray(Math.max(0, bytes.length - overlap))) : tail;
    scanJson(value);
  };
}
export async function digestBody(body, size, consume = async () => {}, secrets = [], progress) {
  const digest = createHash('sha256'); const scan = secretScanner(secrets); let total = 0;
  for await (const bytes of chunks(body)) {
    total += bytes.length;
    if (progress) progress.consumedBytes = total;
    if (total > size) throw new Error('archive-object-size-changed');
    scan(bytes); digest.update(bytes); await consume(bytes);
  }
  if (total !== size) throw new Error('archive-object-size-changed');
  return digest.digest('hex');
}
