import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";

// Detached remote command preserves artifacts even when an audit fails. --keep
// on remote-run retains the checkout and this archive for subsequent retrieval.
const evidence = process.env.DIAL_AUDIT_OUTPUT_DIR ? resolve(process.env.DIAL_AUDIT_OUTPUT_DIR) : await mkdtemp(resolve(tmpdir(), "dial-acceptance-browser-"));
await mkdir(evidence, { recursive: true });
const archive = resolve(process.env.DIAL_AUDIT_ARCHIVE_PATH ?? ".audit-artifacts/browser-audit.tar.gz");
const results = [];
let auditFailure;
async function run(command, args, env) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject); child.once("exit", (code, signal) => done({ code, signal }));
  });
}
try {
  for (const mode of ["maintained", "bounded"]) {
    const destination = resolve(evidence, mode); await mkdir(destination);
    const env = { ...process.env, DIAL_EVIDENCE_DIR: destination, DIAL_BROWSER_ONLY: "1" };
    delete env.DIAL_ACCEPTANCE_CAPACITY; delete env.DIAL_ACCEPTANCE_AUDIT;
    if (mode === "bounded") env.DIAL_ACCEPTANCE_AUDIT = "1";
    console.log(`BROWSER_AUDIT_STAGE ${mode}`);
    results.push({ mode, ...await run(process.execPath, ["--test", "--test-concurrency=1", "tests/booking-axe.test.mjs"], env) });
  }
} catch (error) {
  auditFailure = error;
}
await writeFile(resolve(evidence, "commands.json"), JSON.stringify({ results, command: "node scripts/run-acceptance-browser-audits.mjs", environment: "headless Chromium; local workerd on executing machine; capacity excluded for separate Mac HTTP measurement" }, null, 2));
await mkdir(dirname(archive), { recursive: true });
const packed = await run("tar", ["-czf", archive, "-C", evidence, "."], process.env);
if (packed.code !== 0) throw new Error("Unable to preserve browser audit evidence");
console.log(`BROWSER_AUDIT_ARCHIVE ${archive}`);
console.log(`BROWSER_AUDIT_EVIDENCE ${evidence}`);
if (auditFailure !== undefined) throw auditFailure;
if (results.some(result => result.code !== 0) || results.length !== 2) process.exitCode = 1;
