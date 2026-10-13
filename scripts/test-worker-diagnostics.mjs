import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

// Node buffers the output of later test files behind earlier workers. Keep a
// separate, value-free snapshot so CI can identify a worker that cannot exit.
export function resourceSnapshot() {
  const handles = process._getActiveHandles();
  return {
    resources: process.getActiveResourcesInfo().sort(),
    requests: process._getActiveRequests().map((request) => request.constructor?.name).sort(),
    sockets: handles.filter((handle) => /^(?:TLS)?Socket$/.test(handle.constructor?.name)).map((socket) => ({
      localPort: socket.localPort, remotePort: socket.remotePort, readyState: socket.readyState,
      destroyed: socket.destroyed, readableEnded: socket.readableEnded, writableFinished: socket.writableFinished,
    })),
    children: handles.filter((handle) => handle.constructor?.name === "ChildProcess").map((child) => ({
      pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode,
      stdio: child.stdio.map((stream) => stream ? { destroyed: stream.destroyed, readableEnded: stream.readableEnded } : null),
    })),
  };
}

if (process.env.DIAL_TEST_DIAGNOSTICS_DIR && process.env.NODE_TEST_CONTEXT === "child-v8" && /\.test\.(?:mjs|ts)$/.test(process.argv[1] ?? "")) {
  const directory = resolve(process.env.DIAL_TEST_DIAGNOSTICS_DIR);
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `${process.pid}.json`);
  const started = Date.now();
  let phase = "running";
  function snapshot() {
    const value = { file: relative(process.cwd(), process.argv[1]), pid: process.pid, phase, elapsedMs: Date.now() - started, ...resourceSnapshot() };
    // Atomic replacement prevents the monitor from observing a partial record.
    writeFileSync(`${file}.tmp`, JSON.stringify(value) + "\n");
    renameSync(`${file}.tmp`, file);
  }
  snapshot();
  setTimeout(snapshot, 1000).unref();
  const heartbeat = setInterval(snapshot, 30_000);
  heartbeat.unref();
  const { after } = await import("node:test");
  after(() => { phase = "root-teardown"; snapshot(); });
  process.once("exit", () => { phase = "exited"; snapshot(); });
}
