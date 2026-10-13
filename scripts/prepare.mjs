import { cleanBuildEnvironment } from "./deployment/prepare-environment.mjs";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertCredentialFree, packageBuild } from "../modules/deploy-kit/prepare.mjs";
import { assert, hash } from "../modules/deploy-kit/validation.mjs";
import { MAX_ARTIFACT } from "../modules/deploy-kit/artifact.mjs";
export async function prepare(env = process.env) {
  assertCredentialFree(env);
  assert(["ephemeral-credential-free-job", "credential-free-local-checkout"].includes(env.RER_PREPARE_ISOLATION), "prepare-isolation-required");
  if (env.RER_PREPARE_ISOLATION === "ephemeral-credential-free-job") assert(process.platform === "linux", "prepare-linux-job-required");
  const root = process.cwd();
  for (const key of ["RER_DEPLOY_ARTIFACT", "RER_PREPARE_HOME"]) assert(env[key] && env[key] === resolve(env[key]) && !env[key].startsWith(root + "/") && env[key] !== root, "prepare-output-and-home-must-be-outside-checkout");
  assert(/^[a-f0-9]{40}$/.test(env.RER_DEPLOY_SOURCE_SHA ?? "") && /^\d+$/.test(env.RER_DEPLOY_RUN_ID ?? "") && /^\d+$/.test(env.RER_DEPLOY_RUN_ATTEMPT ?? ""), "missing-prepare-identity");
  assert(!(await readdir(root)).some(name => /^\.(?:env|dev\.vars)(?:\.|$)/.test(name)), "prepare-local-credential-files-forbidden");
  const clean = await cleanBuildEnvironment(env, root);
  await mkdir(env.RER_PREPARE_HOME, { mode: 0o700 });
  try {
    const run = (command, args) => {
      try { return execFileSync(command, args, { cwd: root, env: clean, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }).trim(); }
      catch { throw new Error("prepare-command-failed"); }
    };
    const source = { sha: run("git", ["rev-parse", "HEAD"]), tree: run("git", ["rev-parse", "HEAD^{tree}"]) };
    const cleanSource = () => !run("git", ["status", "--porcelain"]);
    assert(source.sha === env.RER_DEPLOY_SOURCE_SHA && cleanSource(), "prepare-source-mismatch");
    run("pnpm", ["install", "--frozen-lockfile"]);
    run("pnpm", ["build"]);
    assert(cleanSource() && source.sha === run("git", ["rev-parse", "HEAD"]), "source-changed-during-build");
    const artifact = await packageBuild({ root, productDirectory: "", source, runIdentity: { id: env.RER_DEPLOY_RUN_ID, attempt: env.RER_DEPLOY_RUN_ATTEMPT } });
    const bytes = JSON.stringify(artifact);
    assert(Buffer.byteLength(bytes) <= MAX_ARTIFACT, "artifact-too-large");
    await writeFile(env.RER_DEPLOY_ARTIFACT, bytes, { flag: "wx", mode: 0o600 });
    return { ok: true, scope: env.RER_PREPARE_ISOLATION, sha256: hash(bytes), source, run: artifact.run, deployed: false };
  } finally { await rm(env.RER_PREPARE_HOME, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { assert(process.argv.length === 2, "prepare-no-arguments"); console.log(JSON.stringify(await prepare())); }
  catch (error) { console.error(JSON.stringify({ ok: false, code: error.message })); process.exitCode = 1; }
}
