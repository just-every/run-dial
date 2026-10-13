import { createHash } from 'node:crypto';
import { canonicalRow, collectSecrets, exported, excluded, internal, assertCoverage } from '../archive/policy.mjs';
import { environmentSecrets } from '../archive/secrets.mjs';
import { secretScanner } from '../archive/streams.mjs';
import { schemaModel, validateRows, assertSchema } from '../archive/schema.mjs';

const quote = name => '"' + name.replaceAll('"', '""') + '"';
export async function dialPolicy(db, vars) {
 if (!vars.SESSION_SECRET) throw Error('archive-owner-salt-required');
 const model = await schemaModel();
 let schemaProof;
 try {
  await assertSchema({ query: async sql => (await db.prepare(sql).all()).results }, model);
  schemaProof = JSON.stringify({ migrations: model.migrations, catalog: model.catalog });
 } finally { model.db.close(); }
 if (await db.prepare("SELECT 1 FROM rer_erasure_operations WHERE phase<>'complete' OR subject IS NOT NULL OR completed_at IS NULL UNION ALL SELECT 1 FROM person_erasure_receipts WHERE completed_at IS NULL UNION ALL SELECT 1 FROM person_erasure_locks UNION ALL SELECT 1 FROM operator_erasure_subjects LIMIT 1").first()) throw Error('archive-erasure-incomplete');
 const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(row => row.name).filter(name => !name.startsWith('rer_portability_'));
 assertCoverage(names);
 const rows = await db.batch([...exported, ...Object.keys(excluded)].map(name => db.prepare(`SELECT * FROM ${quote(name)}`)));
 const secrets = collectSecrets(rows.map((result, index) => ({ name: [...exported, ...Object.keys(excluded)][index], rows: result.results })), environmentSecrets(vars));
 const known = [...new Set([...secrets, ...environmentSecrets(vars)])];
 const saltHash = createHash('sha256').update(vars.SESSION_SECRET).digest('hex');
 return {
  policy: {
   product: 'just-every/dial', includeTables: exported.filter(name => /^(oa_|oc_)/.test(name)),
   excludeTables: [...Object.keys(excluded), ...Object.keys(internal)], buckets: { FILES: {} },
   requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'APP_URL', 'MAIL_PROVIDER', 'MAIL_FROM', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'CALENDAR_WEBHOOK_SECRET'],
   exportRow: (name, row) => canonicalRow(name, row, known),
   extraPayloads: { 'schema-proof': { produce: () => new TextEncoder().encode(schemaProof), async consume(stream) { if (await new Response(stream).text() !== schemaProof) throw Error('archive-schema-mismatch'); } }, 'owner-salt-continuity': {
    produce: () => new TextEncoder().encode(saltHash),
    async consume(stream) {
     const bytes = await new Response(stream).text();
     if (bytes !== saltHash) throw Error('archive-owner-salt-mismatch');
    },
   } },
   async validateStaged({ db, read, manifest }) {
    // Preserve Dial's exact authority graph and historical command guarantees.
    const tables = await Promise.all(manifest.tables.map(async table => ({ name: table.name, rows: await read(table.name) })));
    const model = await schemaModel();
    try { validateRows({ migrations: model.migrations, tables: [...tables].sort((a, b) => a.name.localeCompare(b.name)) }, model); }
    finally { model.db.close(); }
    for (const name of Object.keys(excluded)) if (await db.prepare(`SELECT 1 FROM ${quote(name)} LIMIT 1`).first()) throw Error('archive-destination-not-empty');
    const stagedSecrets = collectSecrets(tables, environmentSecrets(vars));
    for (const table of tables) for (const row of table.rows) if (JSON.stringify(canonicalRow(table.name, row, stagedSecrets)) !== JSON.stringify(row)) throw Error('archive-unsafe-state');
    const find = name => tables.find(table => table.name === name).rows;
    if (find('rer_erasure_operations').some(row => row.phase !== 'complete' || row.subject !== null || row.completed_at === null) || find('person_erasure_receipts').some(row => row.completed_at === null)) throw Error('archive-erasure-incomplete');
    const native = find('oa_operators'), product = find('operators'), ledger = find('oa_bootstrap'), setup = find('operator_setup_identity');
    if (find('operator_erasure_subjects').length || product.some(row => row.erased_at
      ? row.removed_at === null || row.email !== 'erased:' + row.id || row.normalized_email !== row.email
      : !native.some(account => account.id === row.id)) || native.some(row => row.role !== 'owner' || !product.some(owner =>
        owner.id === row.id && owner.normalized_email === row.email && (owner.removed_at === null) === (row.status === 'active')
        && (!owner.erased_at || row.status === 'inactive' && row.display_name === 'Removed operator')))) throw Error('archive-inconsistent-operator-authority');
    if (native.length ? setup.length !== 1 || setup[0].operator_id !== ledger[0]?.claim_id : ledger.length || setup.length) throw Error('archive-missing-bootstrap-authority');
    if (native.length && (ledger.length !== 1 || !native.some(row => row.status === 'active') || !native.some(row => row.id === ledger[0].claim_id))) throw Error('archive-missing-bootstrap-authority');
   },
  },
  knownSecrets: known,
 };
}
// The Base module owns storage, checksums and atomic restore. This binding wrapper
// adds Dial's credential exclusion policy to actual source object bytes/metadata.
export function guardedBucket(bucket, knownSecrets) {
 const scans = new Map();
 return new Proxy(bucket, { get(target, key) {
  if (key === 'get') return async (name, options) => {
   const result = await target.get(name, options); if (!result) return result;
   if (options?.range) {
    const scan = scans.get(name) ?? secretScanner(knownSecrets); scans.set(name, scan);
    const bytes = new Uint8Array(await result.arrayBuffer()); scan(bytes);
    return { ...result, arrayBuffer: async () => bytes.buffer };
   }
   return result;
  };
  if (key === 'list') return async options => {
   const page = await target.list(options);
   for (const object of page.objects) secretScanner(knownSecrets)(Buffer.from(JSON.stringify({ key: object.key, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata })));
   return page;
  };
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
 } });
}
