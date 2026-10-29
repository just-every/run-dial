import { createId } from "../../shared/ids";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { BookingsRepository } from "../bookings";
import { operatorRecipientAdmission } from "../delivery/mail";
import type { WorkflowRule } from "./types";
import { workflowCandidates } from "./candidates";

/** Only explicit owner-enabled rules queue actions; every native event and recipient is dispatched once. */
export async function runWorkflows(db:D1Database,_runtime?:RuntimeEnvironment,now=new Date()) {
 const timestamp=now.toISOString();
 const rules=(await db.prepare(`SELECT r.* FROM workflow_rules r JOIN oa_operators owner ON owner.id=r.operator_id
  WHERE r.enabled=1 AND r.removed_at IS NULL AND r.enabled_at IS NOT NULL AND owner.status='active' AND owner.role='owner' ORDER BY r.id`).all<WorkflowRule>()).results;
 let queued=0;
 for(const rule of rules)for(const candidate of await workflowCandidates(db,rule,timestamp)){
  const recipients=rule.action==="email-hosts"?(await new BookingsRepository(db).listOperatorRecipients()).map(host=>({to:host.email,key:host.id,recipientRole:"operator" as const,operatorAccess:{id:host.id,generation:host.generation}})):[{to:candidate.inviteeEmail,key:"invitee",recipientRole:"invitee" as const,operatorAccess:undefined}];
  for(const recipient of recipients){
   const id=createId(),outboxId=createId(),key=`workflow:${rule.id}:${candidate.bookingId}:${candidate.eventKey}:${recipient.key}`;
   const payload=JSON.stringify({...recipient,subject:rule.subject,text:rule.text,bookingState:candidate.state,
    messageKind:"workflow",workflowId:rule.id,workflowVersion:rule.version,workflowCreatorId:rule.operator_id});
   const admission=operatorRecipientAdmission(recipient);
   const results=await db.batch([
    db.prepare(`INSERT OR IGNORE INTO workflow_dispatches(id,workflow_id,booking_id,outbox_id,workflow_version,event_key,recipient_key,created_at)
     SELECT ?,r.id,b.id,?,r.version,?,?,? FROM workflow_rules r
     JOIN oa_operators owner ON owner.id=r.operator_id JOIN bookings b ON b.event_type_id=r.event_type_id
     WHERE r.id=? AND r.version=? AND r.enabled=1 AND r.removed_at IS NULL
      AND owner.status='active' AND owner.role='owner' AND b.id=? AND b.current_occurrence_id=? AND b.state=?
      AND NOT EXISTS(SELECT 1 FROM person_erasure_locks lock WHERE lock.email=b.invitee_email_folded)
      AND ${admission.sql}`)
     .bind(id,outboxId,candidate.eventKey,recipient.key,timestamp,rule.id,rule.version,candidate.bookingId,candidate.occurrenceId,candidate.state,...admission.params),
    db.prepare(`INSERT OR IGNORE INTO delivery_outbox
     (id,kind,idempotency_key,booking_id,occurrence_id,request_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
     SELECT ?,'mail_send',?,?,?,NULL,?,'pending',0,?,?,?
     WHERE EXISTS(SELECT 1 FROM workflow_dispatches WHERE id=? AND outbox_id=?)`)
     .bind(outboxId,key,candidate.bookingId,candidate.occurrenceId,payload,timestamp,timestamp,timestamp,id,outboxId),
   ]);
   queued+=results[1].meta.changes;
  }
 }
 return {queued};
}
