import { fixtureVite } from "./native-process/vite.mjs";
import { contract } from "./contract.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnOwned } from "./native-process/lifecycle.mjs";
import { evidencePath } from "../scripts/evidence-path.mjs";
import { hostJourneys } from "./host-setup/journey.mjs";

for (const width of [1440, 390]) for (const mode of ["published", "requests-only", "calendar-optional"]) contract("BASE-PUBLIC-003", `cold host completes native ${mode} setup, clipboard, embeds and focus at ${width}px`, async t => {
  const state = await mkdtemp(resolve(tmpdir(), "dial-host-setup-"));
  const origin = "http://127.0.0.1:15762", config = resolve("tests/host-setup/worker.wrangler.toml");
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: state, DIAL_INSPECTOR_PORT: "15763" };
  let server, output = "";
  t.after(async () => {
    await server?.stop();
    await writeFile(evidencePath("host-setup-worker.log"), output.replace(/([?&](?:token|state|nonce)=)[^\s&"<>]+/g, "$1[redacted]"));
    await rm(state, { recursive: true, force: true });
  });
  const migration = spawnOwned("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-host-setup-test", "--local", "--persist-to", state, "--config", config], { env }, { label: "host setup migration", onOutput: chunk => { output += chunk; } });
  try { await migration.waitForClose(120000); } finally { await migration.stop(); }
  server = spawnOwned("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15762", "--strictPort"], { env }, { label: "host setup worker", onOutput: chunk => { output += chunk; } });
  let ready = false;
  for (let attempt = 0; attempt < 480; attempt++) {
    server.assertRunning();
    try { if ((await fetch(origin + "/health")).ok) { ready = true; break; } } catch { /* native startup */ }
    await new Promise(done => setTimeout(done, 125));
  }
  if (!ready) throw new Error("Host setup Worker did not become ready; see private runtime evidence.");
  await hostJourneys(origin, { width, requestsOnly: mode === "requests-only", calendarOptional: mode === "calendar-optional" });
});
