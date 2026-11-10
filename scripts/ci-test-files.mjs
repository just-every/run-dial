import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const shardCount = 22;

const root = fileURLToPath(new URL("../", import.meta.url));
// Native fixtures bind literal loopback ports: the 15700-15899 fixture block (the Vite or
// wrangler port and its inspector, review and webhook receiver ports) and the 4xxxx native
// runtimes listed in scripts/ci-runtime-ports.mjs. 8787 is not here: it only appears as an
// APP_URL or Host string, or as a DIAL_PORT default that every caller overrides.
const fixedPort = /(?<![\d.-])(15[78]\d\d|4[12]\d{3})(?![\d-])/g;
const reference = /["'`]([^"'`\s${}]+\.(?:mjs|js|ts|toml))["'`]/g;

// The fixed ports a test file binds, read from the file and from every repo file it names
// (imports, "scripts/verify-*.mjs" journeys, wrangler configs), however deep the chain.
async function fixedPorts(file) {
  const seen = new Set(), ports = new Set(), queue = [resolve(root, file)];
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(fixedPort)) ports.add(match[1]);
    for (const match of text.matchAll(reference)) {
      for (const candidate of [resolve(dirname(path), match[1]), resolve(root, match[1])]) {
        if (candidate.startsWith(root) && !relative(root, candidate).startsWith("node_modules") && await readFile(candidate).then(() => true, () => false)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return ports;
}

export async function testPartitions() {
  const files = (await readdir(new URL("../tests/", import.meta.url)))
    .filter(file => file.endsWith(".test.mjs")).sort().map(file => `tests/${file}`);
  // The README journey installs independent checkouts. The ordered Cron journey
  // waits for real minute boundaries (18m27s in Verify 38785418970); it cannot fit
  // a 15-minute push job. Both run unchanged nightly, on tags and on demand.
  const journeys = {
    installer: ["tests/local-setup-journey.test.mjs"],
    cron: ["tests/lifecycle-journey.test.mjs"],
  };
  // Keep the longest public and host browser journeys on their own runners.
  // The independent booking-record journey used to run after the public journey
  // in shard 0; give it the non-browser shard 6 instead of serialising both.
  // Discover every remaining file, including new tests, rather than maintain an allowlist.
  const shards = Array.from({ length: shardCount }, () => []);
  shards[0].push("tests/booking-axe.test.mjs");
  shards[1].push("tests/host-setup-journey.test.mjs");
  shards[6].push("tests/booking-record.test.mjs");
  const dedicated = [...Object.values(journeys).flat(), ...shards.flat()];
  for (const file of dedicated) if (!files.includes(file)) throw new Error(`Missing CI test file: ${file}`);
  // A shard runs two files at once (--test-concurrency=2), so two files that bind the same
  // fixed port must never share one: the later server never starts, its health poll reaches the
  // earlier file's server, and the journey fails on someone else's state (a 409 on
  // /auth/bootstrap). Round-robin as before, but a file whose ports a shard already holds moves
  // on to the next shard that does not.
  const held = shards.map(() => new Set());
  for (const [index, shard] of shards.entries()) for (const file of shard) for (const port of await fixedPorts(file)) held[index].add(port);
  const roundRobin = shardCount - 2;
  for (const [index, file] of files.filter(file => !dedicated.includes(file)).entries()) {
    const ports = [...await fixedPorts(file)];
    const offset = Array.from({ length: roundRobin }, (_, step) => (index + step) % roundRobin).find(slot => ports.every(port => !held[2 + slot].has(port)));
    if (offset === undefined) throw new Error(`No CI shard is free of ${ports.join(", ")} for ${file}`);
    shards[2 + offset].push(file);
    for (const port of ports) held[2 + offset].add(port);
  }
  const selected = [...shards.flat(), ...Object.values(journeys).flat()];
  if (new Set(selected).size !== files.length || selected.length !== files.length) {
    throw new Error("CI test partitions must cover every test file exactly once");
  }
  return { shards, journeys };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(await testPartitions(), null, 2));
}
