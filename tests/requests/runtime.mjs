import { mkdtemp, readdir, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { spawnOwned } from "../native-process/lifecycle.mjs";

const cwd = new URL("../../", import.meta.url);

export async function startWorker(context) {
  const port = String(15713);
  const origin = `http://127.0.0.1:${port}`;
  const persist = await mkdtemp(resolve(tmpdir(), "dial-requests-"));
  const config = resolve(persist, "wrangler.toml");
  const processes = [];
  // Register before any subprocess can start. A failed cleanup retains the
  // database for diagnosis; it must never delete storage still held by a child.
  context.after(async () => {
    const errors = [];
    for (const owned of processes) {
      try { await owned.stop(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "request fixture cleanup failed; persistence retained");
    await rm(persist, { recursive: true, force: true });
  });
  const env = { ...process.env, OWNER_EMAIL: "operator@dial.test", SETUP_TOKEN: "dial-test-only-setup-token-at-least-32", MAIL_FROM: "no-reply@dial.test", DIAL_PORT: port, DIAL_PERSIST_STATE_DIR: persist, DIAL_DEV_VARS_DIR: persist, DIAL_WRANGLER_CONFIG_PATH: config, DIAL_INSPECTOR_PORT: "15723" };
  const output = { text: "" };
  const onPhase = (event) => context.diagnostic(`REQUEST-FIXTURE ${JSON.stringify(event)}`);
  let worker;

  async function start() {
    await new Promise((done, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(Number(port), "127.0.0.1", () => probe.close((error) => error ? reject(error) : done()));
    });
    // Only this generation's output can establish its successful strict-port
    // bind. runtime-server's health message alone could come from an occupant.
    output.text = "";
    worker = spawnOwned(process.execPath, ["tests/runtime-server.mjs"], { cwd, env }, {
      label: "request runtime", supervised: true, onOutput: (chunk) => { output.text += chunk; }, onPhase,
    });
    processes.push(worker);
    for (let attempt = 0; attempt < 480; attempt += 1) {
      worker.assertRunning();
      const bound = stripVTControlCharacters(output.text).split("\n")
        .some((line) => line.trim() === `➜  Local:   ${origin}/`);
      if (bound) {
        let healthy = false;
        try { healthy = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).ok; }
        catch { /* The owned native Worker is still starting. */ }
        worker.assertRunning();
        if (healthy) {
          onPhase({ label: "request runtime", phase: "ready", pid: worker.child.pid });
          return;
        }
      }
      await delay(125);
    }
    throw new Error("request Worker did not become healthy after its own listener bound");
  }

  async function update(command) {
    worker.assertRunning();
    await worker.stop();
    const child = spawnOwned("pnpm", ["exec", "wrangler", "d1", "execute", "dial-local", "--local", "--persist-to", persist, "--config", config, "--command", command], { cwd, env: { ...process.env, CI: "1" } }, { label: "request D1 update", onPhase });
    processes.push(child);
    const errors = [];
    try { await child.waitForClose(120000); } catch (error) { errors.push(error); }
    try { await child.stop(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "request D1 update failed");
    // Same directory, variables, config and runtime entry: existing sessions,
    // records and consumed nonces survive without another bootstrap or sign-in.
    await start();
  }

  await start();
  return { origin, persist, config, output, update };
}

export async function executeD1(server, command) { await server.update(command); }

/** Read-only view of the runtime's local D1 file; queue consumers are off, so queued mail stays in the outbox. */
export async function queuedMail(server, requestId) {
  const directory = resolve(server.persist, "v3/d1/miniflare-D1DatabaseObject");
  const [file] = (await readdir(directory)).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  const db = new DatabaseSync(resolve(directory, file), { readOnly: true });
  try {
    return db.prepare("SELECT json_extract(payload_json, '$.recipientRole') AS role, json_extract(payload_json, '$.to') AS recipient FROM delivery_outbox WHERE request_id = ? AND kind = 'mail_send' ORDER BY role, recipient").all(requestId).map((row) => ({ ...row }));
  } finally { db.close(); }
}
