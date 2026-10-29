import type { Context } from "hono";
import { hashToken } from "../../platform/auth/tokens";
import { createId } from "../../shared/ids";
import { BookingsRepository } from "../bookings";
import { eventAllowed, type ApiEnvironment } from "./support";

type Pending = { id:string; eventTypeId:string; state:string; startAt:string; endAt:string; expiresAt:string; amountCents:number|null; currency:string|null };
const error=(code:string)=>({error:{code,message:"This booking cannot be completed.",request_id:createId()}});

/** Pending resources disclose state and amounts, never a public management capability. */
export async function pendingBooking(c:Context<ApiEnvironment>,id:string) {
 const row=await c.get("apiDatabase").prepare(`SELECT booking_id AS id,event_type_id AS eventTypeId,
  CASE WHEN state='pending' THEN 'pending_approval' ELSE state END AS state,start_at AS startAt,end_at AS endAt,expires_at AS expiresAt,
  json_extract(payment_json,'$.amountCents') AS amountCents,'usd' AS currency FROM booking_approval_requests WHERE booking_id=?
  UNION ALL SELECT json_extract(claim_json,'$.bookingId'),event_type_id,'payment_required',start_at,end_at,expires_at,amount_cents,currency
  FROM payment_holds WHERE json_extract(claim_json,'$.bookingId')=? AND state IN ('held','processing')
   AND NOT EXISTS(SELECT 1 FROM booking_approval_requests WHERE booking_id=?) LIMIT 1`).bind(id,id,id).first<Pending>();
 if(!row||!await eventAllowed(c,c.get("apiCredential"),row.eventTypeId))return undefined;
 return {id:row.id,eventTypeId:row.eventTypeId,state:row.state,occurrence:{startAt:row.startAt,endAt:row.endAt},expiresAt:row.expiresAt,
  ...(row.amountCents===null?{}:{payment:{amountCents:row.amountCents,currency:row.currency}})};
}

export async function pendingConfirmation(c:Context<ApiEnvironment>,nonce:string,result:
 {kind:"approval_required";approval:{expiresAt:string}}|{kind:"payment_required";payment:{checkoutUrl:string;amountCents:number;currency:string;expiresAt:string;mode:string}}) {
 const db=c.get("apiDatabase"),repository=new BookingsRepository(db);
 const nonceRow=await repository.getNonce(await hashToken(nonce,c.get("runtime").SESSION_SECRET));
 if(!nonceRow)throw new Error("api_booking_nonce_missing");
 const approval=await repository.approvals.forNonce(nonceRow.id);
 const hold=await db.prepare("SELECT json_extract(claim_json,'$.bookingId') AS id FROM payment_holds WHERE nonce_id=?").bind(nonceRow.id).first<{id:string}>();
 const id=approval?.bookingId??hold?.id;
 if(!id)throw new Error("api_pending_booking_missing");
 const resource=await pendingBooking(c,id);
 if(!resource)return {status:409,body:error("booking_unavailable")};
 return {status:202,bookingId:id,body:{...resource,...(result.kind==="payment_required"?{state:"payment_required",payment:{checkoutUrl:result.payment.checkoutUrl,amountCents:result.payment.amountCents,currency:result.payment.currency,expiresAt:result.payment.expiresAt,mode:result.payment.mode}}:{})}};
}
