import { assert } from "../../modules/deploy-kit/validation.mjs";
import { query } from "../../modules/deploy-kit/migrations.mjs";
import { verifyHealth } from "../../modules/deploy-kit/health.mjs";

// Setup is a one-time capability. Read its authoritative Base ledger through the
// authenticated account API, never a public health flag or a local receipt hint.
export async function verifyDialHealth({ api, plan, receipt, ...options }) {
  const database = receipt?.resources?.d1?.find(item => item.binding === "DB");
  assert(database && /^[a-f0-9-]{32,36}$/i.test(database.id), "missing-bootstrap-database");
  const result = await query(api, database.id, `SELECT (SELECT COUNT(*) FROM oa_bootstrap WHERE singleton=1) AS claims,
    (SELECT COUNT(*) FROM oa_bootstrap b JOIN oa_operators o ON o.id=b.claim_id WHERE b.singleton=1 AND o.role='owner') AS claimedOwners,
    (SELECT COUNT(*) FROM oa_operators WHERE role='owner' AND status='active') AS activeOwners`);
  const state = result[0].results[0];
  assert(state && [state.claims, state.claimedOwners, state.activeOwners].every(Number.isInteger), "invalid-bootstrap-ledger");
  const consumed = state.claims === 1 && state.claimedOwners === 1 && state.activeOwners > 0;
  // All other secrets and every shared deployment identity/resource check remain.
  const healthPlan = consumed ? { ...plan, secrets: plan.secrets.filter(item => item.binding !== "SETUP_TOKEN") } : plan;
  return verifyHealth({ api, plan: healthPlan, receipt, ...options });
}
