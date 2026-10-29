import { createId } from "../../shared/ids";
import type { RuntimeEnvironment } from "../../shared/runtime-env";

type Candidate={workflowId:string;version:number;operatorId:string;subject:string;text:string;bookingId:string;occurrenceId:string;inviteeEmail:string};
/** Only explicit owner-enabled rules can queue mail, and only for bookings made after that enablement. */
export async function runWorkflows(db:D1Database,_runtime?:RuntimeEnvironment,now=new Date()) {
 const timestamp=now.toISOString();
 const candidates=(await db.prepare(`SELECT r.id AS workflowId,r.version,r.operator_id AS operatorId,r.subject,r.text,
  b.id AS bookingId,b.current_occurrence_id AS occurrenceId,b.invitee_email AS inviteeEmail
  FROM workflow_rules r JOIN oa_operators owner ON owner.id=r.operator_id
  JOIN bookings b ON b.event_type_id=r.event_type_id
  WHERE r.enabled=1 AND r.removed_at IS NULL AND r.enabled_at IS NOT NULL
   AND owner.status='active' AND owner.role='owner'
   AND b.created_at>=r.enabled_at AND b.created_at>=r.created_at AND b.created_at<=?
   AND b.state IN ('confirmed','rescheduled')
   AND NOT EXISTS(SELECT 1 FROM workflow_dispatches d WHERE d.workflow_id=r.id AND d.booking_id=b.id)
  ORDER BY b.created_at,b.id,r.id LIMIT 100`).bind(timestamp).all<Candidate>()).results;
 let queued=0;
 for(const candidate of candidates){
  const id=createId(),outboxId=createId(),key=`workflow:${candidate.workflowId}:${candidate.bookingId}`;
  const payload=JSON.stringify({to:candidate.inviteeEmail,subject:candidate.subject,text:candidate.text,
   recipientRole:"invitee",messageKind:"workflow",workflowId:candidate.workflowId,
   workflowVersion:candidate.version,workflowCreatorId:candidate.operatorId});
  const results=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO workflow_dispatches(id,workflow_id,booking_id,outbox_id,workflow_version,created_at)
    SELECT ?,r.id,b.id,?,r.version,? FROM workflow_rules r
    JOIN oa_operators owner ON owner.id=r.operator_id JOIN bookings b ON b.event_type_id=r.event_type_id
    WHERE r.id=? AND r.version=? AND r.enabled=1 AND r.removed_at IS NULL
     AND owner.status='active' AND owner.role='owner'
     AND b.id=? AND b.current_occurrence_id=? AND b.state IN ('confirmed','rescheduled')
     AND b.created_at>=r.enabled_at AND b.created_at>=r.created_at`)
    .bind(id,outboxId,timestamp,candidate.workflowId,candidate.version,candidate.bookingId,candidate.occurrenceId),
   db.prepare(`INSERT OR IGNORE INTO delivery_outbox
    (id,kind,idempotency_key,booking_id,occurrence_id,request_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
    SELECT ?,'mail_send',?,?,?,NULL,?,'pending',0,?,?,?
    WHERE EXISTS(SELECT 1 FROM workflow_dispatches WHERE id=? AND outbox_id=?)`)
    .bind(outboxId,key,candidate.bookingId,candidate.occurrenceId,payload,timestamp,timestamp,timestamp,id,outboxId),
  ]);
  queued+=results[1].meta.changes;
 }
 return {queued};
}
