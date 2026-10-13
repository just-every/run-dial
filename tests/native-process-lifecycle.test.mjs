import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { spawnOwned } from "./native-process/lifecycle.mjs";
import { liveGroupMembers, signalOwnedGroup } from "./native-process/group.mjs";

const fixture = new URL("./native-process/fixtures/process.mjs", import.meta.url).pathname;
function launch(context, mode) {
  let output = "";
  const phases = [];
  const owned = spawnOwned(process.execPath, [fixture, mode], {}, { label: `fixture ${mode}`, onOutput: (chunk) => { output += chunk; }, onPhase: (event) => phases.push(event.phase) });
  context.after(async () => { await owned.stop().catch(() => {}); });
  return { owned, phases, output: () => output };
}
async function ready(output) {
  const deadline = Date.now() + 3000;
  while (!output().includes("ready")) {
    assert.ok(Date.now() < deadline, "OS fixture readiness deadline");
    await delay(10);
  }
}

for (const mode of ["signal-parent", "numeric-parent"]) {
  test(`cleanup after already emitted ${mode} exit closes owned descendants and pipes`, async (context) => {
    const { owned, phases, output } = launch(context, mode);
    await owned.exited;
    assert.equal(owned.state.closed, false, "descendant holds the parent's stderr open beyond direct exit");
    assert.equal(owned.child.exitCode, mode === "signal-parent" ? null : 7);
    assert.equal(owned.child.signalCode, mode === "signal-parent" ? "SIGTERM" : null);
    assert.throws(() => owned.assertRunning(), /exited before readiness/);
    assert.match(output(), /descendant=\d+/);
    assert.ok((await liveGroupMembers(owned.child.pid)).length > 0);
    await owned.stop();
    await owned.closed;
    assert.equal(owned.state.closed, true);
    assert.deepEqual(await liveGroupMembers(owned.child.pid), []);
    assert.ok(phases.indexOf("exit") < phases.indexOf("stop"));
    assert.ok(phases.indexOf("close") < phases.indexOf("stopped"));
    assert.equal(owned.child.stdout.destroyed, true);
    await owned.stop(); // Cached completion cannot await a second exit event.
  });
}

test("normal shutdown and fresh restart leave an unrelated sentinel running", async (context) => {
  const sentinel = launch(context, "descendant");
  await ready(sentinel.output);
  for (let iteration = 0; iteration < 2; iteration++) {
    const { owned, output } = launch(context, "descendant");
    await ready(output); owned.assertRunning();
    await owned.stop();
    assert.equal(owned.child.signalCode, "SIGTERM");
    assert.deepEqual(await liveGroupMembers(owned.child.pid), []);
    sentinel.owned.assertRunning();
    process.kill(sentinel.owned.child.pid, 0);
  }
  await sentinel.owned.stop();
});

test("SIGTERM refusal is bounded, SIGKILL cleans the group, and cleanup reports failure", async (context) => {
  const { owned, output, phases } = launch(context, "ignore");
  await ready(output);
  const started = Date.now();
  await assert.rejects(owned.stop({ graceMs: 100, killMs: 1000 }), /cleanup required SIGKILL/);
  assert.ok(Date.now() - started < 2500);
  assert.equal(owned.child.signalCode, "SIGKILL");
  assert.equal(owned.state.closed, true);
  assert.deepEqual(await liveGroupMembers(owned.child.pid), []);
  assert.ok(phases.includes("kill"));
  assert.equal(owned.child.stderr.destroyed, true);
  await assert.rejects(owned.stop(), /cleanup required SIGKILL/);
});

test("spawn failure and completed command close are captured before late callers", async () => {
  const missing = spawnOwned("/nonexistent/dial-native-process-fixture", [], {}, { label: "missing command" });
  await missing.closed;
  assert.throws(() => missing.assertRunning(), /spawn failed: ENOENT/);
  await assert.rejects(missing.waitForClose(100), /command failed/);
  await missing.stop();
  const complete = spawnOwned(process.execPath, [fixture, "exit-zero"], {});
  await complete.closed;
  await complete.waitForClose(100);
  assert.equal(complete.child.exitCode, 0);
  await complete.stop();
});

test("command deadline failure retains ownership so teardown can close the running process", async (context) => {
  const { owned, output } = launch(context, "descendant");
  await ready(output);
  await assert.rejects(owned.waitForClose(100), /command close deadline exceeded/);
  owned.assertRunning();
  await owned.stop();
  assert.deepEqual(await liveGroupMembers(owned.child.pid), []);
});

test("a failing test reports its original assertion and exits after already-exited-child teardown", async (context) => {
  let output = "";
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // Start a separate test coordinator, not another worker of this one.
  const owned = spawnOwned(process.execPath, ["--test", new URL("./native-process/fixtures/failing-test.mjs", import.meta.url).pathname], { env }, { onOutput: (chunk) => { output += chunk; } });
  context.after(() => owned.stop());
  await assert.rejects(owned.waitForClose(5000), /command failed/);
  assert.equal(owned.child.exitCode, 1);
  assert.match(output, /underlying fixture assertion/);
  assert.match(output, /fail 1/);
  await owned.stop();
  assert.deepEqual(await liveGroupMembers(owned.child.pid), []);
});

