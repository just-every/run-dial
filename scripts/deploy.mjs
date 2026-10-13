import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, hash, stable } from "../modules/deploy-kit/validation.mjs";
import { regularBytes } from "../modules/deploy-kit/artifact.mjs";
import { cloudflare } from "../modules/deploy-kit/provider.mjs";
import { deploy } from "../modules/deploy-kit/deploy.mjs";
import { verifyDialHealth } from "./deployment/health.mjs";
import { loadInputs, readReceipt } from "./deployment/inputs.mjs";

export async function main(args = process.argv.slice(2), env = process.env) {
  assert(args.length === 1 && ["plan", "deploy", "health"].includes(args[0]), "usage-plan-deploy-health");
  const { artifact, setup, plan } = await loadInputs(env);
  if (args[0] === "plan") {
    const bytes = JSON.stringify(plan, null, 2) + "\n";
    await writeFile(env.RER_DEPLOY_PLAN, bytes, { flag: "wx", mode: 0o600 });
    return { ok: true, scope: "local-plan-only", plan: env.RER_DEPLOY_PLAN, sha256: hash(bytes), deployed: false };
  }
  const bytes = await regularBytes(env.RER_DEPLOY_PLAN);
  assert(/^[a-f0-9]{64}$/.test(env.RER_DEPLOY_PLAN_SHA256 ?? "") && hash(bytes) === env.RER_DEPLOY_PLAN_SHA256 && stable(JSON.parse(bytes)) === stable(plan), "reviewed-plan-mismatch");
  const api = cloudflare({ accountId: env.CF_THROWAWAY_ACCOUNT_ID, token: env.CF_THROWAWAY_API_TOKEN });
  const account = await api.request("/workers/subdomain");
  assert(typeof account?.subdomain === "string" && setup.target === `https://${plan.worker}.${account.subdomain}.workers.dev`, "account-target-mismatch");
  const previousReceipt = await readReceipt(env, artifact);
  if (args[0] === "health") {
    assert(previousReceipt, "missing-receipt");
    await verifyDialHealth({ api, plan, receipt: previousReceipt });
  } else {
    const receipt = await deploy({ api, plan, artifact, artifactSha256: env.RER_DEPLOY_ARTIFACT_SHA256, previousReceipt, repeatOnly: Boolean(previousReceipt), env,
      onReceipt: async value => { if (!previousReceipt) await writeFile(env.RER_DEPLOY_RECEIPT, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); } });
    if (previousReceipt) assert(receipt.changed === false, "existing-receipt-cannot-be-overwritten");
  }
  return { ok: true, scope: "remote-deployment-health", worker: plan.worker, receipt: env.RER_DEPLOY_RECEIPT };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(JSON.stringify({ ok: false, code: /^[a-zA-Z0-9_-]+$/.test(error.message) ? error.message : "deploy-command-failed" })); process.exitCode = 1; }
}
