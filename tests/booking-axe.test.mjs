import { fixtureVite } from "./native-process/vite.mjs";
import { contract } from "./contract.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evidencePath } from "../scripts/evidence-path.mjs";

async function runAxe(t, journey) {
  const state = await mkdtemp(resolve(tmpdir(), "dial-booking-axe-"));
  const origin = "http://127.0.0.1:15752";
  const config = resolve("tests/booking-axe/worker.wrangler.toml");
  const env = { ...process.env, CI: "1", DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: state, DIAL_INSPECTOR_PORT: "15753", DIAL_REVIEW_ORIGIN: origin };
  // This rig exercises the production Worker with provider adapters, not the
  // local dev identity entry. Inherited rer launch bindings would replace the
  // configured review entry in Vite and silently remove its calendar fixtures.
  delete env.RER_DEV_KEY;
  delete env.RER_DEV_IDENTITY;
  delete env.RER_DEV_ORIGIN;
  let server, output = "";
  t.after(async () => {
    if (server?.exitCode === null) {
      const stopped = new Promise(done => server.once("exit", done));
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
      await stopped;
    }
    await writeFile(evidencePath("booking-axe-worker.log"), output);
    await rm(state, { recursive: true, force: true });
  });
  const run = args => new Promise((done, reject) => {
    const child = spawn(args[0], args.slice(1), { env, stdio: "pipe" }); let log = "";
    child.stdout.on("data", chunk => { log += chunk; }); child.stderr.on("data", chunk => { log += chunk; });
    child.on("error", reject); child.on("exit", code => code === 0 ? done(log) : reject(new Error(log)));
  });
  await run(["pnpm", "exec", "wrangler", "d1", "migrations", "apply", "dial-booking-axe-test", "--local", "--persist-to", state, "--config", config]);
  server = spawn("pnpm", [...fixtureVite, "--host", "127.0.0.1", "--port", "15752", "--strictPort"], { env, stdio: "pipe", detached: true });
  server.stdout.on("data", chunk => { output += chunk; }); server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt > 480) throw new Error(output.slice(-15000));
    try { if ((await fetch(origin + "/health")).ok) break; } catch { /* starting */ }
    await new Promise(done => setTimeout(done, 125));
  }
  console.log((await run(["node", journey ?? (process.env.DIAL_ACCEPTANCE_CAPACITY ? "scripts/verify-acceptance-capacity.mjs" : process.env.DIAL_ACCEPTANCE_AUDIT ? "scripts/verify-acceptance-audit.mjs" : "scripts/verify-booking-axe.mjs")])).trim());
}

let result;
const gate = t => result ??= runAxe(t);
contract("PUBLIC-001", "BOOK-005 pending-to-ready receipt and headless axe cover all seven public pages, original operator/request journeys and new validation states at desktop and mobile", gate);
contract("AVAIL-005", "native browser timezone search, privacy, invalid input and day/zone history persist", gate);
contract("BOOK-007", "native Brisbane reschedule picker, one confirm and held old slot work from a New York browser", gate);
contract("BOOK-008", "cancellation asks confirmation and cancelled bookings expose no change controls", gate);
contract("HOME-001", "the installed Lobby passes axe at desktop and mobile and leaves browser storage empty after reload", gate);
contract("DOCS-001", "every published docs page passes axe at desktop and mobile, and docs navigation leaves browser storage empty", gate);

contract("AUTH-001", "both unclaimed setup widths precede the native claim; fresh sessionless reloads hide setup and refuse replay", gate);

contract("OPER-004", "booking records show each email state and retained failure, with recovery at desktop and mobile", t => runAxe(t, "scripts/verify-booking-record.mjs"));
