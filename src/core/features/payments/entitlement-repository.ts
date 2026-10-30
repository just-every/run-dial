import { createId } from "../../shared/ids";
export type Entitlement = {id:string;product_id:string;event_type_id:string;kind:"package"|"membership"|"gift";is_coupon:number;name?:string;available_balance?:number;sessions:number;balance:number;amount_cents:number;purchaser_email_folded:string;code_hash:string;purchase_key:string;checkout_session_id:string|null;account_id:string;subscription_id:string|null;state:string;expires_at:string;period_start:string|null;period_end:string|null;last_event_at:number};
export type Redemption = {id:string;units:number;at:string;freeWindowHours:number|null;discountCents?:number};
// A payment hold reserves credit before Checkout opens. Its own conversion excludes that reservation.
export const reservedCredit = "COALESCE((SELECT sum(CAST(json_extract(h.claim_json,'$.entitlement.units') AS INTEGER)) FROM payment_holds h WHERE h.state IN ('held','processing') AND json_extract(h.claim_json,'$.entitlement.id')=e.id AND h.id<>?),0)";
export function entitlementGuard(id:string, units:number, eventId:string, now:string, ownHold = "") {
 return {sql:`EXISTS(SELECT 1 FROM payment_entitlements e WHERE e.id=? AND e.event_type_id=? AND e.state='active' AND e.balance-${reservedCredit}>=? AND e.expires_at>? AND (e.kind<>'membership' OR (e.period_start<=? AND e.period_end>?)) AND NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=e.purchaser_email_folded))`,params:[id,eventId,ownHold,units,now,now,now]};
}
export function redeemStatements(db:D1Database,bookingId:string,redemption:Redemption,now:string) {
 now=redemption.at;
 return [
  db.prepare("INSERT INTO payment_redemptions(id,entitlement_id,booking_id,units,free_window_hours,discount_cents,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bookings WHERE id=?) ON CONFLICT(booking_id) DO NOTHING").bind(createId(),redemption.id,bookingId,redemption.units,redemption.freeWindowHours,redemption.discountCents??0,now,now,bookingId),
  db.prepare("UPDATE payment_entitlements SET balance=balance-?,updated_at=? WHERE id=? AND changes()=1 AND EXISTS(SELECT 1 FROM payment_redemptions WHERE booking_id=? AND entitlement_id=? AND created_at=?)").bind(redemption.units,now,redemption.id,bookingId,redemption.id,now),
 ];
}
/** Only a winning eligible cancellation credits an un-restored redemption. Renewals never regain an old period's unit. */
export function restoreEntitlementStatements(db:D1Database,bookingId:string,now:string,host:boolean) {
 const eligible=`EXISTS(SELECT 1 FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id WHERE b.id=r.booking_id AND b.state='cancelled' AND b.cancelled_at=? AND (?=1 OR (r.free_window_hours IS NOT NULL AND (julianday(o.start_at)-julianday(?))*24>=r.free_window_hours)))`;
 const period="(e.kind<>'membership' OR r.created_at>=e.period_start)";
 return [
  db.prepare(`UPDATE payment_entitlements AS e SET balance=balance+COALESCE((SELECT sum(r.units) FROM payment_redemptions r WHERE r.entitlement_id=e.id AND r.booking_id=? AND r.restored_at IS NULL AND ${period} AND ${eligible}),0),updated_at=? WHERE EXISTS(SELECT 1 FROM payment_redemptions r WHERE r.entitlement_id=e.id AND r.booking_id=? AND r.restored_at IS NULL)`)
   .bind(bookingId,now,host?1:0,now,now,bookingId),
  db.prepare(`UPDATE payment_redemptions AS r SET restored_at=?,updated_at=? WHERE booking_id=? AND restored_at IS NULL AND ${eligible}`).bind(now,now,bookingId,now,host?1:0,now),
 ];
}
export function entitlementSummary(row:Entitlement) { return {id:row.id,kind:row.is_coupon?"coupon" as const:row.kind,name:row.name,eventTypeId:row.event_type_id,balance:row.available_balance??row.balance,unit:row.is_coupon?"uses":row.kind==="gift"?"USD cents":"sessions",state:row.state,expiresAt:row.expires_at,periodEnd:row.period_end}; }
