import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflare } from "../modules/deploy-kit/provider.mjs";
import { assert } from "../modules/deploy-kit/validation.mjs";
import { loadInputs, readReceipt } from "./deployment/inputs.mjs";
import { teardown, inventory } from "./deployment/teardown.mjs";
export async function main(args = process.argv.slice(2), env = process.env) {
  assert(args.length === 1 && ["inventory", "plan", "delete"].includes(args[0]), "usage-teardown-inventory-plan-delete");
  const { plan, artifact } = await loadInputs(env, { controllerOutputs: args[0] !== "inventory" });
  const api = cloudflare({ accountId: env.CF_THROWAWAY_ACCOUNT_ID, token: env.CF_THROWAWAY_API_TOKEN });
  if (args[0] === "inventory") return inventory({ api, plan });
  const receipt = await readReceipt(env, artifact);
  assert(receipt, "teardown-receipt-required");
  if (args[0] === "delete") assert(env.RER_TEARDOWN_CONFIRM, "teardown-confirmation-required");
  return teardown({ api, plan, receipt, confirm: args[0] === "delete" ? env.RER_TEARDOWN_CONFIRM : undefined });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(JSON.stringify({ ok: false, code: /^[a-zA-Z0-9_-]+$/.test(error.message) ? error.message : "teardown-command-failed" })); process.exitCode = 1; }
}
