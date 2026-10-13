import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evidenceDirectory, evidencePath, externalEvidencePath } from "../scripts/evidence-path.mjs";
test("verification output stays outside tracked source, including symlink and override destinations", async t => {
  const scratch = await mkdtemp(resolve(tmpdir(), "dial-evidence-path-")); t.after(() => rm(scratch, { recursive: true, force: true }));
  assert.ok(evidencePath("nested/result.json").startsWith(evidenceDirectory));
  assert.throws(() => evidencePath("../../source.json"), /invalid-evidence-path/);
  assert.throws(() => externalEvidencePath(resolve("package.json")), /outside-repository/);
  const link = resolve(scratch, "linked.json"); await symlink(resolve("package.json"), link);
  assert.throws(() => externalEvidencePath(link), /outside-repository/);
  await symlink(resolve("src"), resolve(scratch, "linked-directory"), "dir");
  assert.throws(() => externalEvidencePath(resolve(scratch, "linked-directory/new.json")), /outside-repository/);
  assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", "await import('./scripts/evidence-path.mjs')"], { env: { ...process.env, DIAL_EVIDENCE_DIR: resolve("src") }, stdio: "pipe" }), /outside-repository/);
});
