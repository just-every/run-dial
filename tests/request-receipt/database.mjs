import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";

export async function receiptDatabase(context) {
  const sqlite = new DatabaseSync(":memory:");
  context.after(() => sqlite.close());
  for (const name of (await readdir(new URL("../../migrations/core/", import.meta.url))).sort()) {
    sqlite.exec(await readFile(new URL(`../../migrations/core/${name}`, import.meta.url), "utf8"));
  }
  const prepare = (sql, args = []) => ({
    bind: (...values) => prepare(sql, values),
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args), meta: { changes: Number(sqlite.prepare("SELECT changes() AS n").get().n) } }; },
    async raw() { const statement = sqlite.prepare(sql); statement.setReturnArrays(true); return statement.all(...args); },
    async run() { const result = sqlite.prepare(sql).run(...args); return { results: [], meta: { changes: Number(result.changes) } }; },
  });
  const binding = { prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  sqlite.exec(`INSERT INTO host_profiles(id,singleton_key,handle,name,title,biography,timezone,created_at,updated_at)
    VALUES('host','default','maya-chen','Maya Chen','Host','','UTC','2026-01-01','2026-01-01');
    INSERT INTO event_types(id,status,slug,title,description,duration_minutes,color,location_type,location_label,alternative_requests_enabled,created_at,updated_at)
    VALUES('event-one','published','conversation','Conversation','',30,'blue','phone','Phone',1,'2026-01-01','2026-01-01'),
          ('event-two','published','different-event','Another conversation','',30,'blue','phone','Phone',1,'2026-01-01','2026-01-01');
    INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at)
    VALUES('fixture-owner','operator@example.test','Owner','owner','active',1,1);`);
  return { sqlite, binding, snapshot() {
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    return JSON.stringify(tables.map(({ name }) => [name, sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]));
  } };
}
