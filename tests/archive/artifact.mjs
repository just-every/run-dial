// Tests inspect a normalized view of the actual shared archive records. The
// Base service performs every snapshot, encoding, checksum and restore operation.
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPortability, readArchive } from '../../scripts/base-cli/modules/portability/index.mjs';
import { dialPolicy, guardedBucket } from '../../scripts/local/archive-policy.mjs';
const archives = new WeakMap();
const vars = { SESSION_SECRET: 'synthetic-test-owner-held-salt' };
function bucket(platform) {
 const get = async (key, options) => {
  const value = platform.objects.get(key); if (!value) return null;
  const bytes = options?.range ? value.bytes.subarray(options.range.offset, options.range.offset + options.range.length) : value.bytes;
  return { etag: createHash('sha256').update(value.bytes).digest('hex'), arrayBuffer: async () => Uint8Array.from(bytes).buffer, body: new Blob([bytes]).stream() };
 };
 return {
  async list() { return { objects: [...platform.objects].map(([key, value]) => ({ key, size: value.bytes.length, etag: createHash('sha256').update(value.bytes).digest('hex'), httpMetadata: value.contentType === null ? {} : { contentType: value.contentType } })), truncated: false }; }, get,
  async put(key, body, options) { const bytes = body instanceof ReadableStream ? Buffer.from(await new Response(body).arrayBuffer()) : Buffer.from(body); platform.objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType ?? null }); return {}; },
  async delete(key) { platform.objects.delete(key); },
 };
}
async function service(platform, transformRow) {
 const { policy, knownSecrets } = await dialPolicy(platform.binding, { ...vars, ...(platform.knownSecrets?.() ?? []).reduce((result, value, index) => ({ ...result, [`TEST_${index}_SECRET`]: value }), {}) });
 if (transformRow) { const original=policy.exportRow; policy.exportRow=(name,row)=>transformRow(name,original(name,row)); }
 return createPortability({ db: platform.binding, buckets: { FILES: guardedBucket(bucket(platform), knownSecrets) }, policy });
}
export async function createArchive(platform, path, { transformRow } = {}) {
 const api = await service(platform, transformRow), id = await api.exports.create();
 try {
  while ((await api.exports.advance(id, { maxParts: 16 })).phase === 'building') { /* Base advances its durable snapshot. */ }
  const bytes = await new Response(await api.exports.download(id)).arrayBuffer();
  if (path) await writeFile(path, Buffer.from(bytes), { mode: 0o600, flag: 'wx' });
  const records = []; for await (const record of readArchive(new Blob([bytes]).stream())) records.push(record);
  const manifest = records[0];
  const schemaBytes = records.filter(record => record.kind === 'part').flatMap(record => record.items.filter(item => item.kind === 'payload' && item.name === 'schema-proof').map(item => Buffer.from(item.data, 'base64')));
  const archive = { migrations: JSON.parse(Buffer.concat(schemaBytes).toString()).migrations, tables: manifest.tables.map(table => ({ name: table.name, rows: records.filter(record => record.kind === 'part').flatMap(record => record.items.filter(item => item.kind === 'row' && item.table === table.name).map(item => item.row)) })), objects: manifest.objects.map(object => ({ key: object.key, size: object.size, sha256: object.sha256, contentType: object.httpMetadata.contentType ?? null })) };
  archives.set(archive, records); return archive;
 } finally { await api.exports.abort(id); }
}
export async function restoreArchive(platform, archive) {
 const records = archives.get(archive); if (!records) throw Error('archive-invalid-format');
 const api = await service(platform); const id = await api.imports.create(records[0]); let complete = false;
 try {
  for (const record of records) if (record.kind === 'part') await api.imports.uploadPart(id, record.index, record);
  await api.imports.finalize(id, { contentHash: records.at(-1).contentHash, archiveHash: records.at(-1).archiveHash }); complete = true;
 } finally { if (!complete) await api.imports.abort(id); }
}
