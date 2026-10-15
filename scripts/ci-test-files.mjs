import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const shardCount = 8;

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
  // Keep the two longest ordinary browser files on their own runners. Discover
  // every remaining file, including new tests, rather than maintain an allowlist.
  const shards = Array.from({ length: shardCount }, () => []);
  shards[0].push("tests/booking-axe.test.mjs");
  shards[1].push("tests/host-setup-journey.test.mjs");
  const dedicated = [...Object.values(journeys).flat(), ...shards.flat()];
  for (const file of dedicated) if (!files.includes(file)) throw new Error(`Missing CI test file: ${file}`);
  files.filter(file => !dedicated.includes(file)).forEach((file, index) => {
    shards[2 + index % (shardCount - 2)].push(file);
  });
  const selected = [...shards.flat(), ...Object.values(journeys).flat()];
  if (new Set(selected).size !== files.length || selected.length !== files.length) {
    throw new Error("CI test partitions must cover every test file exactly once");
  }
  return { shards, journeys };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(await testPartitions(), null, 2));
}
