import type { WorkflowRule } from "./types";
export type WorkflowCandidate={bookingId:string;occurrenceId:string;inviteeEmail:string;eventKey:string;happenedAt:string;state:string};

/** Read native facts. Timed work follows the current occurrence and never a superseded time. */
export async function workflowCandidates(db:D1Database,rule:WorkflowRule,timestamp:string) {
 const action=rule.trigger==="booking-rescheduled"?"rescheduled":rule.trigger==="booking-canceled"?"cancelled":rule.trigger.startsWith("marked-")?"attendance_marked":"created";
 const timed=rule.trigger==="before-start"||rule.trigger==="after-end";
 const payment=rule.trigger==="payment-received";
 const paymentFacts=`JOIN (
  SELECT id,booking_id,paid_at FROM booking_payments WHERE status='paid' AND amount_cents>0
  UNION ALL SELECT id,booking_id,updated_at AS paid_at FROM payment_movements
   WHERE status='succeeded' AND amount_cents>0 AND kind IN ('balance','invoice','late_cancel_fee','no_show_fee')
 ) fact ON fact.booking_id=b.id`;
 const source=payment?paymentFacts:timed?"":"JOIN booking_history fact ON fact.booking_id=b.id AND fact.action=?";
 const key=rule.trigger==="booking-created"?"'booking-created'":timed?"o.id":"fact.id";
 const time=payment?"fact.paid_at":timed?`strftime('%Y-%m-%dT%H:%M:%fZ',o.${rule.trigger==="before-start"?"start_at":"end_at"},?)`:"fact.created_at";
 const state=rule.trigger==="booking-canceled"?"b.state='cancelled'":"b.state IN ('confirmed','rescheduled')";
 const attended=rule.trigger.startsWith("marked-")?"AND EXISTS(SELECT 1 FROM booking_attendance a WHERE a.booking_id=b.id AND a.status=?)":"";
 const params=[...(!payment&&!timed?[action]:[]),rule.event_type_id,...(timed?[rule.enabled_at]:[]),...(rule.trigger.startsWith("marked-")?[rule.trigger==="marked-attended"?"attended":"no_show"]:[])];
 // SQL parameters in the projection precede those in JOIN and WHERE.
 const projection=timed?[`${rule.trigger==="before-start"?"-":"+"}${rule.offset_minutes} minutes`]:[];
 const rows=(await db.prepare(`SELECT * FROM (SELECT b.id AS bookingId,b.current_occurrence_id AS occurrenceId,b.invitee_email AS inviteeEmail,b.state,${key} AS eventKey,${time} AS happenedAt
  FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id ${source}
  WHERE b.event_type_id=? ${timed?"AND b.created_at>=?":""} AND ${state} ${attended}
   AND NOT EXISTS(SELECT 1 FROM person_erasure_locks lock WHERE lock.email=b.invitee_email_folded))
  WHERE happenedAt>=? AND happenedAt>=? AND happenedAt<=?
   AND NOT EXISTS(SELECT 1 FROM workflow_dispatches d WHERE d.workflow_id=? AND d.booking_id=bookingId AND d.event_key=eventKey)
  AND NOT EXISTS(SELECT 1 FROM workflow_webhook_runs run WHERE run.workflow_id=? AND run.event_key=bookingId || ':' || eventKey)
  AND NOT EXISTS(SELECT 1 FROM workflow_crm_runs run WHERE run.workflow_id=? AND run.booking_id=bookingId AND run.event_key=eventKey)
  ORDER BY happenedAt,bookingId LIMIT 100`).bind(...projection,...params,rule.enabled_at,rule.created_at,timestamp,rule.id,rule.id,rule.id).all<WorkflowCandidate>()).results;
 return rows;
}
