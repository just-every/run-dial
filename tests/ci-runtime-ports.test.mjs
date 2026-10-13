import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { fixturePortRanges, parsePortRanges, mergeReservedPorts, assertFixturePortsReserved } from "../scripts/ci-runtime-ports.mjs";

test("CI runtime reservations preserve runner ports and refuse incomplete or invalid configuration", () => {
  const existing = "80,20000-20002,42000,65535\n";
  const combined = mergeReservedPorts(existing);
  assertFixturePortsReserved(combined);
  for (const port of [80, 20000, 20001, 20002, 65535]) assert.ok(parsePortRanges(combined).has(port));
  assert.equal(mergeReservedPorts(combined), combined, "repeated setup preserves exactly the same reservations");
  assert.equal(mergeReservedPorts("0"), `0,${fixturePortRanges}`, "the runner's reserved bit zero is preserved");
  assert.equal(mergeReservedPorts("0-1023"), `0-1023,${fixturePortRanges}`, "zero-start runner ranges are preserved");
  assert.equal(mergeReservedPorts("1-65535"), "1-65535", "large runner ranges stay compact for the sysctl write");
  assert.equal(mergeReservedPorts("0-65535"), "0-65535", "the full Linux reserved-port bitmap stays compact");
  assert.throws(() => assertFixturePortsReserved("15700-15739,41868,41890,42001"), /42000/);
  for (const value of ["-1", "65536", "42001-42000", "42000,,42001", "42000;other", "42000-NaN"]) {
    assert.throws(() => mergeReservedPorts(value), /Invalid reserved port range/);
  }
});

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.name.endsWith(".mjs")) files.push(path);
  }
  return files;
}

function startsNativeProcess(source) {
  // Skip comments and string fixtures; only process call sites select a source.
  const tokens = /("(?:\\[\s\S]|[^"\\\r\n])*"|'(?:\\[\s\S]|[^'\\\r\n])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*)|\b(?:spawn|spawnOwned)\s*\(/g;
  for (const match of source.matchAll(tokens)) if (!match[1]) return true;
  return false;
}

function assertDeclaredPortsReserved(source, reserved, file, observed = new Set()) {
  if (!startsNativeProcess(source)) return observed;
  // The harness declares listener ports as literal CLI arguments, inspector
  // environment values, or a constant used for --port and the health origin.
  for (const pattern of [
    /"--(?:inspector-)?port",\s*"(\d+)"/g,
    /DIAL_INSPECTOR_PORT:\s*"(\d+)"/g,
    /const port = (?:String\()?(\d+)\)?;/g,
    /http:\/\/127\.0\.0\.1:(\d+)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      const port = Number(match[1]); observed.add(port);
      assert.ok(reserved.has(port), `${file.pathname} declares unreserved native port ${port}`);
    }
  }
  return observed;
}

test("CI discovers listener declarations using the maintained owned-process helper", async () => {
  const file = new URL("./operator-removal-mail/runtime.mjs", import.meta.url);
  const source = await readFile(file, "utf8");
  assert.match(source, /\bspawnOwned\s*\(/);
  const declaredPort = Number(/"--port",\s*"(\d+)"/.exec(source)[1]);
  const observed = assertDeclaredPortsReserved(source, parsePortRanges(fixturePortRanges), file);
  assert.ok(observed.has(declaredPort), "owned-process listener declaration was not discovered");
});

test("CI refuses an unreserved listener from either native process starter", () => {
  const reserved = parsePortRanges(fixturePortRanges);
  for (const starter of ["spawn", "spawnOwned"]) {
    const source = `${starter}("pnpm", ["exec", "vite", "--port", "61000"]);`;
    assert.throws(() => assertDeclaredPortsReserved(source, reserved, new URL("file:///native-listener.mjs")), /declares unreserved native port 61000/);
  }
});

test("CI ignores URL fixture data without a native process start", () => {
  const source = `
    import { spawnOwned } from "./native-process/lifecycle.mjs";
    const origin = "http://127.0.0.1:61000";
    const example = 'spawn("pnpm", ["--port", "61000"])';
    // spawnOwned("pnpm", ["--port", "61000"]);
    /* spawn("pnpm", ["--port", "61000"]); */
  `;
  assert.deepEqual(assertDeclaredPortsReserved(source, parsePortRanges(fixturePortRanges), new URL("file:///url-fixture.mjs")), new Set());
});

test("CI discovers the occurrence mail-duration inspector listener", async () => {
  const file = new URL("./occurrence-mail-duration.test.mjs", import.meta.url);
  const source = await readFile(file, "utf8");
  assert.match(source, /"--inspector-port",\s*"15765"/);
  const reserved = new Set([...parsePortRanges(fixturePortRanges), 15765]);
  const observed = assertDeclaredPortsReserved(source, reserved, file);
  assert.ok(observed.has(15765), "occurrence mail-duration inspector declaration was not discovered");
});

test("CI refuses a reservation set missing only the mail-duration inspector listener", () => {
  const expected = new Set([...parsePortRanges(fixturePortRanges), 15765]);
  const withoutInspector = new Set([...expected].filter((port) => port !== 15765));
  const missing = [...expected].filter((port) => !withoutInspector.has(port));
  assert.deepEqual(missing, [15765]);
  assert.throws(() => assertFixturePortsReserved([...withoutInspector].join(",")), /15765/);
});

test("CI excludes every declared native fixture and inspector listener before pnpm verify", async () => {
  const reserved = parsePortRanges(fixturePortRanges);
  const files = [...await sourceFiles(new URL("./", import.meta.url)), ...await sourceFiles(new URL("../scripts/", import.meta.url))];
  const observed = new Set();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assertDeclaredPortsReserved(source, reserved, file, observed);
  }
  for (const port of [15700, 15739, 15765, 41868, 41890, 42000, 42001]) assert.ok(observed.has(port), `listener discovery missed ${port}`);
  const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  const setup = workflow.indexOf('ports="$(node scripts/ci-runtime-ports.mjs)"');
  const apply = workflow.indexOf('sudo sysctl -w "net.ipv4.ip_local_reserved_ports=$ports"');
  const check = workflow.indexOf("node scripts/ci-runtime-ports.mjs --check");
  assert.ok(setup > 0 && apply > setup && check > apply && check < workflow.indexOf("- run: pnpm install"));
  assert.match(workflow, /runs-on: ubuntu-latest/);
});
