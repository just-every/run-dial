// Lamp's retained-public-bundle contract only. This is not a Durable Object implementation.
export function retainedCache(sqlite) {
 sqlite.exec('CREATE TABLE IF NOT EXISTS platform_retained(id TEXT PRIMARY KEY,generation INTEGER NOT NULL,body TEXT NOT NULL)');
 return { idFromName: name => name, get: id => ({ async fetch(input, init) {
  const request = new Request(input, init), current = () => sqlite.prepare('SELECT * FROM platform_retained WHERE id=?').get(id);
  if (request.method === 'HEAD') { const row = current(); return new Response(null, { status: row ? 200 : 404, headers: row ? { 'x-lamp-generation': String(row.generation) } : {} }); }
  if (request.method === 'GET') { const row = current(); return new Response(row?.body, { status: row ? 200 : 404, headers: { 'content-type': 'application/json' } }); }
  if (request.method !== 'PUT') return new Response(null, { status: 405 });
  const body = await request.text(); let bundle;
  try { bundle = JSON.parse(body); const keys = new Set(); if (typeof bundle.version !== 'string' || !Number.isFinite(Date.parse(bundle.generatedAt)) || !Number.isInteger(bundle.generation) || bundle.generation < 0 || !Array.isArray(bundle.artifacts)) throw new Error(); for (const artifact of bundle.artifacts) { if (typeof artifact.key !== 'string' || typeof artifact.body !== 'string' || typeof artifact.contentType !== 'string' || keys.has(artifact.key)) throw new Error(); keys.add(artifact.key); } if (!['page.html','feed.atom','widget.js','status.json'].every(key => keys.has(key))) throw new Error(); } catch { return new Response('Invalid complete snapshot', { status: 400 }); }
  sqlite.prepare('INSERT INTO platform_retained VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,body=excluded.body WHERE excluded.generation>platform_retained.generation').run(id, bundle.generation, body);
  return new Response(null, { status: 204 });
 } }) };
}
