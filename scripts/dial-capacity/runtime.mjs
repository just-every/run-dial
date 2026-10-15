import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.resolve("wrangler"));
const { Miniflare } = await import(pathToFileURL(require.resolve("miniflare")));
const migrationsRoot = new URL("../../migrations/", import.meta.url);

export async function compileCapacityWorker() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../../tests/move-in/booking-worker.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    external: ["node:*", "cloudflare:workers"],
    write: false,
  });
  return result.outputFiles[0].text;
}

export async function startCapacityRuntime({ persistDirectory, workerModule, cookie, deferSearchMigration = false }) {
  const port = await reserveLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const variables = {
    OWNER_EMAIL: "operator@dial.test",
    MAIL_FROM: "no-reply@dial.test",
    SETUP_TOKEN: "synthetic-dial-capacity-test-setup-token-at-least-32",
    ENVIRONMENT: "development",
    APP_URL: origin,
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-secret",
    CALENDAR_WEBHOOK_SECRET: "synthetic-calendar-webhook-secret-for-test-only",
    SESSION_SECRET: "synthetic-dial-booking-wire-synthetic-local-session-secret",
    MAIL_PROVIDER: "sendgrid",
    MAIL_API_KEY: "wire-mail-key",
    MAIL_WEBHOOK_KEY: "test-only-wire-webhook-key",
  };
  const mf = new Miniflare({
    host: "127.0.0.1",
    port,
    cf: false,
    resourcePersistencePath: join(persistDirectory, "v3"),
    workers: [{
      config: {
        type: "worker",
        name: "dial-capacity",
        compatibilityDate: "2026-09-08",
        compatibilityFlags: ["nodejs_compat"],
        env: {
          DB: { type: "d1", id: "dial-capacity" },
          FILES: { type: "r2", name: "files" },
          JOBS: { type: "queue", name: "jobs" },
          BOOKING_COORDINATOR: { type: "durable-object", worker: "dial-capacity", exportName: "BookingCoordinator" },
          ...Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, { type: "text", value }])),
        },
        exports: { BookingCoordinator: { type: "durable-object", storage: "sqlite" } },
        manifest: {
          mainModule: "worker.mjs",
          modulesRoot: persistDirectory,
          modules: { "worker.mjs": { type: "esm", contents: workerModule } },
        },
      },
      dev: { outboundService: { type: "fetcher", handler: () => { throw new Error("Unexpected external network call from the local capacity runtime."); } } },
    }],
  });

  try {
    const db = await mf.getD1Database("DB");
    const api = (path, init = {}) => fetch(`${origin}${path}`, {
      redirect: "manual",
      ...init,
      headers: { origin, host: new URL(origin).host, ...(cookie ? { cookie } : {}), ...init.headers },
    });

    if (cookie) {
      assert.equal((await api("/auth/session")).status, 200, "the native operator session survives the persisted D1 restart");
    } else {
      await applyMigrations(db, deferSearchMigration);
      const bootstrap = await api("/auth/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: variables.SETUP_TOKEN, displayName: "Capacity test owner", returnTo: "/app" }),
      });
      assert.equal(bootstrap.status, 303, "native synthetic owner bootstrap");
      cookie = bootstrap.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie, "native bootstrap returns a session cookie");
      await postJson(api, "/wire/init", {});
      await postJson(api, "/__fixtures/setup", {});
    }

    return {
      origin,
      cookie,
      db,
      async close() { await mf.dispose(); },
    };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}

async function applyMigrations(db, deferSearchMigration) {
  for (const folder of ["core", "ext"]) {
    const directory = new URL(`${folder}/`, migrationsRoot);
    const names = await readdir(directory).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
    for (const name of names.filter((entry) => entry.endsWith(".sql")).sort()) {
      if (deferSearchMigration && name === "0033_booking_search.sql") continue;
      const statements = splitSqlQuery(await readFile(new URL(name, directory), "utf8"));
      await db.batch(statements.map((statement) => db.prepare(statement)));
    }
  }
}

async function postJson(api, path, body) {
  const response = await api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `${path} succeeds in the local synthetic runtime`);
}

async function reserveLoopbackPort() {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return port;
}

export async function applyBookingSearchMigration(db) {
  const statements = splitSqlQuery(await readFile(new URL("core/0033_booking_search.sql", migrationsRoot), "utf8"));
  await db.batch(statements.map(statement => db.prepare(statement)));
}
