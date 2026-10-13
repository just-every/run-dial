import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Use the same native runtime already installed with the deployment toolchain.
const require = createRequire(import.meta.resolve("wrangler"));
const { Miniflare } = await import(pathToFileURL(require.resolve("miniflare")));
const senderUrl = "https://api.sendgrid.com/v3/verified_senders";
const domainUrl = "https://api.sendgrid.com/v3/whitelabel/domains?limit=100&offset=0";

test("NOTIFY-006 native Workers fetch checks authenticated domains and refuses redirects without forwarding credentials", async () => {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL("./mail-readiness/worker.mjs", import.meta.url))], bundle: true, format: "esm", platform: "browser", write: false });
  const state = await mkdtemp(join(tmpdir(), "dial-mail-readiness-"));
  const calls = [];
  let redirectAt;
  let redirectStatus;
  let worker;
  try {
    worker = new Miniflare({ cf: false, resourcePersistencePath: state, workers: [{
      config: { type: "worker", name: "mail-readiness", compatibilityDate: "2026-09-08", compatibilityFlags: ["nodejs_compat"],
        manifest: { mainModule: "worker.mjs", modulesRoot: state, modules: { "worker.mjs": { type: "esm", contents: compiled.outputFiles[0].text } } },
      },
      dev: { outboundService: { type: "fetcher", handler: async (request) => {
        calls.push({ url: request.url, method: request.method, authorization: request.headers.get("authorization") });
        if (request.url === redirectAt) return new Response(null, { status: redirectStatus, headers: { location: "https://untrusted.example/collect" } });
        if (request.url === senderUrl) return Response.json({ results: [{ from_email: "another@business.example", verified: true }] });
        if (request.url === domainUrl) return Response.json([{ domain: "business.example", valid: true }]);
        return new Response("Unexpected provider request", { status: 500 });
      } } },
    }] });
    const expectedCall = (url) => ({ url, method: "GET", authorization: "Bearer synthetic-readiness-key" });
    const ready = await worker.dispatchFetch("https://readiness.test/");
    assert.equal(ready.status, 200);
    assert.ok(Number.isFinite(Date.parse((await ready.json()).checkedAt)));
    assert.deepEqual(calls, [senderUrl, domainUrl].map(expectedCall));

    for (redirectAt of [senderUrl, domainUrl]) {
      for (redirectStatus of [301, 302, 303, 307, 308]) {
        calls.length = 0;
        const refused = await worker.dispatchFetch("https://readiness.test/");
        assert.equal(refused.status, 503);
        assert.deepEqual(await refused.json(), { code: "provider_unavailable", retryable: false });
        assert.deepEqual(calls, (redirectAt === senderUrl ? [senderUrl] : [senderUrl, domainUrl]).map(expectedCall), "no redirect destination, retry or mail send receives the credential");
      }
    }
  } finally {
    try { await worker?.dispose(); }
    finally { await rm(state, { recursive: true, force: true }); }
  }
});
