import { canonicalRow, collectSecrets, excluded } from '../archive/policy.mjs';
import { environmentSecrets } from '../archive/secrets.mjs';
import { exportPolicy } from '../archive/export-policy.mjs';
import { schemaModel, validateRows, assertSchema } from '../archive/schema.mjs';
import { priorSchemas } from '../archive/prior-schemas.mjs';

const quote = name => '"' + name.replaceAll('"', '""') + '"';
export async function dialPolicy(db, vars) {
 if (!vars.SESSION_SECRET) throw Error('archive-owner-salt-required');
 const model = await schemaModel();
 let schemaProof;
 try {
  await assertSchema({ query: async sql => (await db.prepare(sql).all()).results }, model);
  schemaProof = JSON.stringify({ migrations: model.migrations, catalog: model.catalog });
 } finally { model.db.close(); }
 const result = await exportPolicy(db, vars, schemaProof);
 // A backup from an earlier migration set restores through its declared row
 // upgrades, and must carry exactly the schema proof of a set with its schema.
 const priors = await priorSchemas(result.policy), current = result.policy.extraPayloads['schema-proof'];
 let prior;
 result.policy.acceptedSchemas = Object.fromEntries(priors.map(({ identity, upgradeRow }) => [identity, { upgradeRow }]));
 result.policy.extraPayloads['schema-proof'] = { produce: current.produce, async consume(stream) {
  if (!prior) return current.consume(stream);
  if (!prior.proofs.includes(await new Response(stream).text())) throw Error('archive-schema-mismatch');
 } };
 result.policy.validateStaged = async function({ db, read, manifest }) {
    // Base consumes payloads after staged validation; bind the proof to this archive's schema.
    prior = priors.find(entry => entry.identity === manifest.schema);
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
 };
 return result;
}
export { guardedBucket } from '../archive/guarded-bucket.mjs';
