import { createHash } from 'node:crypto';
import { secretScanner } from './secret-scanner.mjs';
export { secretScanner } from './secret-scanner.mjs';
export async function* chunks(body) {
  if (body instanceof Uint8Array) { yield Buffer.from(body.buffer, body.byteOffset, body.byteLength); return; }
  for await (const value of body) {
    if (!(value instanceof Uint8Array)) throw new Error('archive-invalid-object-stream');
    yield Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
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
