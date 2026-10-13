import { validateMigrations } from '../deploy-kit/migrations.mjs';
export async function migrate(db, migrations, { ledger = '_rer_deploy_migrations' } = {}) {
 if (!['_rer_deploy_migrations', '_rer_portability_migrations'].includes(ledger)) throw new Error('Invalid migration ledger');
 validateMigrations(migrations);
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${ledger}(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('applying','applied')))`).run();
 const history = (await db.prepare(`SELECT name,sha256,state FROM ${ledger} ORDER BY name`).all()).results;
 if (history.some((row, i) => row.name !== migrations[i]?.name || row.sha256 !== migrations[i]?.sha256 || row.state !== 'applied')) throw new Error('changed-or-uncertain-migration-history');
 const legacy = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'").first();
 if (ledger === '_rer_deploy_migrations' && legacy && (await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.some(row => !history.some(prior => prior.name === row.name))) throw new Error('legacy-migration-history-needs-reviewed-hash-adoption');
 for (const migration of migrations.slice(history.length)) {
  await db.prepare(`INSERT INTO ${ledger} VALUES(?,?,'applying')`).bind(migration.name, migration.sha256).run();
  // A claim commits separately. Application and completion share one transaction.
  await db.batch([...migration.statements.map(sql => db.prepare(sql)), db.prepare(`UPDATE ${ledger} SET state='applied' WHERE name=? AND sha256=? AND state='applying'`).bind(migration.name, migration.sha256)]);
 }
 return { applied: migrations.length, pending: 0 };
}
