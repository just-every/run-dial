import { createId } from "../../shared/ids";

/** Join the event copy transaction with configuration only, never execution history. */
export async function duplicateWorkflowStatements(
  binding: D1Database, sourceEventId: string, copyEventId: string, timestamp: string,
): Promise<D1PreparedStatement[]> {
  const rules = await binding.prepare(
    "SELECT id FROM workflow_rules WHERE event_type_id = ? AND removed_at IS NULL ORDER BY id",
  ).bind(sourceEventId).all<{ id: string }>();
  return rules.results.map(rule => binding.prepare(`
    INSERT INTO workflow_rules (id, name, event_type_id, operator_id, enabled, enabled_at,
      subject, text, created_at, updated_at)
    SELECT ?, name, ?, operator_id, enabled, CASE WHEN enabled = 1 THEN ? ELSE NULL END,
      subject, text, ?, ? FROM workflow_rules
    WHERE id = ? AND event_type_id = ? AND removed_at IS NULL
      AND EXISTS (SELECT 1 FROM event_types WHERE id = ?)
  `).bind(createId(), copyEventId, timestamp, timestamp, timestamp, rule.id, sourceEventId, copyEventId));
}
