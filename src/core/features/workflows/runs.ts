export async function workflowRuns(db:D1Database,id:string) {
 return (await db.prepare(`SELECT d.id AS id,d.booking_id AS bookingId,NULL AS submissionId,d.event_key AS eventKey,d.recipient_key AS recipient,
  CASE WHEN o.state='succeeded' THEN 'sent' WHEN o.state='failed' AND o.last_error_code IN ('workflow_authority_revoked','superseded_occurrence','operator_removed') THEN 'skipped' WHEN o.state='failed' THEN 'failed' ELSE 'pending' END AS outcome,
  o.last_error_code AS reason,d.created_at AS createdAt FROM workflow_dispatches d JOIN delivery_outbox o ON o.id=d.outbox_id WHERE d.workflow_id=?
  UNION ALL SELECT d.id AS id,d.booking_id AS bookingId,d.routing_submission_id AS submissionId,d.event_key AS eventKey,'webhook' AS recipient,
  CASE WHEN o.state='delivered' THEN 'sent' WHEN o.id IS NULL OR o.last_error='workflow_authority_revoked' THEN 'skipped' WHEN o.state='failed' THEN 'failed' ELSE 'pending' END AS outcome,
  CASE WHEN o.id IS NULL THEN 'destination_removed' ELSE o.last_error END AS reason,d.created_at AS createdAt
  FROM workflow_webhook_runs d LEFT JOIN webhook_deliveries o ON o.id=d.delivery_id WHERE d.workflow_id=? ORDER BY id`).bind(id,id).all<{id:string}>()).results;
}
