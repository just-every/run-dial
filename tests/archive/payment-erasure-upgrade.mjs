import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrationFiles, tableQuery } from "../../scripts/archive/schema.mjs";

/** Populated rows made before payment erasure metadata upgrade without invented processor identities. */
export async function paymentErasureUpgrade(source) {
  const prior = new DatabaseSync(":memory:"), migrations = await migrationFiles();
  const upgrade = migrations.find(row => row.file === "core/0074_payment_erasure.sql");
  try {
    for (const migration of migrations.filter(row => row !== upgrade)) prior.exec(migration.sql);
    prior.exec("PRAGMA foreign_keys=OFF");
    const triggers = prior.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
    for (const trigger of triggers) prior.exec(`DROP TRIGGER "${trigger.name}"`);
    const before = [];
    for (const { name } of prior.prepare(tableQuery).all()) {
      if (name === "sqlite_sequence") continue;
      const columns = prior.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name);
      const fields = columns.map(column => `"${column}"`).join(",");
      const rows = source.prepare(`SELECT ${fields} FROM "${name}"`).all();
      prior.exec(`DELETE FROM "${name}"`);
      for (const row of rows) prior.prepare(`INSERT INTO "${name}" (${fields}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map(column => row[column]));
      before.push({ name, fields, rows });
    }
    for (const trigger of triggers) prior.exec(trigger.sql);
    prior.exec(upgrade.sql);
    for (const { name, fields, rows } of before) assert.deepEqual(prior.prepare(`SELECT ${fields} FROM "${name}"`).all(), rows, `${name}: payment erasure upgrade preserves previous facts`);
    assert.ok(prior.prepare("SELECT stripe_customer_id FROM payment_movements").all().every(row => row.stripe_customer_id === null), "older invoices have no invented Customer identity");
    assert.ok(prior.prepare("SELECT stripe_customer_observed FROM payment_movements").all().every(row => row.stripe_customer_observed === 0), "older invoice Customer creation is explicitly unobserved");
    assert.ok(prior.prepare("SELECT stripe_sessions_retained FROM person_erasure_receipts").all().every(row => row.stripe_sessions_retained === null), "older receipts say Checkout was not counted");
  } finally { prior.close(); }
}
