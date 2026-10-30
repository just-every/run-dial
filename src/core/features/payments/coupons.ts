import { z } from "zod";
import { createId } from "../../shared/ids";
import { foldCase } from "../../shared/case-fold.mjs";
import { deriveOpaqueToken, hashToken } from "../../platform/auth/tokens";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { entitlementSummary, type Entitlement } from "./entitlement-repository";

export const couponInput = z.object({
 name:z.string().trim().min(1).max(120),email:z.string().trim().email().max(320),
 amountCents:z.number().int().min(50).max(99_999_999),sessions:z.number().int().min(1).max(1000),
 validityDays:z.number().int().min(1).max(3660),idempotencyKey:z.string().uuid(),
}).strict();

/** An owner issues a fixed discount with a finite number of uses; no processor payment is invented. */
export async function issueCoupon(db:D1Database,runtime:RuntimeEnvironment,clock:()=>Promise<Date>,eventId:string,input:z.infer<typeof couponInput>) {
 const now=(await clock()).toISOString(),email=foldCase(input.email.trim());
 const purchaseKey=await hashToken(`coupon:${input.idempotencyKey}`,runtime.SESSION_SECRET);
 const code=await deriveOpaqueToken(input.idempotencyKey,runtime.SESSION_SECRET,"appointment-coupon.v1");
 const codeHash=await hashToken(code,runtime.SESSION_SECRET),productId=createId(),id=createId();
 // The product ledger retains its original kind constraint. is_coupon gives a package unit its USD discount.
 await db.batch([
  db.prepare(`INSERT INTO payment_products(id,event_type_id,kind,name,sessions,amount_cents,validity_days,is_coupon,created_at,updated_at)
   SELECT ?,?,'package',?,?,?,?,1,?,? WHERE NOT EXISTS(SELECT 1 FROM payment_entitlements WHERE purchase_key=?) AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?)`)
   .bind(productId,eventId,input.name,input.sessions,input.amountCents,input.validityDays,now,now,purchaseKey,email),
  db.prepare(`INSERT INTO payment_entitlements(id,product_id,event_type_id,kind,sessions,balance,amount_cents,purchaser_email_folded,code_hash,purchase_key,account_id,state,expires_at,is_coupon,created_at,updated_at)
   SELECT ?,?,?,'package',?,?,?,?,?,?,'','active',?,1,?,? WHERE EXISTS(SELECT 1 FROM payment_products WHERE id=?) AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?) ON CONFLICT(purchase_key) DO NOTHING`)
   .bind(id,productId,eventId,input.sessions,input.sessions,input.amountCents,email,codeHash,purchaseKey,new Date(Date.parse(now)+input.validityDays*86400000).toISOString(),now,now,productId,email),
 ]);
 const row=await db.prepare("SELECT e.*,p.name,p.validity_days FROM payment_entitlements e JOIN payment_products p ON p.id=e.product_id WHERE e.purchase_key=?").bind(purchaseKey).first<Entitlement & {validity_days:number}>();
 if(!row||!row.is_coupon||row.event_type_id!==eventId||row.purchaser_email_folded!==email||row.name!==input.name||row.sessions!==input.sessions||row.amount_cents!==input.amountCents||row.validity_days!==input.validityDays||row.state!=="active")return {kind:"refused" as const};
 return {kind:"issued" as const,code,entitlement:entitlementSummary(row)};
}
