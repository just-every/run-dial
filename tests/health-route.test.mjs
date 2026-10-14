import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

const bundle = await build({
  entryPoints: [new URL("../src/core/app/hono.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  plugins: [{
    name: "cloudflare-worker-test-binding",
    setup(builder) {
      builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "workers", namespace: "worker-test-binding" }));
      builder.onLoad({ filter: /.*/, namespace: "worker-test-binding" }, () => ({
        contents: "export const env = {}; export class DurableObject {}",
        loader: "js",
      }));
    },
  }],
});
const { createApp } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const app = createApp();
const deployment = {
  RER_DEPLOY_SOURCE: randomBytes(20).toString("hex"),
  RER_DEPLOY_FINGERPRINT: randomUUID(),
  RER_VERSION: { id: randomUUID() },
};

function healthFixture(t, { databaseUnavailable = false, storageHead, queueSend } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  if (databaseUnavailable) sqlite.close();
  else t.after(() => sqlite.close());
  const queueMessages = [];
  const env = {
    ENVIRONMENT: "production",
    APP_URL: "https://dial.example.test",
    SESSION_SECRET: "health-route-test-secret-with-more-than-thirty-two-bytes",
    DB: {
      prepare(sql) {
        return {
          async run() {
            return sqlite.prepare(sql).run();
          },
        };
      },
    },
    FILES: {
      async head(key) {
        return storageHead ? storageHead(key) : null;
      },
    },
    JOBS: {
      async send(message) {
        queueMessages.push(message);
        return queueSend?.(message);
      },
    },
    ...deployment,
  };
  return { env, queueMessages };
}

async function healthResponse(env) {
  return app.fetch(
    new Request("https://dial.example.test/health"),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function assertDeployment(body) {
  assert.deepEqual(body.deployment, {
    sourceSha: deployment.RER_DEPLOY_SOURCE,
    fingerprint: deployment.RER_DEPLOY_FINGERPRINT,
    versionId: deployment.RER_VERSION.id,
  });
}

async function assertHealth(env, checks, name, { quick = false, delayed = false } = {}) {
  const started = performance.now();
  const response = await healthResponse(env);
  const elapsed = performance.now() - started;
  const body = await response.json();
  const healthy = Object.values(checks).every(check => check === "ok");

  assert.ok(elapsed < 15_000, `${name}: health exceeded the bounded response window: ${elapsed.toFixed(1)}ms`);
  if (quick) assert.ok(elapsed < 1_000, `${name}: healthy platform probes should remain quick: ${elapsed.toFixed(1)}ms`);
  if (delayed) assert.ok(elapsed > 1_000, `${name}: Queue must settle after the former health deadline`);
  assert.equal(response.status, healthy ? 200 : 503, name);
  assert.deepEqual(body.checks, checks, name);
  assert.equal(body.status, healthy ? "ok" : "unavailable", name);
  assert.equal(body.ok, healthy, name);
  assertDeployment(body);
}

contract("BASE-OPS-001", "the public health route reports Queue readiness with independent D1 and R2 outcomes and deployment identity", async t => {
  const healthy = { database: "ok", storage: "ok", queue: "ok" };
  const scenarios = [
    { name: "immediate providers", checks: healthy, quick: true },
    {
      name: "delayed Queue", checks: healthy, delayed: true,
      fixture: { queueSend: () => new Promise(resolve => setTimeout(resolve, 1_200)) },
    },
    {
      name: "unavailable D1", checks: { ...healthy, database: "unavailable" },
      fixture: { databaseUnavailable: true },
    },
    {
      name: "rejected R2", checks: { ...healthy, storage: "unavailable" },
      fixture: { storageHead: async () => { throw new Error("storage_unavailable"); } },
    },
    {
      name: "rejected Queue", checks: { ...healthy, queue: "unavailable" },
      fixture: { queueSend: async () => { throw new Error("queue_unavailable"); } },
    },
    { name: "missing Queue", checks: { ...healthy, queue: "unavailable" }, missingQueue: true },
    {
      name: "stuck Queue", checks: { ...healthy, queue: "unavailable" },
      fixture: { queueSend: () => new Promise(() => {}) },
    },
  ];
  for (const scenario of scenarios) {
    const fixture = healthFixture(t, scenario.fixture);
    if (scenario.missingQueue) fixture.env.JOBS = undefined;
    await assertHealth(fixture.env, scenario.checks, scenario.name, scenario);
    assert.deepEqual(fixture.queueMessages, scenario.missingQueue ? [] : [{ kind: "health" }], scenario.name);
  }
});
