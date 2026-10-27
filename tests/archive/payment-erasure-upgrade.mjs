import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrationFiles, tableQuery } from "../../scripts/archive/schema.mjs";

/** Populated rows made before payment erasure metadata upgrade without invented processor identities. */
export async function paymentErasureUpgrade(source) {
  return preservedUpgrade(source, "core/0074_payment_erasure.sql", prior => {
    assert.ok(prior.prepare("SELECT stripe_customer_id FROM payment_movements").all().every(row => row.stripe_customer_id === null), "older invoices have no invented Customer identity");
    assert.ok(prior.prepare("SELECT stripe_customer_observed FROM payment_movements").all().every(row => row.stripe_customer_observed === 0), "older invoice Customer creation is explicitly unobserved");
    assert.ok(prior.prepare("SELECT stripe_sessions_retained FROM person_erasure_receipts").all().every(row => row.stripe_sessions_retained === null), "older receipts say Checkout was not counted");
  });
}

export async function paidApprovalUpgrade(source) {
  return preservedUpgrade(source, "core/0075_paid_approval.sql", prior => {
    const requests = prior.prepare("SELECT payment_json FROM booking_approval_requests").all();
    assert.ok(requests.length > 0, "the prior schema has a populated approval request");
    assert.ok(requests.every(row => row.payment_json === null), "existing free requests acquire no authorization, money command or invented processor reference");
  });
}

export async function processorErasureUpgrade(source) {
  return preservedUpgrade(source,"core/0076_processor_erasure_requests.sql",prior=>{
    assert.equal(prior.prepare("SELECT count(*) AS n FROM processor_erasure_requests").get().n,0,"historical receipts gain no invented external request");
  });
}

async function preservedUpgrade(source, file, check) {
  const prior = new DatabaseSync(":memory:"), migrations = await migrationFiles();
  const upgrade = migrations.find(row => row.file === file);
  assert.ok(upgrade, file);
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
    for (const { name, fields, rows } of before) assert.deepEqual(prior.prepare(`SELECT ${fields} FROM "${name}"`).all(), rows, `${name}: ${file} preserves previous facts`);
    check(prior);
  } finally { prior.close(); }
}

export async function reconciliationUpgrade(source) {
  const prior = new DatabaseSync(":memory:"), migrations = await migrationFiles();
  const upgrade = migrations.find(row=>row.file==="core/0079_payment_reconciliation.sql");
  try {
    for(const migration of migrations.filter(row=>row!==upgrade))prior.exec(migration.sql);
    prior.exec("PRAGMA foreign_keys=OFF");
    const columns=prior.prepare("PRAGMA table_info(booking_payments)").all().map(row=>row.name);
    const rows=source.prepare("SELECT * FROM booking_payments").all();
    for(const row of rows)prior.prepare(`INSERT INTO booking_payments (${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c]));
    assert.ok(rows.length,"prior schema has a captured payment");prior.exec(upgrade.sql);
    assert.deepEqual(prior.prepare("SELECT * FROM booking_payments").all(),rows,"PAY-006 additive migration preserves a populated payment");
    for(const table of ["payment_processor_facts","accounting_connections","accounting_oauth_states","accounting_exports"])assert.equal(prior.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,"new record kinds start empty");
  }finally{prior.close();}
}

export async function noticeUpgrade(source){return preservedUpgrade(source,"core/0080_workspace_notices.sql",prior=>{assert.ok(prior.prepare("SELECT count(*) AS n FROM bookings").get().n>0,"upgrade preserves a populated booking");for(const table of ["workspace_notice_destinations","workspace_notice_deliveries","notice_oauth_states","notice_erasure_requests"])assert.equal(prior.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,"new notice record kinds start empty");});}


export async function entitlementUpgrade(source) {
  return preservedUpgrade(source,"core/0083_payment_entitlements.sql",prior=>{
    assert.ok(prior.prepare("SELECT count(*) AS n FROM bookings").get().n>0,"entitlement upgrade preserves populated booking data");
    assert.ok(prior.prepare("SELECT count(*) AS n FROM booking_payments").get().n>0,"entitlement upgrade preserves captured payments");
    for(const table of ["payment_products","payment_entitlements","payment_redemptions","payment_entitlement_events"])assert.equal(prior.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,"existing installs gain no invented appointment credit");
  });
}
