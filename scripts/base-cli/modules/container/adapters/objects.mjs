import { mkdir, readFile, open, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = async body => body === null ? Buffer.alloc(0) : typeof body === 'string' ? Buffer.from(body) : body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : body?.getReader ? Buffer.from(await new Response(body).arrayBuffer()) : Buffer.from(body);
export class Objects {
 constructor(sqlite, directory, bucket) {
  this.sqlite = sqlite; this.directory = directory; this.bucket = bucket;
  sqlite.exec('CREATE TABLE IF NOT EXISTS platform_objects(bucket TEXT NOT NULL,key TEXT NOT NULL,file TEXT NOT NULL,size INTEGER NOT NULL,etag TEXT NOT NULL,uploaded TEXT NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(bucket,key)); CREATE TABLE IF NOT EXISTS platform_multipart(id TEXT PRIMARY KEY,bucket TEXT NOT NULL,key TEXT NOT NULL,metadata TEXT NOT NULL); CREATE TABLE IF NOT EXISTS platform_parts(id TEXT NOT NULL,part INTEGER NOT NULL,file TEXT NOT NULL,etag TEXT NOT NULL,PRIMARY KEY(id,part))');
 }
 async recover() {
  await mkdir(this.directory, { recursive: true });
  const live = new Set([...this.sqlite.prepare('SELECT file FROM platform_objects').all(), ...this.sqlite.prepare('SELECT file FROM platform_parts').all()].map(row => row.file));
  for (const file of await readdir(this.directory)) if (!live.has(file)) await unlink(join(this.directory, file));
 }
 async writeImmutable(data) {
  await mkdir(this.directory,{recursive:true});const file=hash(data),temporary=join(this.directory,randomUUID()+'.partial');
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
  await rename(temporary,join(this.directory,file));const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}
  return file;
 }
 record(key) { return this.sqlite.prepare('SELECT * FROM platform_objects WHERE bucket=? AND key=?').get(this.bucket, key); }
 view(row, data) {
  const metadata = JSON.parse(row.metadata);if(metadata.httpMetadata?.cacheExpiry)metadata.httpMetadata.cacheExpiry=new Date(metadata.httpMetadata.cacheExpiry);
  const object = { key: row.key, version: row.file, size: row.size, etag: row.etag, httpEtag: `"${row.etag}"`, uploaded: new Date(row.uploaded), httpMetadata: metadata.httpMetadata ?? {}, customMetadata: metadata.customMetadata ?? {}, checksums: { sha256: Buffer.from(row.file, 'hex').buffer }, storageClass: 'Standard', writeHttpMetadata(headers) { for (const [key, value] of Object.entries(this.httpMetadata)) { const name = { contentType: 'content-type', contentLanguage: 'content-language', contentDisposition: 'content-disposition', contentEncoding: 'content-encoding', cacheControl: 'cache-control', cacheExpiry: 'expires' }[key]; if (name) headers.set(name, value instanceof Date ? value.toUTCString() : value); } } };
  object.checksums.sha256=Uint8Array.from(Buffer.from(row.file,'hex')).buffer;
  if (data !== undefined) {const response=new Response(data);Object.assign(object,{body:response.body,arrayBuffer:()=>response.arrayBuffer(),text:()=>response.text(),json:()=>response.json(),blob:()=>response.blob()});Object.defineProperty(object,'bodyUsed',{enumerable:true,get:()=>response.bodyUsed});}
  return object;
 }
 matches(row, condition) {
  if (!condition) return true;
  if (condition instanceof Headers) condition = { etagMatches: condition.get('if-match') ?? undefined, etagDoesNotMatch: condition.get('if-none-match') ?? undefined };
  const equals = value => value === '*' ? Boolean(row) : Boolean(row && value.replaceAll('"', '') === row.etag);
  return (condition.etagMatches === undefined || equals(condition.etagMatches)) && (condition.etagDoesNotMatch === undefined || !equals(condition.etagDoesNotMatch)) && (!condition.uploadedBefore || !row || new Date(row.uploaded) < condition.uploadedBefore) && (!condition.uploadedAfter || row && new Date(row.uploaded) > condition.uploadedAfter);
 }
 async head(key) { const row = this.record(key); return row ? this.view(row) : null; }
 async get(key, options = {}) {
  const row = this.record(key); if (!row) return null;
  if (!this.matches(row, options.onlyIf)) return this.view(row);
  let data = await readFile(join(this.directory, row.file)); let range;
  if(options.range instanceof Headers){const value=options.range.get('range');const match=/^bytes=(\d*)-(\d*)$/.exec(value??'');if(match)options={...options,range:match[1]?{offset:Number(match[1]),...(match[2]?{length:Number(match[2])-Number(match[1])+1}:{})}:{suffix:Number(match[2])}};else options={...options,range:undefined};}
  if (options.range) {
   const offset = options.range.suffix ? Math.max(0, data.length - options.range.suffix) : options.range.offset ?? 0;
   const length = options.range.length ?? data.length - offset; data = data.subarray(offset, offset + length); range = { offset, length: data.length };
  }
  return Object.assign(this.view(row,data),range?{range}:{});
 }
 async put(key, body, options = {}) {
  const data = await bytes(body), file = await this.writeImmutable(data);
  // Immutable files precede the committed pointer. A crash never leaves a pointer to unfinished bytes.
  this.sqlite.exec('BEGIN IMMEDIATE');
  try {
   const old = this.record(key); if (!this.matches(old, options.onlyIf)) { this.sqlite.exec('ROLLBACK'); return null; }
   const metadata = JSON.stringify({ httpMetadata: options.httpMetadata ?? {}, customMetadata: options.customMetadata ?? {} }), etag = createHash('md5').update(data).digest('hex');
   this.sqlite.prepare('INSERT OR REPLACE INTO platform_objects VALUES(?,?,?,?,?,?,?)').run(this.bucket, key, file, data.length, etag, new Date().toISOString(), metadata);
   this.sqlite.exec('COMMIT'); return this.head(key);
  } catch (cause) { this.sqlite.exec('ROLLBACK'); throw cause; }
 }
 async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.sqlite.prepare('DELETE FROM platform_objects WHERE bucket=? AND key=?').run(this.bucket, key); }
 async list({ prefix = '', cursor, limit = 1000, delimiter, startAfter = '' } = {}) {
  const after = cursor ? Buffer.from(cursor, 'base64url').toString() : startAfter;
  const rows = this.sqlite.prepare('SELECT * FROM platform_objects WHERE bucket=? AND key>? ORDER BY key').all(this.bucket, after).filter(row => row.key.startsWith(prefix));
  const objects = [], delimitedPrefixes = new Set(); let last, consumed = 0;
  for (const row of rows) {
   const tail = row.key.slice(prefix.length), separator = delimiter ? tail.indexOf(delimiter) : -1;
   const group=separator>=0?prefix+tail.slice(0,separator+delimiter.length):null;
   if (objects.length + delimitedPrefixes.size >= limit && !delimitedPrefixes.has(group)) break;
   last = row.key; consumed++;
   if (group) delimitedPrefixes.add(group); else objects.push(this.view(row));
  }
  const truncated = consumed < rows.length;
  return { objects, delimitedPrefixes: [...delimitedPrefixes], truncated, ...(truncated ? { cursor: Buffer.from(last).toString('base64url') } : {}) };
 }
 async createMultipartUpload(key, options = {}) { const uploadId = randomUUID(); this.sqlite.prepare('INSERT INTO platform_multipart VALUES(?,?,?,?)').run(uploadId, this.bucket, key, JSON.stringify(options)); return this.resumeMultipartUpload(key, uploadId); }
 resumeMultipartUpload(key, uploadId) {
  const check = () => { const row = this.sqlite.prepare('SELECT * FROM platform_multipart WHERE id=? AND bucket=? AND key=?').get(uploadId, this.bucket, key); if (!row) throw new Error('Multipart upload missing'); return row; };
  return { key, uploadId,
   uploadPart: async (partNumber, body) => { check(); if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw new Error('Invalid multipart part'); const data = await bytes(body), file = await this.writeImmutable(data), etag = hash(data); this.sqlite.prepare('INSERT OR REPLACE INTO platform_parts VALUES(?,?,?,?)').run(uploadId, partNumber, file, etag); return { partNumber, etag }; },
   abort: async () => { check(); this.sqlite.prepare('DELETE FROM platform_parts WHERE id=?').run(uploadId); this.sqlite.prepare('DELETE FROM platform_multipart WHERE id=?').run(uploadId); },
   complete: async parts => { const upload = check(); const data = []; let previous = 0; for (const part of parts) { if (part.partNumber <= previous) throw new Error('Multipart order'); previous = part.partNumber; const row = this.sqlite.prepare('SELECT * FROM platform_parts WHERE id=? AND part=? AND etag=?').get(uploadId, part.partNumber, part.etag); if (!row) throw new Error('Multipart part missing'); data.push(await readFile(join(this.directory, row.file))); } const result = await this.put(key, Buffer.concat(data), JSON.parse(upload.metadata)); this.sqlite.prepare('DELETE FROM platform_parts WHERE id=?').run(uploadId); this.sqlite.prepare('DELETE FROM platform_multipart WHERE id=?').run(uploadId); return result; },
  };
 }
}
