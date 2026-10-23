import { createId } from '../../shared/ids';
/** Shares the booking/occurrence identity and atomic claim transaction with native mail. */
export function noticeStatements(db:D1Database,bookingId:string,occurrenceId:string|undefined,now:string,cancelled=false){return [db.prepare(`INSERT INTO workspace_notice_deliveries(id,destination_id,generation,account_id,channel_id,booking_id,occurrence_id,event_kind,idempotency_key,state,next_attempt_at,created_at,updated_at)
 SELECT ? || ':' || d.id,d.id,d.generation,d.external_key,d.target,b.id,o.id,CASE WHEN ?=1 THEN 'cancelled' WHEN o.sequence=0 THEN 'created' ELSE 'rescheduled' END,
 'booking:' || b.id || ':occurrence:' || o.id || ':notice:' || CASE WHEN ?=1 THEN 'cancelled' ELSE 'confirmed' END || ':' || d.id || ':' || d.generation,'pending',?,?,?
 FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id JOIN workspace_notice_destinations d ON d.status='connected'
 WHERE b.id=? AND (? IS NULL OR o.id=?) AND ((?=1 AND b.state='cancelled' AND b.cancelled_at=?) OR (?=0 AND b.state IN ('confirmed','rescheduled')))
 ON CONFLICT(idempotency_key) DO NOTHING`).bind(createId(),cancelled?1:0,cancelled?1:0,now,now,now,bookingId,occurrenceId??null,occurrenceId??null,cancelled?1:0,now,cancelled?1:0)];}
