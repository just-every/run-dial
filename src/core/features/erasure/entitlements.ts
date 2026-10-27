import { ErasureError, type PortabilityFence } from "../../../modules/erasure/index.mjs";
import type { deleteRows as DeleteRows } from "./address";

/** Purchases exist before bookings. Close Stripe renewal and pending Checkout before forgetting local authority. */
export async function entitlementRemainders(db: D1Database, fence: PortabilityFence, email: string, deleteRows: typeof DeleteRows) {
  const purchases=(await db.prepare("SELECT id,state,subscription_id FROM payment_entitlements WHERE purchaser_email_folded=? ORDER BY id").bind(email).all<{id:string;state:string;subscription_id:string|null}>()).results;
  if(purchases.some(row=>row.state==="pending" || row.subscription_id!==null)) throw new ErasureError("payment_entitlement_erasure_requires_processor_cleanup",503);
  const ids=JSON.stringify(purchases.map(row=>row.id));
  return [
    ...await deleteRows(db,fence,"payment_redemptions","entitlement_id IN(SELECT value FROM json_each(?))",[ids]),
    ...await deleteRows(db,fence,"payment_entitlement_events","entitlement_id IN(SELECT value FROM json_each(?))",[ids]),
    ...await deleteRows(db,fence,"payment_entitlements","id IN(SELECT value FROM json_each(?))",[ids]),
  ];
}
