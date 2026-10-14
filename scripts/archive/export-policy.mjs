import { sha256 } from '@runeditrun/rer/internal/modules/portability/hash.mjs';
import { canonicalRow, collectSecrets, exported, excluded, internal, assertCoverage } from './policy.mjs';
import { assertMigrationLedger } from './migration-ledger.mjs';
import { environmentSecrets } from './environment-secrets.mjs';
const quote = name => '"' + name.replaceAll('"', '""') + '"';
export async function exportPolicy(db, vars, schemaProof) {
 await assertMigrationLedger(db, JSON.parse(schemaProof).migrations);
 if (!vars.SESSION_SECRET) throw Error('archive-owner-salt-required');
 if (await db.prepare("SELECT 1 FROM rer_erasure_operations WHERE phase<>'complete' OR subject IS NOT NULL OR completed_at IS NULL UNION ALL SELECT 1 FROM person_erasure_receipts WHERE completed_at IS NULL UNION ALL SELECT 1 FROM person_erasure_locks UNION ALL SELECT 1 FROM operator_erasure_subjects LIMIT 1").first()) throw Error('archive-erasure-incomplete');
 const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(row => row.name).filter(name => !name.startsWith('rer_portability_'));
 assertCoverage(names);
 const rows = await db.batch([...exported, ...Object.keys(excluded)].map(name => db.prepare(`SELECT * FROM ${quote(name)}`)));
 const secrets = collectSecrets(rows.map((result, index) => ({ name: [...exported, ...Object.keys(excluded)][index], rows: result.results })), environmentSecrets(vars));
 const known = [...new Set([...secrets, ...environmentSecrets(vars)])];
 const saltHash = await sha256(vars.SESSION_SECRET);
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
  },
  knownSecrets: known,
 };
}
