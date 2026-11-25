import { runScheduledWork } from "../../src/core/app/background-work";
import { createServices } from "../../src/core/app/services";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";

// Production's Cron handler over a D1 that reports every statement's meta.rows_read.
function metered(db, log) {
  const record = (result) => { log.push(result.meta.rows_read); return result; };
  const wrap = (statement) => ({
    statement,
    bind: (...values) => wrap(statement.bind(...values)),
    all: async () => record(await statement.all()),
    first: async (column) => { const row = (await record(await statement.all())).results[0] ?? null; return column ? row?.[column] ?? null : row; },
    run: async () => record(await statement.run()),
    raw: async () => (await record(await statement.all())).results.map(Object.values),
  });
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async (statements) => (await db.batch(statements.map((s) => s.statement ?? s))).map(record),
  };
}

export default {
  async fetch(_request, env) {
    const log = [];
    const bindings = { ...env, DB: metered(env.DB, log), JOBS: { send: async () => {}, sendBatch: async () => {} }, BOOKING_COORDINATOR: {} };
    const services = createServices(bindings.DB, parseRuntimeEnvironment(bindings), { fetch: async () => new Response("") }, { files: {} });
    await runScheduledWork(bindings, services);
    return Response.json({ rowsRead: log.reduce((sum, rows) => sum + rows, 0) });
  },
};
