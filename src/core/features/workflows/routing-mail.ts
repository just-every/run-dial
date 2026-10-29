import { createId } from "../../shared/ids";
import { operatorRecipientAdmission } from "../delivery/mail";
import type { WorkflowRule } from "./types";

const formOwner=`COALESCE((SELECT operator_id FROM api_hosts WHERE id=form.host_id),
 (SELECT operator_id FROM operator_setup_identity WHERE singleton_key='default'
  AND form.host_id=(SELECT id FROM host_profiles WHERE singleton_key='default')))`;

/** Recheck the source, owning host and enabling owner before every provider effect. */
export async function routingWorkflowMailAuthorized(db:D1Database,outboxId:string) {
 return Boolean(await db.prepare(`SELECT 1 FROM workflow_routing_mail_runs run
  JOIN workflow_rules rule ON rule.id=run.workflow_id JOIN oa_operators owner ON owner.id=rule.operator_id
  JOIN routing_submissions source ON source.id=run.routing_submission_id JOIN routing_forms form ON form.id=source.form_id
  JOIN operators recipient ON recipient.id=run.recipient_id JOIN delivery_outbox mail ON mail.id=run.outbox_id
  WHERE run.outbox_id=? AND rule.version=run.workflow_version AND rule.enabled=1 AND rule.removed_at IS NULL
   AND rule.trigger_kind='routing-without-booking' AND rule.action_type='email-hosts' AND rule.routing_form_id=form.id
   AND owner.status='active' AND owner.role='owner' AND source.state='disqualified'
   AND recipient.id=${formOwner} AND recipient.removed_at IS NULL AND recipient.erased_at IS NULL
   AND recipient.access_generation=json_extract(mail.payload_json,'$.operatorAccess.generation')`).bind(outboxId).first());
}

/** Only the owning host receives a notice, with no submitted answers or invitee authority. */
export async function queueRoutingWorkflowMail(db:D1Database,rule:WorkflowRule,timestamp:string) {
 const recipient=await db.prepare(`SELECT recipient.id,recipient.email,recipient.access_generation AS generation
  FROM routing_forms form JOIN operators recipient ON recipient.id=${formOwner}
  JOIN oa_operators authority ON authority.id=recipient.id WHERE form.id=? AND recipient.removed_at IS NULL
   AND recipient.erased_at IS NULL AND authority.status='active' AND authority.role='owner'`)
  .bind(rule.routing_form_id).first<{id:string;email:string;generation:number}>();
 if(!recipient)return 0;
 const sources=(await db.prepare(`SELECT source.id FROM routing_submissions source
  WHERE source.form_id=? AND source.state='disqualified' AND source.created_at>=? AND source.created_at>=? AND source.created_at<=?
   AND NOT EXISTS(SELECT 1 FROM workflow_routing_mail_runs run WHERE run.workflow_id=? AND run.routing_submission_id=source.id)
  ORDER BY source.created_at,source.id LIMIT 100`).bind(rule.routing_form_id,rule.enabled_at,rule.created_at,timestamp,rule.id).all<{id:string}>()).results;
 let queued=0;
 for(const source of sources){
  const id=createId(),outboxId=createId();
  const payload={to:recipient.email,recipientRole:"operator" as const,operatorAccess:{id:recipient.id,generation:recipient.generation},
   subject:rule.subject,text:rule.text+`\n\nRouting submission: ${source.id}\nOutcome: no booking`,messageKind:"routing_workflow",workflowId:rule.id,workflowVersion:rule.version,workflowCreatorId:rule.operator_id};
  const admission=operatorRecipientAdmission(payload);
  const result=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO workflow_routing_mail_runs(id,workflow_id,routing_submission_id,outbox_id,recipient_id,workflow_version,created_at)
    SELECT ?,r.id,source.id,?,?,r.version,? FROM workflow_rules r JOIN oa_operators owner ON owner.id=r.operator_id
    JOIN routing_submissions source ON source.form_id=r.routing_form_id JOIN routing_forms form ON form.id=source.form_id
    WHERE r.id=? AND r.version=? AND r.enabled=1 AND r.removed_at IS NULL AND r.action_type='email-hosts'
     AND r.trigger_kind='routing-without-booking' AND owner.status='active' AND owner.role='owner'
     AND source.id=? AND source.state='disqualified' AND ${formOwner}=? AND ${admission.sql}`)
    .bind(id,outboxId,recipient.id,timestamp,rule.id,rule.version,source.id,recipient.id,...admission.params),
   db.prepare(`INSERT OR IGNORE INTO delivery_outbox
    (id,kind,idempotency_key,booking_id,occurrence_id,request_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
    SELECT ?,'mail_send',?,NULL,NULL,NULL,?,'pending',0,?,?,?
    WHERE EXISTS(SELECT 1 FROM workflow_routing_mail_runs WHERE id=? AND outbox_id=?)`)
    .bind(outboxId,`routing-workflow:${rule.id}:${source.id}:${recipient.id}`,JSON.stringify(payload),timestamp,timestamp,timestamp,id,outboxId),
  ]);
  queued+=result[1].meta.changes;
 }
 return queued;
}
