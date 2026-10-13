import { createId, nowIso } from "../../shared/ids";
import type { DateAvailabilityOverrideInput } from "./repository";
import { nextEventTimestampSql } from "./revision";

/** Override changes invalidate evaluations of the parent configuration in the same transaction. */
export async function replaceDateOverride(binding: D1Database, eventTypeId: string, input: DateAvailabilityOverrideInput) {
  const timestamp = nowIso();
  await binding.batch([
    binding.prepare(`UPDATE event_types SET updated_at = ${nextEventTimestampSql} WHERE id = ?`).bind(timestamp, eventTypeId),
    binding.prepare("INSERT INTO availability_date_overrides (id, event_type_id, host_date, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(event_type_id, host_date) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at")
      .bind(createId(), eventTypeId, input.hostDate, input.mode, timestamp, timestamp),
    binding.prepare("DELETE FROM availability_date_override_windows WHERE override_id = (SELECT id FROM availability_date_overrides WHERE event_type_id = ? AND host_date = ?)")
      .bind(eventTypeId, input.hostDate),
    ...input.windows.map((window, position) =>
      binding.prepare("INSERT INTO availability_date_override_windows (id, override_id, position, start_minute, end_minute, created_at, updated_at) SELECT ?, id, ?, ?, ?, ?, ? FROM availability_date_overrides WHERE event_type_id = ? AND host_date = ?")
        .bind(createId(), position, window.startMinute, window.endMinute, timestamp, timestamp, eventTypeId, input.hostDate),
    ),
  ]);
}

export async function deleteDateOverride(binding: D1Database, eventTypeId: string, hostDate: string) {
  const results = await binding.batch([
    binding.prepare(`UPDATE event_types SET updated_at = ${nextEventTimestampSql} WHERE id = ? AND EXISTS (SELECT 1 FROM availability_date_overrides WHERE event_type_id = ? AND host_date = ?)`)
      .bind(nowIso(), eventTypeId, eventTypeId, hostDate),
    binding.prepare("DELETE FROM availability_date_overrides WHERE event_type_id = ? AND host_date = ? RETURNING id").bind(eventTypeId, hostDate),
  ]);
  return results[1].results.length === 1;
}
