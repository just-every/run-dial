import type { CorrespondenceConfig, CorrespondenceQuestion, CorrespondenceValues } from "../../shared/correspondence";
import { formatTimeRange } from "./booking-mail-times";

type BookingTemplateRow = {
  config: string; eventTypeId: string | null; eventTitle: string; inviteeName: string; hostName: string;
  inviteeTimezone: string; hostTimezone: string; lockedTimezone: string | null;
  startAt: string; endAt: string; locationType: string; locationLabel: string; locationValue: string; meetingUrl: string | null;
};
export type BookingCorrespondence = { config: CorrespondenceConfig; values: CorrespondenceValues; questions: CorrespondenceQuestion[] };

export class BookingCorrespondenceRepository {
  constructor(private readonly binding: D1Database) {}
  async read(bookingId: string, occurrenceId: string): Promise<BookingCorrespondence | undefined> {
    const row = await this.binding.prepare(`SELECT COALESCE(current.templates_json,retained.templates_json) AS config,
      b.event_type_id AS eventTypeId,b.event_title AS eventTitle,b.invitee_name AS inviteeName,
      p.name AS hostName,b.invitee_timezone AS inviteeTimezone,b.host_timezone AS hostTimezone,
      presentation.locked_timezone AS lockedTimezone,o.start_at AS startAt,o.end_at AS endAt,
      b.location_type AS locationType,b.location_label AS locationLabel,b.location_value AS locationValue,b.meeting_url AS meetingUrl
      FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id
      JOIN host_profiles p ON p.singleton_key='default'
      LEFT JOIN event_correspondence current ON current.event_type_id=b.event_type_id
      LEFT JOIN booking_correspondence retained ON retained.booking_id=b.id
      LEFT JOIN booking_presentation presentation ON presentation.booking_id=b.id
      WHERE b.id=? AND o.id=? AND (current.templates_json IS NOT NULL OR retained.templates_json IS NOT NULL)`)
      .bind(bookingId, occurrenceId).first<BookingTemplateRow>();
    if (!row) return undefined;
    const [answers, questions] = await Promise.all([
      this.binding.prepare(`SELECT question_key AS key,question_label AS label,value_json AS value FROM booking_answers WHERE booking_id=? ORDER BY created_at`).bind(bookingId).all<{ key: string; label: string; value: string }>(),
      this.binding.prepare(`SELECT COALESCE(public_key,'q_'||id) AS key,label,private FROM event_questions WHERE event_type_id=? ORDER BY position`).bind(row.eventTypeId).all<{ key: string; label: string; private: number }>(),
    ]);
    // Without a current event, answer privacy cannot be inferred. Mail still uses
    // the invitee's own snapshots; shared calendar defaults include no answers.
    const metadata = questions.results.length ? questions.results.map(question => ({ ...question, private: question.private === 1 }))
      : answers.results.map(answer => ({ key: answer.key, label: answer.label, private: true }));
    const answerValues = Object.fromEntries(answers.results.map(answer => {
      const parsed: string | string[] = JSON.parse(answer.value);
      return [answer.key, Array.isArray(parsed) ? parsed.join(", ") : parsed];
    }));
    // Newly added questions have no answer on an older booking; absence is explicit.
    for (const question of metadata) if (!Object.hasOwn(answerValues, question.key)) answerValues[question.key] = "Not answered";
    const zone = row.lockedTimezone ?? row.inviteeTimezone;
    return { config: JSON.parse(row.config) as CorrespondenceConfig, questions: metadata, values: {
      "invitee full name": row.inviteeName, "invitee first name": row.inviteeName.trim().split(/\s+/u)[0],
      "host name": row.hostName, "event name": row.eventTitle,
      "date and time": formatTimeRange(row.startAt, row.endAt, zone, Boolean(row.lockedTimezone)),
      duration: `${(Date.parse(row.endAt) - Date.parse(row.startAt)) / 60_000} minutes`,
      location: row.locationType === "google_meet" ? row.meetingUrl ?? "Meeting link pending" : `${row.locationLabel}: ${row.locationValue}`,
      "manage link": "", message: "", answers: answerValues,
    } };
  }
}
