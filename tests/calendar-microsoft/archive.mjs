import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrationFiles } from "../../scripts/archive/schema.mjs";
import { canonicalRow } from "../../scripts/archive/policy.mjs";

export async function calendarProviderUpgrade(source) {
  const prior = new DatabaseSync(":memory:"), migrations = await migrationFiles();
  const upgrade = migrations.find(row => row.file.endsWith("_calendar_provider.sql")); assert.ok(upgrade);
  try {
    for (const migration of migrations.filter(row => row !== upgrade)) prior.exec(migration.sql);
    const columns = prior.prepare("PRAGMA table_info(calendar_connections)").all().map(column => column.name);
    const before = source.prepare(`SELECT ${columns.join(",")} FROM calendar_connections`).all(); assert.ok(before.length);
    for (const row of before) prior.prepare(`INSERT INTO calendar_connections (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map(column => row[column]));
    prior.exec(upgrade.sql);
    assert.deepEqual(prior.prepare(`SELECT ${columns.join(",")} FROM calendar_connections`).all(), before, "populated Google connection and sealed credentials survive the additive expansion");
    assert.ok(prior.prepare("SELECT calendar_provider FROM calendar_connections").all().every(row => row.calendar_provider === "google"), "an existing connection remains Google");
    const microsoft = canonicalRow("calendar_connections", { ...source.prepare("SELECT * FROM calendar_connections").get(), calendar_provider: "microsoft", sync_cursor: "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=synthetic-dial-1626" });
    assert.equal(microsoft.calendar_provider, "microsoft"); assert.equal(microsoft.status, "unhealthy"); assert.equal(microsoft.unhealthy_code, "reauthorization_required");
    for (const column of ["access_token_ciphertext", "refresh_token_ciphertext", "access_token_expires_at", "sync_cursor"]) assert.equal(microsoft[column], null, `${column}: restore grants no provider authority`);
    source.prepare("UPDATE calendar_connections SET calendar_provider='microsoft'").run();
    source.prepare("UPDATE event_types SET location_type='microsoft_teams',location_label='Microsoft Teams',location_value='',locations_json=?").run(JSON.stringify([{ id: "synthetic-dial-1638", type: "microsoft_teams", label: "Microsoft Teams", value: "" }]));
  } finally { prior.close(); }
}
