import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureVite } from "../native-process/vite.mjs";
import { microsoftScreens } from "./teams-screens.mjs";

export async function microsoftScreenRuntime(browser) {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-microsoft-screens-")), config = resolve("tests/calendar-microsoft/screen-worker.wrangler.toml"), origin = "http://127.0.0.1:15916";
  const environment = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: persist, DIAL_INSPECTOR_PORT: "15926" };
  delete environment.RER_DEV_KEY; delete environment.RER_DEV_IDENTITY; delete environment.RER_DEV_ORIGIN;
  let server, output = "";
  try {
    await new Promise((done, reject) => {
      const child = spawn("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-microsoft-screens", "--local", "--persist-to", persist, "--config", config], { env: environment, stdio: "pipe" });
      child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; }); child.once("error", reject); child.once("exit", code => code === 0 ? done() : reject(new Error(output)));
    });
    server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15916", "--strictPort"], { env: environment, stdio: "pipe", detached: true });
    server.stdout.on("data", chunk => { output += chunk; }); server.stderr.on("data", chunk => { output += chunk; });
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null || attempt >= 480) throw new Error(output.slice(-14000));
      try { if ((await fetch(origin + "/health")).ok) break; } catch { /* native SSR readiness */ }
      await new Promise(done => setTimeout(done, 125));
    }
    return await microsoftScreens({ browser, origin });
  } finally {
    if (server?.exitCode === null) { const stopped = new Promise(done => server.once("exit", done)); process.kill(-server.pid, "SIGTERM"); await stopped; }
    await rm(persist, { recursive: true, force: true });
  }
}
