import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

let native;
let bundleDirectory;
async function implementation() {
  native ??= build({ entryPoints: [new URL("./native.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm",
    plugins: [{ name: "deny-unrelated-worker-bindings", setup(builder) {
      // App composition imports the booking notification boundary. Sign-in must
      // never use its Worker globals; fail if this test-only binding is touched.
      builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "bindings", namespace: "signin-test" }));
      builder.onLoad({ filter: /.*/, namespace: "signin-test" }, () => ({ contents: "export const env = new Proxy({}, { get() { throw new Error('Unexpected Worker global binding in sign-in'); } });", loader: "js" }));
    } }],
  })
    .then(async result => {
      bundleDirectory = await mkdtemp(join(tmpdir(), "dial-signin-privacy-"));
      const file = join(bundleDirectory, "native.mjs");
      await writeFile(file, result.outputFiles[0].text);
      return import(pathToFileURL(file).href);
    });
  return native;
}
export async function closeImplementation() { if (bundleDirectory) await rm(bundleDirectory, { recursive: true, force: true }); }

export const local = {
  ENVIRONMENT: "development", APP_URL: "http://127.0.0.1:8787", OWNER_EMAIL: "owner@example.test",
  SESSION_SECRET: "test-signin-session-secret-at-least-32-characters", SETUP_TOKEN: "test-signin-setup-token-at-least-32-characters",
  MAIL_PROVIDER: "development", MAIL_FROM: "noreply@example.test",
};
export const deployed = { ...local, ENVIRONMENT: "production", APP_URL: "https://dial.example.test", MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "test-only-provider-key" };
export const endpoints = ["/api/auth/magic-links", "/auth/magic-link"];
export const unknown = "unknown@example.test";
export function expectedBody(path, runtime) {
  return { status: path === "/auth/magic-link" ? "accepted" : runtime.MAIL_PROVIDER === "development" ? "open_local_outbox" : "check_your_email" };
}
export async function wire(response) {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
}
export function code(response) { return typeof response.body.error === "string" ? response.body.error : response.body.error?.code; }

function d1(sqlite) {
  function statement(sql, args = []) {
    function rows() {
      const query = sqlite.prepare(sql);
      const results = query.columns().length ? query.all(...args) : (query.run(...args), []);
      return { success: true, results, meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n } };
    }
    return { bind: (...values) => statement(sql, values), first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => rows(), run: async () => rows(), raw: async () => rows().results.map(row => Object.values(row)) };
  }
  return { prepare: statement, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const item of statements) results.push(await item.all()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}

export async function fixture(runtime = deployed, sender) {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../../migrations/core/", import.meta.url);
    for (const file of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(await readFile(new URL(file, migrations), "utf8"));
    const db = d1(sqlite);
    const { app, operators } = (await implementation()).nativeApplication(db, runtime, sender);
    const env = { ...runtime, DB: db, JOBS: { send: async () => assert.fail("sign-in scheduled a delivery job") } };
    const pending = [];
    const context = { waitUntil(promise) { pending.push(promise); }, passThroughOnException() {} };
    function request(path, body, options = {}) {
      const headers = new Headers({ host: new URL(runtime.APP_URL).host, origin: runtime.APP_URL, "cf-connecting-ip": "198.18.0.2", "content-type": "application/json" });
      for (const [name, value] of Object.entries(options.headers ?? {})) { if (value === null) headers.delete(name); else headers.set(name, value); }
      return new Request(runtime.APP_URL + path, { method: options.method ?? (body === undefined ? "GET" : "POST"), headers, ...(body === undefined ? {} : { body: options.rawBody ?? JSON.stringify(body) }) });
    }
    async function send(path, body, options) {
      const response = await app.fetch(request(path, body, options), env, context);
      await Promise.all(pending.splice(0));
      return response;
    }
    const bootstrap = await send("/auth/bootstrap", { token: runtime.SETUP_TOKEN, displayName: "Owner" });
    assert.equal(bootstrap.status, 303);
    return { sqlite, db, operators, request, send, close: () => sqlite.close(), sessions: () => sqlite.prepare("SELECT count(*) AS n FROM oa_sessions").get().n };
  } catch (error) { sqlite.close(); throw error; }
}

export function failingSender(result) {
  const tokens = [];
  return { tokens, sender: { async send(message) {
    const url = message.text.match(/https?:\/\/[^\s]+/)[0];
    tokens.push(new URL(url).searchParams.get("token"));
    if (result === "throw") throw new Error("synthetic provider transport failure");
    return result === "missing" ? undefined : { status: result, provider: "test-only", providerMessageId: null };
  } } };
}
