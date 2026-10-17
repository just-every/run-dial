import { createId } from "../../shared/ids";
import type { BookingRecord } from "./types";

export type RescheduleRequest = {
 archiveHistorical?: boolean;
 id: string; state: "open" | "picked" | "expired" | "cancelled";
 message: string; releaseTime: boolean; createdAt: string; expiresAt: string;
 reminderAt: string | null; remindedAt: string | null;
};
export type RescheduleRequestInput = { message: string; releaseTime: boolean; expiresInDays: number; reminderHours: number | null };
export const requestColumns = "id,archive_historical AS archiveHistorical,state,message,release_time AS releaseTime,created_at AS createdAt,expires_at AS expiresAt,reminder_at AS reminderAt,reminded_at AS remindedAt";
export function normalizeRequest(row: RescheduleRequest): RescheduleRequest { return { ...row, releaseTime: Boolean(row.releaseTime), archiveHistorical: Boolean(row.archiveHistorical) }; }

/** Every caller runs within this booking's coordinator, including scheduled work. */
export class RescheduleRequestsRepository {
 constructor(private readonly db: D1Database) {}
 async due(now: string) {
  const rows = await this.db.prepare("SELECT DISTINCT booking_id AS bookingId FROM booking_reschedule_requests WHERE archive_historical=0 AND ((state='open' AND (expires_at<=? OR (reminder_at<=? AND reminded_at IS NULL))) OR (state='expired' AND release_time=1 AND EXISTS(SELECT 1 FROM bookings b WHERE b.id=booking_id AND b.state<>'cancelled'))) LIMIT 100").bind(now,now).all<{bookingId:string}>();
  return rows.results;
 }
 async begin(booking: BookingRecord, operatorId: string, input: RescheduleRequestInput, email: Record<string,unknown>, now: string, capability?: {id:string;hash:string;expiresAt:string}) {
  const id=createId(), end=Date.parse(now)+input.expiresInDays*86400000;
  const expiresAt=new Date(input.releaseTime ? end : Math.min(end,Date.parse(booking.occurrence.startAt))).toISOString();
  const reminderAt=input.reminderHours===null ? null : new Date(Date.parse(now)+input.reminderHours*3600000).toISOString();
  if(reminderAt && reminderAt>=expiresAt) return "invalid_reminder" as const;
  const [insert]=await this.db.batch([
   this.db.prepare(`INSERT INTO booking_reschedule_requests(id,booking_id,occurrence_id,state,message,release_time,actor_id,created_at,updated_at,expires_at,reminder_at)
    SELECT ?,id,current_occurrence_id,'open',?,?,?,?,?,?,? FROM bookings WHERE id=? AND state IN ('confirmed','rescheduled') AND current_occurrence_id=?
    AND EXISTS(SELECT 1 FROM booking_occurrences WHERE id=current_occurrence_id AND start_at>?)
    AND NOT EXISTS(SELECT 1 FROM booking_reschedule_requests WHERE booking_id=? AND state='open' AND archive_historical=0)`)
    .bind(id,input.message,input.releaseTime?1:0,operatorId,now,now,expiresAt,reminderAt,booking.id,booking.occurrence.id,now,booking.id),
   this.db.prepare("UPDATE booking_occurrences SET blocks_time=0 WHERE id=? AND EXISTS(SELECT 1 FROM booking_reschedule_requests WHERE id=? AND release_time=1)").bind(booking.occurrence.id,id),
   this.db.prepare("UPDATE delivery_outbox SET state='failed',last_error_code='reschedule_requested',updated_at=? WHERE booking_id=? AND kind='reminder' AND state='pending' AND EXISTS(SELECT 1 FROM booking_reschedule_requests WHERE id=? AND release_time=1)").bind(now,booking.id,id),
   this.db.prepare("INSERT INTO booking_request_history(id,booking_id,occurrence_id,action,actor_type,actor_id,reason,created_at) SELECT ?,booking_id,occurrence_id,'reschedule_requested','operator',actor_id,message,? FROM booking_reschedule_requests WHERE id=?").bind(createId(),now,id),
   ...(capability ? [
    this.db.prepare("UPDATE booking_manage_tokens SET rotated_at=?,updated_at=? WHERE booking_id=? AND rotated_at IS NULL AND invalidated_at IS NULL AND EXISTS(SELECT 1 FROM booking_reschedule_requests WHERE id=?)").bind(now,now,booking.id,id),
    this.db.prepare("INSERT INTO booking_manage_tokens(id,booking_id,token_hash,expires_at,created_at,updated_at) SELECT ?,booking_id,?,?,?,? FROM booking_reschedule_requests WHERE id=?").bind(capability.id,capability.hash,capability.expiresAt,now,now,id),
   ] : []),
   ...this.mail(id,email,now,false),
   ...(input.releaseTime && booking.calendarState!=="not_required" ? this.calendar(id,booking,now) : []),
  ]);
  return insert.meta.changes>0 ? "created" as const : "not_available" as const;
 }
 private mail(id:string,email:Record<string,unknown>,now:string,reminder:boolean) {
  return [this.db.prepare(`INSERT INTO delivery_outbox(id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
   SELECT ?,'mail_send',?,booking_id,occurrence_id,?,'pending',0,?,?,? FROM booking_reschedule_requests WHERE id=? AND state='open'`)
   .bind(createId(),`request:${id}:${reminder?"reminder":"sent"}`,JSON.stringify({...email,rescheduleRequestId:id,messageKind:reminder?"rescheduleRequestReminder":"rescheduleRequest"}),now,now,now,id)];
 }
 private calendar(id:string,b:BookingRecord,now:string) {
  const payload={bookingId:b.id,occurrenceId:b.occurrence.id,icalUid:b.icalUid,eventTitle:b.eventTitle,startAt:b.occurrence.startAt,endAt:b.occurrence.endAt,hostTimezone:b.hostTimezone,invitee:{name:b.inviteeName,email:b.inviteeEmail},location:b.locationValue,locationType:b.locationType};
  return [this.db.prepare(`INSERT INTO delivery_outbox(id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
   SELECT ?,'calendar_upsert',?,booking_id,occurrence_id,?,'pending',0,?,?,? FROM booking_reschedule_requests WHERE id=?`)
   .bind(createId(),`request:${id}:calendar`,JSON.stringify(payload),now,now,now,id)];
 }
 async remind(b:BookingRecord,email:Record<string,unknown>,now:string) {
  const r=b.rescheduleRequest;
  if(!r || r.state!=="open" || !r.reminderAt || r.remindedAt || r.reminderAt>now || r.expiresAt<=now) return;
  await this.db.batch([...this.mail(r.id,email,now,true),
   this.db.prepare("UPDATE booking_reschedule_requests SET reminded_at=?,updated_at=? WHERE id=? AND state='open' AND reminded_at IS NULL").bind(now,now,r.id),
   this.db.prepare("INSERT INTO booking_request_history(id,booking_id,occurrence_id,action,actor_type,created_at) SELECT ?,booking_id,occurrence_id,'reschedule_request_reminded','system',? FROM booking_reschedule_requests WHERE id=? AND reminded_at=?").bind(createId(),now,r.id,now)]);
 }
 async expire(b:BookingRecord,now:string) {
  const r=b.rescheduleRequest;if(!r || r.state!=="open" || r.expiresAt>now)return;
  await this.db.batch([
   this.db.prepare("UPDATE booking_reschedule_requests SET state='expired',updated_at=? WHERE id=? AND state='open' AND expires_at<=?").bind(now,r.id,now),
   this.db.prepare("INSERT INTO booking_request_history(id,booking_id,occurrence_id,action,actor_type,reason,created_at) SELECT ?,booking_id,occurrence_id,'reschedule_request_expired','system','no new time picked',? FROM booking_reschedule_requests WHERE id=? AND state='expired' AND updated_at=?").bind(createId(),now,r.id,now)]);
 }
}
