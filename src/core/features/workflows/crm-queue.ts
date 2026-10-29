import { createId } from "../../shared/ids";
import { workflowCandidates } from "./candidates";
import type { WorkflowRule } from "./types";

export function workflowCrmAuthority(alias:string) {
 return `EXISTS(SELECT 1 FROM workflow_rules r JOIN oa_operators owner ON owner.id=r.operator_id
  JOIN workflow_crm_connections connection ON connection.id=r.crm_connection_id JOIN oa_operators connection_owner ON connection_owner.id=connection.operator_id JOIN bookings b ON b.event_type_id=r.event_type_id
  WHERE r.id=${alias}.workflow_id AND r.version=${alias}.workflow_version AND r.enabled=1 AND r.removed_at IS NULL
   AND r.action_type='hubspot-contact-update' AND owner.status='active' AND owner.role='owner'
   AND connection.id=${alias}.connection_id AND connection.version=${alias}.connection_version
   AND connection_owner.status='active' AND connection_owner.role='owner' AND connection.status='connected' AND connection.credential_ciphertext IS NOT NULL
   AND b.id=${alias}.booking_id AND b.current_occurrence_id=${alias}.occurrence_id AND b.state=${alias}.booking_state
   AND NOT EXISTS(SELECT 1 FROM person_erasure_locks lock WHERE lock.email=b.invitee_email_folded))`;
}
export async function queueCrmWorkflow(db:D1Database,rule:WorkflowRule,timestamp:string) {
 let queued=0;
 for(const candidate of await workflowCandidates(db,rule,timestamp)){
  const id=createId();
  const result=await db.prepare(`INSERT OR IGNORE INTO workflow_crm_runs
   (id,workflow_id,booking_id,occurrence_id,workflow_version,connection_id,connection_version,event_key,booking_state,properties_json,created_at,updated_at)
   SELECT ?,r.id,b.id,b.current_occurrence_id,r.version,c.id,c.version,?,b.state,
    json_object('dial_last_booking_id',b.id,'dial_last_booking_state',b.state,'dial_last_booking_start_at',o.start_at),?,?
   FROM workflow_rules r JOIN oa_operators owner ON owner.id=r.operator_id JOIN workflow_crm_connections c ON c.id=r.crm_connection_id
   JOIN bookings b ON b.event_type_id=r.event_type_id JOIN booking_occurrences o ON o.id=b.current_occurrence_id
   WHERE r.id=? AND r.version=? AND r.enabled=1 AND r.removed_at IS NULL AND r.action_type='hubspot-contact-update'
    AND owner.status='active' AND owner.role='owner' AND c.status='connected' AND c.credential_ciphertext IS NOT NULL
    AND b.id=? AND b.current_occurrence_id=? AND b.state=?
    AND NOT EXISTS(SELECT 1 FROM person_erasure_locks lock WHERE lock.email=b.invitee_email_folded)`)
   .bind(id,candidate.eventKey,timestamp,timestamp,rule.id,rule.version,candidate.bookingId,candidate.occurrenceId,candidate.state).run();
  queued+=result.meta.changes;
 }
 return queued;
}
