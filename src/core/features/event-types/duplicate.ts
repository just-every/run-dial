import { createId, nowIso } from "../../shared/ids";

type Source = { slug: string; title: string; updated_at: string };
type Child = { kind: "question" | "recurring" | "override" | "window" | "custom"; id: string; parent_id: string | null };

/** Copy one saved configuration atomically; bookings and public authority never carry across. */
export async function duplicateEvent(binding: D1Database, id: string): Promise<string | undefined> {
  const source = await binding.prepare("SELECT slug, title, updated_at FROM event_types WHERE id = ?").bind(id).first<Source>();
  if (!source) return undefined;
  const children = await binding.prepare(`
    SELECT 'question' AS kind, id, NULL AS parent_id FROM event_questions WHERE event_type_id = ?
    UNION ALL SELECT 'recurring', id, NULL FROM recurring_availability_windows WHERE event_type_id = ?
    UNION ALL SELECT 'override', id, NULL FROM availability_date_overrides WHERE event_type_id = ?
    UNION ALL SELECT 'window', w.id, w.override_id FROM availability_date_override_windows w
      JOIN availability_date_overrides o ON o.id = w.override_id WHERE o.event_type_id = ?
    UNION ALL SELECT 'custom', id, NULL FROM ext_custom_field_values WHERE event_type_id = ? AND entity = 'eventType'
  `).bind(id, id, id, id, id).all<Child>();
  const duplicateId = createId(), timestamp = nowIso();
  const slug = `${source.slug.slice(0, 48).replace(/-+$/, "")}-copy-${duplicateId.toLowerCase()}`;
  const title = `${source.title.slice(0, 153).replace(/[\uD800-\uDBFF]$/, "")} (copy)`;
  const overrideIds = new Map(children.results.filter(child => child.kind === "override").map(child => [child.id, createId()]));
  const statements = [binding.prepare(`
    INSERT INTO event_types (id, status, slug, title, description, duration_minutes, duration_options_json,
      color, location_type, location_label, location_value, listed, request_only, alternative_requests_enabled,
      slot_increment_minutes, minimum_notice_minutes, booking_horizon_days, booking_horizon_mode,
      booking_start_date, booking_end_date, before_buffer_minutes, after_buffer_minutes, host_day_booking_limit, post_booking_redirect_json,
      created_at, updated_at)
    SELECT ?, 'draft', ?, ?, description, duration_minutes, duration_options_json,
      color, location_type, location_label, location_value, listed, 0, alternative_requests_enabled,
      slot_increment_minutes, minimum_notice_minutes, booking_horizon_days, booking_horizon_mode,
      booking_start_date, booking_end_date, before_buffer_minutes, after_buffer_minutes, host_day_booking_limit, post_booking_redirect_json,
      ?, ? FROM event_types WHERE id = ? AND updated_at = ? RETURNING id
  `).bind(duplicateId, slug, title, timestamp, timestamp, id, source.updated_at)];
  const guard = "AND EXISTS (SELECT 1 FROM event_types WHERE id = ?)";
  statements.push(binding.prepare(`INSERT INTO event_schedule_bindings (event_type_id,schedule_id,created_at,updated_at) SELECT ?,schedule_id,?,? FROM event_schedule_bindings WHERE event_type_id=? ${guard}`).bind(duplicateId, timestamp, timestamp, id, duplicateId));
  statements.push(binding.prepare(`INSERT INTO booking_limit_policies (scope,limits_json,created_at,updated_at) SELECT ?,limits_json,?,? FROM booking_limit_policies WHERE scope=? ${guard}`).bind(duplicateId, timestamp, timestamp, id, duplicateId));
  // Parent overrides must precede their remapped windows within the same transaction.
  for (const child of children.results.filter(child => child.kind !== "window")) {
    const rowId = child.kind === "override" ? overrideIds.get(child.id)! : createId();
    if (child.kind === "question") statements.push(binding.prepare(`
      INSERT INTO event_questions (id, event_type_id, public_key, position, kind, label, required, private, options_json, created_at, updated_at)
      SELECT ?, ?, public_key, position, kind, label, required, private, options_json, ?, ?
      FROM event_questions WHERE id = ? AND event_type_id = ? ${guard}
    `).bind(rowId, duplicateId, timestamp, timestamp, child.id, id, duplicateId));
    if (child.kind === "recurring") statements.push(binding.prepare(`
      INSERT INTO recurring_availability_windows (id, event_type_id, weekday, start_minute, end_minute, created_at, updated_at)
      SELECT ?, ?, weekday, start_minute, end_minute, ?, ?
      FROM recurring_availability_windows WHERE id = ? AND event_type_id = ? ${guard}
    `).bind(rowId, duplicateId, timestamp, timestamp, child.id, id, duplicateId));
    if (child.kind === "override") statements.push(binding.prepare(`
      INSERT INTO availability_date_overrides (id, event_type_id, host_date, mode, created_at, updated_at)
      SELECT ?, ?, host_date, mode, ?, ? FROM availability_date_overrides
      WHERE id = ? AND event_type_id = ? ${guard}
    `).bind(rowId, duplicateId, timestamp, timestamp, child.id, id, duplicateId));
    if (child.kind === "custom") statements.push(binding.prepare(`
      INSERT INTO ext_custom_field_values (id, definition_id, entity, kind, event_type_id, booking_id, request_id, value_json, created_at, updated_at)
      SELECT ?, definition_id, entity, kind, ?, NULL, NULL, value_json, ?, ? FROM ext_custom_field_values
      WHERE id = ? AND event_type_id = ? AND entity = 'eventType' ${guard}
    `).bind(rowId, duplicateId, timestamp, timestamp, child.id, id, duplicateId));
  }
  for (const child of children.results.filter(child => child.kind === "window")) {
    const overrideId = child.parent_id && overrideIds.get(child.parent_id);
    if (!overrideId) throw new Error("Date override disappeared while duplicating; reload and try again.");
    statements.push(binding.prepare(`
      INSERT INTO availability_date_override_windows (id, override_id, position, start_minute, end_minute, created_at, updated_at)
      SELECT ?, ?, position, start_minute, end_minute, ?, ? FROM availability_date_override_windows
      WHERE id = ? AND override_id = ? ${guard}
    `).bind(createId(), overrideId, timestamp, timestamp, child.id, child.parent_id, duplicateId));
  }
  const results = await binding.batch(statements);
  if (results[0].results.length === 0) throw new Error("Event type changed while duplicating; reload and try again.");
  return duplicateId;
}
