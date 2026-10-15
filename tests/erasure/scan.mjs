import assert from 'node:assert/strict';

/** Inspect every application table, portability copy and readable SQLite table.
 * Failure output carries table/object category only, never personal canaries. */
export async function snapshot(db) {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).results;
  const result = {};
  // Cloudflare's private engine tables are outside application storage and
  // D1's authorizer can refuse access to them.
  for (const { name } of tables.filter(table => !table.name.startsWith('_cf_'))) result[name] = (await db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()).results;
  return result;
}
export function containsPersonal(value, markers) {
  const strings = [];
  function visit(item, depth = 0) {
    if (depth > 12 || item === null) return;
    if (typeof item === 'string') {
      strings.push(item);
      let decoded = item;
      for (let pass = 0; pass < 3; pass++) {
        try { const next = decodeURIComponent(decoded); if (next === decoded) break; strings.push(next); decoded = next; }
        catch { break; }
      }
      strings.push(item.replace(/\\u([0-9a-f]{4})/giu, (_, code) => String.fromCharCode(Number.parseInt(code,16))));
      if (/^[A-Za-z0-9+/=\r\n]{16,}$/.test(item)) strings.push(Buffer.from(item, 'base64').toString('utf8'));
      try { const parsed = JSON.parse(item); if (parsed !== item) visit(parsed, depth + 1); } catch { /* plain text */ }
    } else if (Array.isArray(item)) {
      if (item.length && item.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) strings.push(Buffer.from(item).toString('utf8'));
      else item.forEach(child => visit(child, depth + 1));
    } else if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) strings.push(Buffer.from(item instanceof ArrayBuffer ? item : item.buffer, item.byteOffset ?? 0, item.byteLength).toString('utf8'));
    else if (typeof item === 'object') Object.values(item).forEach(child => visit(child, depth + 1));
  }
  visit(value);
  return strings.some(item => markers.some(marker => item.toLowerCase().includes(marker.toLowerCase())));
}
export async function scan(db, bucket, markers, hashes = []) {
  const rows = await snapshot(db);
  for (const [name, values] of Object.entries(rows)) {
    const encoded = JSON.stringify(values).toLowerCase();
    assert.equal(containsPersonal(values, markers), false, `${name}: plaintext personal value remained`);
    assert.equal(hashes.some(hash => encoded.includes(hash)), false, `${name}: known identity fingerprint remained`);
  }
  // Original bytes are chunked independently of source record boundaries.
  const originals = new Map();
  for (const row of rows.ik_d1_original_chunks ?? []) {
    const key = JSON.stringify([row.job_id, row.kind, row.original_key]);
    if (!originals.has(key)) originals.set(key, []);
    originals.get(key).push(row);
  }
  for (const chunks of originals.values()) {
    const ordered = chunks.sort((a,b) => a.ordinal - b.ordinal);
    const bytes = ordered.every(row => typeof row.bytes === 'string')
      ? Buffer.from(ordered.map(row => row.bytes).join(''), 'base64')
      : Buffer.concat(ordered.map(row => Buffer.from(row.bytes)));
    assert.equal(containsPersonal(bytes.toString('utf8'), markers), false, 'original source chunks retained personal bytes');
  }
  let cursor, objects = 0;
  do {
    const list = await bucket.list({ cursor, include: ['customMetadata', 'httpMetadata'] });
    for (const object of list.objects) {
      const stored = await bucket.get(object.key);
      const encoded = JSON.stringify(object) + await stored.text();
      assert.equal(containsPersonal(encoded, markers), false, 'R2: personal bytes or metadata remained');
      objects++;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return { tables: Object.keys(rows).length, rows: Object.values(rows).reduce((count, values) => count + values.length, 0), objects };
}
