#!/usr/bin/env node
import { runBenchmark } from "./dial-capacity/benchmark.mjs";
import { runIsolatedCapacityBenchmark } from "./dial-capacity/local-benchmark.mjs";
import { seedLocalBookings } from "./dial-capacity/seed.mjs";

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "seed") {
    const databasePath = option(args, "--database");
    const result = await seedLocalBookings(databasePath);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } else if (command === "bench") {
    const origin = option(args, "--origin");
    const runs = Number(option(args, "--runs") ?? 20);
    const result = await runBenchmark({ origin, runs });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === "local-bench") {
    const runs = Number(option(args, "--runs") ?? 20);
    const result = await runIsolatedCapacityBenchmark(runs);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    throw new Error("Usage: stop the local app with `node scripts/rer.mjs dev --stop`, then run `node scripts/dial-capacity-seed.mjs seed`; restart the app and run `node scripts/dial-capacity-seed.mjs bench --origin <loopback-origin> [--runs 20]`. For an isolated synthetic local D1 HTTP benchmark, run `node scripts/dial-capacity-seed.mjs local-bench [--runs 20]`.");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  return value;
}
