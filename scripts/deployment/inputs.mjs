import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { assert, hash } from "../../modules/deploy-kit/validation.mjs";
import { readArtifact, regularBytes } from "../../modules/deploy-kit/artifact.mjs";
import { dialPlan } from "./plan.mjs";
export async function loadInputs(env, { controllerOutputs = true } = {}) {
  assert(!env.NODE_OPTIONS && !env.NODE_PATH && !env.EVIDENCE_WRITE_TOKEN, "unsafe-controller-environment");
  const paths = ["RER_DIAL_SETUP", "RER_DEPLOY_ARTIFACT", ...(controllerOutputs ? ["RER_DEPLOY_PLAN", "RER_DEPLOY_RECEIPT"] : [])];
  for (const key of paths) assert(env[key] && env[key] === resolve(env[key]), `missing-or-invalid-${key}`);
  const artifact = await readArtifact(env.RER_DEPLOY_ARTIFACT, { sha256: env.RER_DEPLOY_ARTIFACT_SHA256, sourceSha: env.RER_DEPLOY_SOURCE_SHA, runId: env.RER_DEPLOY_RUN_ID, runAttempt: env.RER_DEPLOY_RUN_ATTEMPT });
  const setup = JSON.parse(await regularBytes(env.RER_DIAL_SETUP, 16384));
  return { artifact, setup, plan: dialPlan(artifact, setup) };
}
export async function readReceipt(env, artifact) {
  try {
    const stat = await lstat(env.RER_DEPLOY_RECEIPT);
    assert((stat.mode & 0o077) === 0, "receipt-permissions");
    const receipt = JSON.parse(await regularBytes(env.RER_DEPLOY_RECEIPT, 1024 * 1024));
    assert(receipt.source?.sha === artifact.source.sha && receipt.run?.id === artifact.run.id && receipt.run?.attempt === artifact.run.attempt && receipt.artifactSha256 === env.RER_DEPLOY_ARTIFACT_SHA256 && hash(receipt.config) === receipt.configSha256, "receipt-custody-mismatch");
    return receipt;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
