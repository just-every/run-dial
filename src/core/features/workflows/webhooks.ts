import { createId } from "../../shared/ids";
import { workflowCandidates } from "./candidates";
import { workflowTrigger, type WorkflowRule } from "./types";

const subscriptionScope=`EXISTS(SELECT 1 FROM json_each(s.events_json) WHERE value='workflow.action.v1')
 AND (s.scope='workspace' OR s.scope='host' AND s.scope_id=(SELECT id FROM host_profiles WHERE singleton_key='default')
 OR s.scope='team' AND r.trigger_kind IS NULL AND EXISTS(SELECT 1 FROM team_event_types t WHERE t.team_id=s.scope_id AND t.event_type_id=r.event_type_id))`;

/** This predicate is checked at claim and again after DNS and signing yield. */
export function workflowWebhookAuthority(alias:string) {
 return `(${alias}.workflow_id IS NULL OR EXISTS(SELECT 1 FROM workflow_rules r JOIN oa_operators owner ON owner.id=r.operator_id
  WHERE r.id=${alias}.workflow_id AND r.version=${alias}.workflow_version AND r.enabled=1 AND r.removed_at IS NULL
   AND r.action_kind='webhook' AND r.webhook_subscription_id=${alias}.subscription_id AND owner.status='active' AND owner.role='owner'
   AND EXISTS(SELECT 1 FROM webhook_subscriptions s WHERE s.id=${alias}.subscription_id AND ${subscriptionScope})
   AND (${alias}.booking_id IS NULL OR EXISTS(SELECT 1 FROM bookings b WHERE b.id=${alias}.booking_id
    AND b.current_occurrence_id=${alias}.workflow_occurrence_id AND b.state=${alias}.workflow_booking_state))
   AND (${alias}.routing_submission_id IS NULL OR EXISTS(SELECT 1 FROM routing_submissions s
    WHERE s.id=${alias}.routing_submission_id AND s.form_id=r.routing_form_id AND s.state='disqualified'))))`;
}

/** Reuse the signed, bounded retry transport; captures contain no answers or private links. */
export async function queueWorkflowWebhooks(db:D1Database,rule:WorkflowRule,timestamp:string) {
 if(!rule.webhook_subscription_id)return 0;
 const routing=workflowTrigger(rule)==="routing-without-booking";
 const candidates=routing?(await db.prepare(`SELECT id AS sourceId,created_at AS happenedAt FROM routing_submissions
  WHERE form_id=? AND state='disqualified' AND created_at>=? AND created_at>=? AND created_at<=?
  AND NOT EXISTS(SELECT 1 FROM workflow_webhook_runs run WHERE run.workflow_id=? AND run.event_key=routing_submissions.id)
  ORDER BY created_at,id LIMIT 100`).bind(rule.routing_form_id,rule.enabled_at,rule.created_at,timestamp,rule.id).all<{sourceId:string;happenedAt:string}>()).results
  :(await workflowCandidates(db,rule,timestamp)).map(row=>({...row,sourceId:`${row.bookingId}:${row.eventKey}`}));
 let queued=0;
 for(const candidate of candidates){
  const runId=createId(),deliveryId=createId(),eventId=`workflow:${rule.id}:${candidate.sourceId}`;
  const bookingId="bookingId" in candidate?candidate.bookingId:null;
  const occurrenceId="occurrenceId" in candidate?candidate.occurrenceId:null;
  const state="state" in candidate?candidate.state:null;
  const data=routing?await db.prepare("SELECT id AS submissionId,form_id AS formId,rule_id AS ruleId,state FROM routing_submissions WHERE id=?").bind(candidate.sourceId).first()
   :await db.prepare(`SELECT b.id AS bookingId,b.event_type_id AS eventTypeId,b.state,b.duration_minutes AS durationMinutes,
    o.start_at AS startAt,o.end_at AS endAt,json(b.attribution_json) AS attribution FROM bookings b
    JOIN booking_occurrences o ON o.id=b.current_occurrence_id WHERE b.id=?`).bind(bookingId).first<{attribution:string}>();
  if(!data)continue;
  if("attribution" in data&&typeof data.attribution==="string")data.attribution=JSON.parse(data.attribution);
  const body=JSON.stringify({id:eventId,type:"workflow.action.v1",occurredAt:candidate.happenedAt,workflowId:rule.id,trigger:workflowTrigger(rule),data});
  const results=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO webhook_deliveries(id,subscription_id,event_id,event_type,booking_id,body_json,next_attempt_at,retry_until,created_at,updated_at,
    workflow_id,workflow_version,workflow_occurrence_id,workflow_booking_state,routing_submission_id)
    SELECT ?,s.id,?,'workflow.action.v1',?,?,?,?,?,?,r.id,r.version,?,?,? FROM workflow_rules r
    JOIN oa_operators owner ON owner.id=r.operator_id JOIN webhook_subscriptions s ON s.id=r.webhook_subscription_id
    WHERE r.id=? AND r.version=? AND r.enabled=1 AND r.removed_at IS NULL AND owner.status='active' AND owner.role='owner'
    AND s.enabled=1 AND s.secret_ciphertext IS NOT NULL AND ${subscriptionScope}
    AND NOT EXISTS(SELECT 1 FROM workflow_webhook_runs run WHERE run.workflow_id=r.id AND run.event_key=?)`)
    .bind(deliveryId,eventId,bookingId,body,timestamp,new Date(Date.parse(timestamp)+86400000).toISOString(),timestamp,timestamp,occurrenceId,state,routing?candidate.sourceId:null,rule.id,rule.version,candidate.sourceId),
   db.prepare(`INSERT OR IGNORE INTO workflow_webhook_runs(id,workflow_id,booking_id,routing_submission_id,event_key,delivery_id,created_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM webhook_deliveries WHERE id=?)`)
    .bind(runId,rule.id,bookingId,routing?candidate.sourceId:null,candidate.sourceId,deliveryId,timestamp,deliveryId),
  ]);
  queued+=results[1].meta.changes;
 }
 return queued;
}
