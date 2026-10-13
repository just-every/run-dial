import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanBuildEnvironment } from "../scripts/deployment/prepare-environment.mjs";

test("preparation child uses private external TMPDIR while retaining the credential-free allowlist", async t => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "dial-prepare-environment-")));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const root = join(scratch, "checkout"); await mkdir(root);
  const target = join(scratch, "private-temporary"), isolatedHome = join(scratch, "isolated-home");
  const env = { PATH: process.env.PATH, RER_PREPARE_HOME: isolatedHome, TMPDIR: target, HOME: "/unrelated/home", UNRELATED_ENV: "must-not-propagate" };
  const clean = await cleanBuildEnvironment(env, root);
  const child = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { tmpdir } from 'node:os';
    import { mkdtempSync } from 'node:fs';
    import { join } from 'node:path';
    console.log(JSON.stringify({ temporary: tmpdir(), created: mkdtempSync(join(tmpdir(),'child-')), home: process.env.HOME, unrelated: process.env.UNRELATED_ENV ?? null }));
  `], { env: clean, encoding: "utf8" }));
  assert.equal(child.temporary, target); assert.ok(child.created.startsWith(target + "/child-"));
  assert.equal(child.home, isolatedHome); assert.equal(child.unrelated, null);
  assert.equal((await stat(target)).mode & 0o777, 0o700);
  assert.deepEqual(Object.keys(clean).sort(), ["CI", "CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV", "HOME", "PATH", "TMPDIR", "WRANGLER_SEND_METRICS", "XDG_CONFIG_HOME"].sort());
  assert.equal((await cleanBuildEnvironment(env, root)).TMPDIR, target, "existing valid directory is reusable");
  assert.equal("TMPDIR" in await cleanBuildEnvironment({ PATH: env.PATH, RER_PREPARE_HOME: isolatedHome }, root), false);
  await assert.rejects(cleanBuildEnvironment({ ...env, CF_THROWAWAY_API_TOKEN: "test-secret" }, root), /credential-environment-forbidden/);
  await assert.rejects(cleanBuildEnvironment({ ...env, NODE_OPTIONS: "--inspect" }, root), /node-injection-forbidden/);
});

test("preparation rejects relative and in-checkout TMPDIR, including symlink ancestors before creation", async t => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "dial-prepare-tmpdir-")));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const root = join(scratch, "checkout"); await mkdir(root);
  const base = { PATH: process.env.PATH, RER_PREPARE_HOME: join(scratch, "isolated-home") };
  for (const TMPDIR of ["", "relative/path"]) await assert.rejects(cleanBuildEnvironment({ ...base, TMPDIR }, root), /tmpdir-must-be-absolute/);
  for (const TMPDIR of [root, join(root, "new")]) await assert.rejects(cleanBuildEnvironment({ ...base, TMPDIR }, root), /tmpdir-must-be-outside-checkout/);
  const alias = join(scratch, "alias"); await symlink(root, alias, "dir");
  await assert.rejects(cleanBuildEnvironment({ ...base, TMPDIR: join(alias, "new") }, root), /tmpdir-must-be-outside-checkout/);
  await assert.rejects(access(join(root, "new")), { code: "ENOENT" });
});
