import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// A default verification run owns a fresh external evidence directory. Hash all
// tracked inputs, including already-dirty owner edits, instead of resetting them.
process.env.DIAL_EVIDENCE_DIR ??= await mkdtemp(resolve(tmpdir(), "dial-verify-"));
const { evidencePath } = await import("./evidence-path.mjs");
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
async function hashes() {
  return Object.fromEntries(await Promise.all(files.map(async file => {
    try { return [file, createHash("sha256").update(await readFile(file)).digest("hex")]; }
    catch (error) { if (error.code === "ENOENT") return [file, null]; throw error; }
  })));
}
const before = await hashes();
let failure;
try {
  for (const step of ["contract:check", "lint", "boundaries", "validate", "typecheck", "test", "migration:check", "build", "verify:build-output", "deployment-spec:check", "check", "verify:copies", "verify:delivery", "verify:managed-editor", "integrations:check"]) {
    await new Promise((done, reject) => {
      const child = spawn("pnpm", ["run", step], { stdio: "inherit", env: process.env });
      child.on("error", reject); child.on("exit", code => code === 0 ? done() : reject(new Error(`${step}-failed:${code}`)));
    });
  }
} catch (error) { failure = error; }
const after = await hashes();
const changed = files.filter(file => before[file] !== after[file]);
await writeFile(evidencePath("tracked-input-nonmutation.json"), JSON.stringify({ checked: files.length, changed, checksPassed: !failure }, null, 2));
console.log(`Verification evidence: ${process.env.DIAL_EVIDENCE_DIR}`);
if (changed.length) throw new Error(`Verification changed tracked files: ${changed.join(", ")}`);
if (failure) throw failure;
