import { rerEntry, rerArguments } from '../rer-command.mjs';
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnOwned } from "../native-process/lifecycle.mjs";
import { startupDiagnostic } from "./startup-diagnostics.mjs";
import { commandDiagnostic } from "./command-diagnostics.mjs";

const root = new URL("../../", import.meta.url).pathname;
export async function freshCopy() {
  const directory = await mkdtemp(join(tmpdir(), "dial-local-setup-"));
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--", root, directory], { stdio: "pipe" });
  return directory;
}
export function environment() {
  // Mark this finite server journey for Base admission and cleanup accounting.
  const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_INCLUDE_PROCESS_ENV: "false", DIAL_INSPECTOR_PORT: "15751", RER_SERVER_JOURNEY: "1" };
  for (const key of Object.keys(env)) if (/^(DIAL_(DEV_|WRANGLER_CONFIG|PERSIST_)|SESSION_SECRET|SETUP_TOKEN|OWNER_EMAIL|AUTH_|MAIL_|RESEND_|GOOGLE_|CALENDAR_)/.test(key)) delete env[key];
  delete env.RER_LOCAL_OPERATION;
  return env;
}
export async function runRer(directory, args, { expected = 0, timeout = 180_000 } = {}) {
  let output = "";
  const verb = args[0], label = `rer ${verb}`;
  const owned = spawnOwned(process.execPath, rerArguments([rerEntry, ...args, "--json"]), { cwd: directory, env: environment() }, { label, onOutput: chunk => { output += chunk; } });
  try {
    try { await owned.waitForClose(timeout); } catch (error) { if (expected === 0) throw error; }
    assert.equal(owned.state.code, expected, `${label} exit status`);
    return output;
  } catch (error) {
    throw new Error(`Native command failure: ${JSON.stringify(commandDiagnostic(output, verb, owned.state.code))}; captured output omitted`, { cause: error });
  } finally { await owned.stop(); }
}
// `rer dev` opens signed in (RER_SIGNED_IN, RER_OPEN); `rer dev --login` and `rer preview` keep the outbox sign-in, which the key
// gate still protects, so they print RER_SIGN_IN and the RER_OPEN link that opens it.
export async function start(directory, command, origin, flags = []) {
  let output = "";
  const owned = spawnOwned(process.execPath, rerArguments([rerEntry, command, ...flags]), { cwd: directory, env: environment() }, { label: `rer ${command}`, onOutput: chunk => { output += chunk; } });
  const outbox = command === "preview" || flags.includes("--login");
  try {
    for (let attempt = 0; attempt < 2400; attempt++) {
      owned.assertRunning();
      const lines = output.split(/\r?\n/);
      const ready = lines.includes(`RER_READY ${origin}`);
      const open = lines.find(line => line.startsWith("RER_OPEN "));
      const signIn = lines.find(line => line === `RER_SIGN_IN ${origin}/__dev/outbox`);
      const signedIn = lines.find(line => line.startsWith("RER_SIGNED_IN "));
      // The CLI performs health and ordinary sign-in delivery before its markers.
      // Wait for both before asserting health to avoid pre-readiness quota use.
      if (ready && open && (outbox ? signIn : signedIn)) {
        try { if ((await fetch(origin + "/health")).ok) return { owned, output: () => output, openUrl: open.slice("RER_OPEN ".length), signInUrl: signIn?.slice("RER_SIGN_IN ".length), signedInAs: signedIn?.slice("RER_SIGNED_IN ".length) }; } catch { /* native Worker startup */ }
      }
      await new Promise(done => setTimeout(done, 125));
    }
    throw new Error(`rer ${command} did not become ready`);
  } catch (error) {
    await owned.stop();
    throw new Error(`${error.message}; native startup: ${JSON.stringify(startupDiagnostic(output, owned.state.code))}`, { cause: error });
  }
}
export async function variables(directory) {
  return Object.fromEntries((await readFile(join(directory, ".dev.vars"), "utf8")).trim().split("\n").map(line => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
}
export async function removeCopy(directory) { await rm(directory, { recursive: true, force: true }); }

export async function assertPrivateBuild(directory, values) {
  const files = await readdir(join(directory, "dist"), { recursive: true, withFileTypes: true });
  for (const file of files.filter(file => file.isFile())) {
    assert.notEqual(file.name, ".dev.vars", "build does not emit a credential file");
    const bytes = await readFile(join(file.parentPath, file.name));
    for (const key of ["SESSION_SECRET", "SETUP_TOKEN"]) {
      if (values[key]) assert.equal(bytes.includes(Buffer.from(values[key])), false, "build excludes local credentials");
    }
  }
}
