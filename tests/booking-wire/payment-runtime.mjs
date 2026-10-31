import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { unstable_getMiniflareWorkerOptions, unstable_splitSqlQuery as splitSqlQuery } from "wrangler";

const require = createRequire(import.meta.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(pathToFileURL(require.resolve("miniflare")));

/** The same native Worker and bindings, served without Wrangler's dev proxy. */
export async function startPaymentRuntime({ state, port, origin, capture = console.log }) {
  const { workerOptions, main, define } = unstable_getMiniflareWorkerOptions("tests/booking-wire/worker.wrangler.toml");
  const compiled = await build({ entryPoints: [main], define, bundle: true, format: "esm", platform: "browser", external: ["node:*", "cloudflare:workers"], write: false });
  class PaymentLog extends Log { log(message) { capture(message); } }
  const runtime = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1", port, cf: false, log: new PaymentLog(LogLevel.INFO), workers: [{
      name: "dial-booking-wire-test", compatibilityDate: workerOptions.compatibilityDate, compatibilityFlags: workerOptions.compatibilityFlags,
      d1Databases: workerOptions.d1Databases, r2Buckets: workerOptions.r2Buckets,
      queueProducers: workerOptions.queueProducers, durableObjects: workerOptions.durableObjects,
      modules: true, modulesRoot: state,
      script: compiled.outputFiles[0].text, bindings: { ...workerOptions.bindings, APP_URL: origin },
    }],
  }));
  try {
    const db = await runtime.getD1Database("DB");
    const folder = new URL("../../migrations/core/", import.meta.url);
    for (const name of (await readdir(folder)).filter(name => name.endsWith(".sql")).sort()) {
      await db.batch(splitSqlQuery(await readFile(new URL(name, folder), "utf8")).map(sql => db.prepare(sql)));
    }
    return runtime;
  } catch (error) { await runtime.dispose(); throw error; }
}
