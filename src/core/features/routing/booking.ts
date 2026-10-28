import type { BookingClaim } from "../bookings/types";
import type { RoutingAnswer, RoutingRepository } from "./repository";
export type RoutingClaim={submissionId:string;tokenHash:string;answers:RoutingAnswer[]};

export function routingGuard(input:RoutingClaim,eventId:string,bookingId:string){return {sql:`EXISTS(SELECT 1 FROM routing_handoffs h JOIN routing_submissions s ON s.id=h.submission_id JOIN routing_forms f ON f.id=s.form_id WHERE s.id=? AND h.token_hash=? AND h.event_type_id=? AND (h.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') OR h.booking_claim_id=?) AND (h.booking_claim_id IS NULL OR h.booking_claim_id=?) AND s.booking_id IS NULL AND f.published=1 AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=s.invitee_email OR email IN(SELECT lower(trim(atom)) FROM json_tree(s.answers_json) WHERE type='text')))`,params:[input.submissionId,input.tokenHash,eventId,bookingId,bookingId]};}
export function routingReservation(db:D1Database,input:BookingClaim){return input.routing?[db.prepare("UPDATE routing_handoffs SET booking_claim_id=? WHERE submission_id=? AND (EXISTS(SELECT 1 FROM payment_holds WHERE json_extract(claim_json,'$.bookingId')=? AND state IN ('held','processing')) OR EXISTS(SELECT 1 FROM booking_approval_requests WHERE booking_id=? AND state='pending'))").bind(input.bookingId,input.routing.submissionId,input.bookingId,input.bookingId)]:[];}
export function routingClaimStatements(db:D1Database,input:BookingClaim){
 const route=input.routing;if(!route)return [];
 return [
  db.prepare("UPDATE routing_submissions SET booking_id=?,updated_at=? WHERE id=? AND booking_id IS NULL AND EXISTS(SELECT 1 FROM bookings WHERE id=?)").bind(input.bookingId,input.now,route.submissionId,input.bookingId),
  ...route.answers.map(answer=>db.prepare("INSERT INTO booking_answers(id,booking_id,question_key,question_label,question_kind,value_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bookings WHERE id=?)").bind(crypto.randomUUID(),input.bookingId,`routing.${answer.key}`,answer.label,answer.kind,JSON.stringify(answer.value),input.now,input.bookingId)),
  db.prepare("DELETE FROM routing_handoffs WHERE submission_id=? AND EXISTS(SELECT 1 FROM bookings WHERE id=?)").bind(route.submissionId,input.bookingId),
 ];
}
export async function resolveRouting(repository:RoutingRepository,token:string,eventId:string){return repository.handoff(token,eventId);}
