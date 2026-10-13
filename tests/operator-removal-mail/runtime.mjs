import { fixtureVite } from "../native-process/vite.mjs";
import { spawnOwned } from "../native-process/lifecycle.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
export const origin = "http://127.0.0.1:41890";
const root = new URL("../../", import.meta.url);
export async function startRuntime(context) {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-removal-mail-"));
  const config = "tests/operator-removal-mail/worker.wrangler.toml";
  const env = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: resolve(root.pathname, config), DIAL_PERSIST_STATE_DIR: persist, DIAL_DISABLE_INSPECTOR: "1" };
  let server, output = "";
  const onPhase = (event) => console.error("REMOVAL-MAIL-RUNTIME", JSON.stringify(event));
  async function run(command, args) {
    let text = "", failure;
    const commandProcess = spawnOwned(command, args, { cwd: root, env }, { label: "removal-mail migration", onOutput: (chunk) => { text += chunk; }, onPhase });
    try { await commandProcess.waitForClose(60000); }
    catch (error) { failure = new Error(`${error.message}\n${text.slice(-12000)}`, { cause: error }); }
    try { await commandProcess.stop(); }
    catch (error) { throw failure ? new AggregateError([failure, error], "removal-mail migration and cleanup failed") : error; }
    if (failure) throw failure;
    return text;
  }
  async function stop() {
    if (server) await server.stop();
  }
  async function start() {
    onPhase({ phase: "port-probe" });
    await new Promise((done, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(41890, "127.0.0.1", () => probe.close(done)); });
    server = spawnOwned("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "41890", "--strictPort"], { cwd: root, env }, { label: "removal-mail runtime", onOutput: (chunk) => { output += chunk; }, onPhase });
    for (let attempt = 0; attempt < 480; attempt++) {
      try { server.assertRunning(); }
      catch (error) { throw new Error(`${error.message}\n${output.slice(-12000)}`, { cause: error }); }
      try {
        if ((await fetch(origin + "/health")).ok) {
          server.assertRunning();
          onPhase({ phase: "ready", pid: server.child.pid }); return;
        }
      } catch { /* local workerd startup; checked again before the next request */ }
      await new Promise((done) => setTimeout(done, 125));
    }
    throw new Error(`removal-mail runtime: readiness deadline exceeded\n${output.slice(-12000)}`);
  }
  context.after(async () => {
    onPhase({ phase: "cleanup" });
    try { await stop(); }
    finally {
      try { if (process.env.DIAL_REMOVAL_MAIL_LOG) await writeFile(process.env.DIAL_REMOVAL_MAIL_LOG, output); }
      finally { await rm(persist, { recursive: true, force: true }); onPhase({ phase: "cleanup-complete" }); }
    }
  });
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-operator-removal-mail-test", "--local", "--persist-to", persist, "--config", config]);
  await start();
  return { restart: async () => { await stop(); await start(); } };
}
