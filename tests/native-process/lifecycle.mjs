import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { liveGroupMembers, signalOwnedGroup } from "./group.mjs";

export function spawnOwned(command, args, options, { label = "native subprocess", onOutput = () => {}, onPhase = () => {} } = {}) {
  const child = spawn(command, args, { ...options, detached: true, stdio: "pipe" });
  const state = { spawned: false, error: null, exited: false, closed: false, code: null, signal: null };
  let resolveExit, resolveClose, stopping;
  const exited = new Promise((done) => { resolveExit = done; });
  const closed = new Promise((done) => { resolveClose = done; });
  const phase = (name) => onPhase({ label, phase: name, pid: child.pid ?? null, code: state.code, signal: state.signal });
  child.once("spawn", () => { state.spawned = true; phase("spawn"); });
  child.once("error", (error) => { state.error = error; resolveExit(); phase("spawn-error"); });
  child.once("exit", (code, signal) => { Object.assign(state, { exited: true, code, signal }); resolveExit(); phase("exit"); });
  child.once("close", () => { state.closed = true; resolveClose(); phase("close"); });
  child.stdout.on("data", onOutput); child.stderr.on("data", onOutput);

  const failure = (reason) => new Error(`${label}: ${reason} (exit=${state.code}, signal=${state.signal}, closed=${state.closed})`, state.error ? { cause: state.error } : undefined);
  function assertRunning() {
    if (state.error) throw failure(`spawn failed: ${state.error.code}`);
    if (state.exited || state.closed || child.exitCode !== null || child.signalCode !== null) throw failure("exited before readiness");
  }
  async function waitForClose(timeoutMs) {
    let timer;
    try {
      await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(failure("command close deadline exceeded")), timeoutMs); })]);
      if (state.error || state.code !== 0) throw failure("command failed");
    } finally { clearTimeout(timer); }
  }
  async function settledWithin(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    do {
      if (state.closed && (await liveGroupMembers(child.pid)).length === 0) return true;
      await delay(25);
    } while (Date.now() < deadline);
    return false;
  }
  async function cleanup({ graceMs = 2000, killMs = 2000 } = {}) {
    phase("stop");
    const errors = [];
    function signal(signal) {
      try { signalOwnedGroup(child.pid, signal); }
      catch (error) { errors.push(new Error(`${label}: ${signal} failed: ${error.message}`, { cause: error })); }
    }
    async function settle(timeoutMs, afterKill = false) {
      const deadline = Date.now() + timeoutMs;
      try { return await settledWithin(timeoutMs); }
      catch (error) {
        errors.push(new Error(`${label}: group inspection failed: ${error.message}`, { cause: error }));
        // Inspection failure is not evidence of an empty group. Escalate during
        // grace; after KILL allow the remaining bounded wait for signal delivery.
        if (afterKill) await delay(Math.max(0, deadline - Date.now()));
        return false;
      }
    }
    try {
      signal("SIGTERM");
      if (await settle(graceMs) && errors.length === 0) { phase("stopped"); return; }
      phase("kill");
      signal("SIGKILL");
      const settled = await settle(killMs, true);
      if (errors.length > 0) {
        throw new AggregateError(errors, `${failure("cleanup failed after SIGKILL").message}: ${errors.map((error) => error.message).join("; ")}`, { cause: errors[0] });
      }
      throw failure(settled ? "cleanup required SIGKILL" : "cleanup deadline exceeded after SIGKILL");
    } finally {
      // A detached descendant can inherit these handles. Release our endpoints
      // even when close never arrives; retain the failure instead of hanging.
      for (const stream of child.stdio) stream?.destroy();
    }
  }
  return { child, state, exited, closed, assertRunning, waitForClose, stop: (options) => stopping ??= cleanup(options) };
}