for (const [inspection, mode] of [["unavailable", "closed-ignore-parent"], ["unavailable", "ignore"], ["timeout", "closed-ignore-parent"], ["buffer", "closed-ignore-parent"]]) {
  test(`${inspection} inspection still kills the owned TERM-refusing ${mode} and reports failure`, async (context) => {
    const { owned, output, phases } = launch(context, mode);
    const sentinel = launch(context, "descendant");
    const inspectionPath = await mkdtemp(join(tmpdir(), "dial-inspection-"));
    const previousPath = process.env.PATH;
    try {
      if (mode === "closed-ignore-parent") {
        await owned.closed;
        assert.equal(owned.child.exitCode, 7);
        assert.equal(owned.state.closed, true);
        const descendantPid = Number(output().match(/descendant=(\d+)/)[1]);
        assert.deepEqual(await liveGroupMembers(owned.child.pid), [descendantPid]);
      } else {
        await ready(output);
        assert.equal(owned.state.closed, false, "inspection first occurs after KILL closes the leader");
      }
      await ready(sentinel.output);
      if (inspection !== "unavailable") {
        const body = inspection === "timeout" ? "setInterval(() => {}, 1000);" : 'process.stdout.write("x".repeat(2 * 1024 * 1024));';
        await writeFile(join(inspectionPath, "ps"), `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
      }
      process.env.PATH = inspectionPath;
      const started = Date.now();
      let cleanupError;
      await assert.rejects(owned.stop({ graceMs: 100, killMs: 100 }), (error) => {
        cleanupError = error;
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /group inspection failed/);
        for (const inspectionError of error.errors) {
          if (inspection === "timeout") {
            assert.equal(inspectionError.cause.killed, true);
            assert.equal(inspectionError.cause.signal, "SIGTERM");
          } else {
            assert.equal(inspectionError.cause.code, inspection === "unavailable" ? "ENOENT" : "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
          }
        }
        assert.equal(error.errors.length, mode === "closed-ignore-parent" ? 2 : 1, "preserve inspection failures from every attempted phase");
        return true;
      });
      await assert.rejects(owned.stop(), (error) => error === cleanupError);
      assert.ok(Date.now() - started < 4000, "inspection failure cannot leave cleanup waiting indefinitely");
      process.env.PATH = previousPath;
      const members = await liveGroupMembers(owned.child.pid);
      assert.deepEqual({ kill: phases.includes("kill"), members }, { kill: true, members: [] });
      if (mode === "ignore") assert.equal(owned.child.signalCode, "SIGKILL");
      assert.equal(phases.includes("stopped"), false);
      assert.equal(owned.child.stdout.destroyed, true);
      assert.equal(owned.child.stderr.destroyed, true);
      sentinel.owned.assertRunning();
      process.kill(sentinel.owned.child.pid, 0);
    } finally {
      process.env.PATH = previousPath;
      // The regression must also clean up when run against the broken lifecycle.
      signalOwnedGroup(owned.child.pid, "SIGKILL");
      await sentinel.owned.stop();
      await rm(inspectionPath, { recursive: true, force: true });
    }
  });
}

for (const failedSignal of ["SIGTERM", "SIGKILL"]) {
  test(`inspection failure retains an underlying ${failedSignal} error and attempts both cleanup signals`, async (context) => {
    const { owned, phases } = launch(context, "closed-ignore-parent");
    const sentinel = launch(context, "descendant");
    const inspectionPath = await mkdtemp(join(tmpdir(), "dial-signal-inspection-"));
    const previousPath = process.env.PATH;
    const originalKill = process.kill;
    const signalError = Object.assign(new Error("fixture signal permission denied"), { code: "EPERM" });
    const signals = [];
    let killMock;
    try {
      await owned.closed;
      await ready(sentinel.output);
      killMock = context.mock.method(process, "kill", (pid, signal) => {
        if (pid === -owned.child.pid) {
          signals.push(signal);
          if (signal === failedSignal) throw signalError;
        }
        return originalKill(pid, signal);
      });
      process.env.PATH = inspectionPath;
      let cleanupError;
      const started = Date.now();
      await assert.rejects(owned.stop({ graceMs: 100, killMs: 100 }), (error) => {
        cleanupError = error;
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 3);
        assert.ok(error.errors.some((failure) => failure.cause === signalError));
        assert.equal(error.errors.filter((failure) => failure.cause.code === "ENOENT").length, 2);
        assert.match(error.message, new RegExp(`${failedSignal} failed: fixture signal permission denied`));
        return true;
      });
      await assert.rejects(owned.stop(), (error) => error === cleanupError);
      assert.ok(Date.now() - started < 3000);
      assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
      assert.equal(phases.includes("stopped"), false);
      assert.equal(owned.child.stderr.destroyed, true);
      process.env.PATH = previousPath;
      const members = await liveGroupMembers(owned.child.pid);
      if (failedSignal === "SIGTERM") assert.deepEqual(members, []);
      else assert.equal(members.length, 1, "an actual KILL refusal must be reported, never claimed as cleanup success");
      sentinel.owned.assertRunning();
      originalKill(sentinel.owned.child.pid, 0);
    } finally {
      process.env.PATH = previousPath;
      killMock?.mock.restore();
      signalOwnedGroup(owned.child.pid, "SIGKILL");
      const deadline = Date.now() + 1000;
      while ((await liveGroupMembers(owned.child.pid)).length > 0) {
        assert.ok(Date.now() < deadline, "fixture's denied signal is restored and its descendants cleaned");
        await delay(10);
      }
      await sentinel.owned.stop();
      await rm(inspectionPath, { recursive: true, force: true });
    }
  });
}
