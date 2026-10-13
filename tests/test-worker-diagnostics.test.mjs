import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const preload = fileURLToPath(new URL("../scripts/test-worker-diagnostics.mjs", import.meta.url));
const monitorScript = fileURLToPath(new URL("../scripts/monitor-test-workers.mjs", import.meta.url));

test("CI snapshots reveal a worker with live resources while later file results remain buffered", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dial-worker-diagnostics-"));
  const snapshots = resolve(directory, "snapshots");
  let runner, monitor;
  try {
    const first = resolve(directory, "a.test.mjs"), second = resolve(directory, "b.test.mjs");
    await writeFile(first, 'import test from "node:test"; test("first completes with a live timer", () => { setInterval(() => {}, 1000); });\n');
    await writeFile(second, 'import test from "node:test"; test("later file completes", () => {});\n');
    const environment = { ...process.env, NODE_OPTIONS: "", DIAL_TEST_DIAGNOSTICS_DIR: snapshots };
    delete environment.NODE_TEST_CONTEXT;
    runner = spawn(process.execPath, ["--import", preload, "--test", "--test-concurrency=2", first, second], { env: environment, detached: true, stdio: "pipe" });
    let reported = "";
    runner.stdout.on("data", (chunk) => { reported += chunk; }); runner.stderr.on("data", (chunk) => { reported += chunk; });
    const values = await until(async () => {
      const files = await readdir(snapshots).catch(() => []);
      const values = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => JSON.parse(await readFile(resolve(snapshots, file), "utf8"))));
      return values.some((value) => value.file.endsWith("a.test.mjs") && value.phase === "root-teardown" && value.resources.includes("Timeout")) && values.some((value) => value.file.endsWith("b.test.mjs") && value.phase === "exited") ? values : undefined;
    });
    await until(() => reported.includes("first completes with a live timer"));
    const held = values.find((value) => value.file.endsWith("a.test.mjs"));
    assert.ok(held.resources.includes("Timeout"), "the live test timer is observable");
    assert.equal(runner.exitCode, null, "the test runner remains held by its first worker");
    assert.doesNotMatch(reported, /later file completes/, "later file success is buffered by Node");
    monitor = spawn(process.execPath, [monitorScript], { env: environment, stdio: "pipe" });
    let observable = "";
    monitor.stdout.on("data", (chunk) => { observable += chunk; }); monitor.stderr.on("data", (chunk) => { observable += chunk; });
    await until(() => observable.includes("a.test.mjs") && observable.includes("b.test.mjs"));
    assert.match(observable, /"phase":"root-teardown"/);
    assert.match(observable, /"phase":"exited"/);
    assert.doesNotMatch(observable, /NODE_OPTIONS|DIAL_TEST_DIAGNOSTICS_DIR/, "snapshots contain no environment values");
  } finally {
    await stop(monitor, false);
    await stop(runner, true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostic preload is inert in runtime children inheriting native worker environment", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dial-worker-inert-"));
  try {
    const child = spawn(process.execPath, ["--import", preload, "--input-type=module", "-e", 'console.log("ordinary command")'], { env: { ...process.env, NODE_OPTIONS: "", NODE_TEST_CONTEXT: "child-v8", DIAL_TEST_DIAGNOSTICS_DIR: directory }, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
    const [code] = await once(child, "close");
    assert.equal(code, 0); assert.equal(output, "ordinary command\n");
    assert.deepEqual(await readdir(directory), [], "an ordinary runtime child writes no diagnostic snapshot");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function until(probe) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { const result = await probe(); if (result) return result; await new Promise((done) => setTimeout(done, 20)); }
  throw new Error("Diagnostic regression did not reach its expected observable phase");
}

async function stop(child, group) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  if (group) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM");
  await closed;
}
