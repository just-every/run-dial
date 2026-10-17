import { nextEventTimestampSql } from "../../shared/event-revision";
import { createId, nowIso } from "../../shared/ids";
import type { AvailabilityWindowInput } from "./repository";
import { NamedSchedules } from "../availability";

/** Replace only recurring windows, atomically, without stale event/question input. */
export async function replaceRecurringWindows(binding: D1Database, eventTypeId: string, windows: AvailabilityWindowInput[]) {
  if (await new NamedSchedules(binding).replaceWindows(eventTypeId, windows)) return true;
  const timestamp = nowIso();
  const results = await binding.batch([
    binding.prepare(`UPDATE event_types SET updated_at = ${nextEventTimestampSql} WHERE id = ? RETURNING id`).bind(timestamp, eventTypeId),
    binding.prepare("DELETE FROM recurring_availability_windows WHERE event_type_id = ?").bind(eventTypeId),
    ...windows.map((window) => binding.prepare("INSERT INTO recurring_availability_windows (id, event_type_id, weekday, start_minute, end_minute, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM event_types WHERE id = ?)")
      .bind(createId(), eventTypeId, window.weekday, window.startMinute, window.endMinute, timestamp, timestamp, eventTypeId)),
  ]);
  return results[0].results.length === 1;
}
