import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { unstable_getMiniflareWorkerOptions, unstable_splitSqlQuery as splitSqlQuery } from "wrangler";

const require = createRequire(import.meta.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(require.resolve("miniflare")));

export async function startWebhookRuntime({ state, port, origin, receiver }) {
  const { workerOptions, main, define } = unstable_getMiniflareWorkerOptions("tests/booking-wire/worker.wrangler.toml");
  const compiled = await build({ entryPoints: [main], define, bundle: true, format: "esm", platform: "browser", external: ["node:*", "cloudflare:workers"], write: false });
  const runtime = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port, cf: false, workers: [{
    name: "dial-booking-wire-test", compatibilityDate: workerOptions.compatibilityDate, compatibilityFlags: workerOptions.compatibilityFlags,
    d1Databases: workerOptions.d1Databases, r2Buckets: workerOptions.r2Buckets, queueProducers: workerOptions.queueProducers, durableObjects: workerOptions.durableObjects,
    modules: true, modulesRoot: state, script: compiled.outputFiles[0].text,
    bindings: { ...workerOptions.bindings, APP_URL: origin, WEBHOOK_DEFAULT_TRANSPORT: "1" },
    // Native Worker fetch reaches this network edge before any receiver routing.
    outboundService: async request => {
      const url = new URL(request.url);
      const path = url.hostname === "cloudflare-dns.com" ? "/__dns" : url.hostname === "receiver.synthetic.test" ? url.pathname : undefined;
      if (!path) throw new Error("Unexpected webhook egress");
      try { return await fetch(`http://127.0.0.1:${receiver}${path}${url.search}`, {
        method: request.method, headers: request.headers, redirect: "manual", signal: request.signal,
        ...(!["GET", "HEAD"].includes(request.method) ? { body: await request.arrayBuffer() } : {}),
      }); } catch (error) { console.error("WEBHOOK_EGRESS_ERROR", request.method, url.hostname, String(error), String(error.cause)); throw error; }
    },
  }] }));
  try {
    const db = await runtime.getD1Database("DB");
    const folder = new URL("../../migrations/core/", import.meta.url);
    for (const name of (await readdir(folder)).filter(name => name.endsWith(".sql")).sort()) {
      await db.batch(splitSqlQuery(await readFile(new URL(name, folder), "utf8")).map(sql => db.prepare(sql)));
    }
    return runtime;
  } catch (error) { await runtime.dispose(); throw error; }
}
