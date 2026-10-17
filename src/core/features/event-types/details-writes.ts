import { nextEventTimestampSql } from "../../shared/event-revision";
import { createId, nowIso } from "../../shared/ids";
import type { EventDetailsInput } from "./repository";

/** Edit visible event details/questions while preserving independently edited windows. */
export async function replaceEventDetails(binding: D1Database, id: string, input: EventDetailsInput) {
  const timestamp = nowIso();
  const results = await binding.batch([
    binding.prepare(`UPDATE event_types SET slug = ?, title = ?, description = ?, duration_minutes = ?, duration_options_json = ?, color = ?, location_type = ?, location_label = ?, location_value = ?, listed = ?, slot_increment_minutes = ?, minimum_notice_minutes = ?, booking_horizon_days = ?, booking_horizon_mode = ?, booking_start_date = ?, booking_end_date = ?, before_buffer_minutes = ?, after_buffer_minutes = ?, host_day_booking_limit = ?, post_booking_redirect_json = ?, updated_at = ${nextEventTimestampSql} WHERE id = ? RETURNING id`)
      .bind(input.slug, input.title, input.description, input.durationMinutes, JSON.stringify(input.durationOptionsMinutes ?? [input.durationMinutes]), input.color, input.locationType, input.locationLabel, input.locationValue, input.listed ? 1 : 0, input.slotIncrementMinutes, input.minimumNoticeMinutes, input.bookingHorizonDays, input.bookingHorizonMode ?? "calendar_days", input.bookingStartDate ?? null, input.bookingEndDate ?? null, input.beforeBufferMinutes, input.afterBufferMinutes, input.hostDayBookingLimit, input.postBookingRedirect ? JSON.stringify(input.postBookingRedirect) : null, timestamp, id),
    binding.prepare("DELETE FROM event_questions WHERE event_type_id = ?").bind(id),
    ...input.questions.map((question, position) => binding.prepare("INSERT INTO event_questions (id, event_type_id, public_key, position, kind, label, required, private, options_json, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM event_types WHERE id = ?)")
      .bind(createId(), id, question.key ?? `q_${createId()}`, position, question.kind, question.label, question.required ? 1 : 0, question.private ? 1 : 0, JSON.stringify(question.options), timestamp, timestamp, id)),
  ]);
  return results[0].results.length === 1;
}
