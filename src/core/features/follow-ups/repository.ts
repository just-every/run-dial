import { createId, nowIso } from "../../shared/ids";
import { defaultFollowUp, type FollowUpCandidate, type FollowUpHistory, type FollowUpSettings } from "./types";
const settingsFields = "enabled,kind,message_text AS text,offset_minutes AS offsetMinutes,attended_only AS attendedOnly,target_event_type_id AS targetEventTypeId";
const bools = (row: FollowUpSettings) => ({ ...row, enabled: Boolean(row.enabled), attendedOnly: Boolean(row.attendedOnly) });
export class FollowUpsRepository {
  constructor(private readonly db: D1Database) {}
  async settings(eventId: string) {
    if (!await this.db.prepare("SELECT 1 FROM event_types WHERE id=?").bind(eventId).first()) return undefined;
    const row = await this.db.prepare(`SELECT ${settingsFields} FROM event_follow_up_settings WHERE event_type_id=?`).bind(eventId).first<FollowUpSettings>();
    return row ? bools(row) : { ...defaultFollowUp };
  }
  async questionKeys(eventId: string) { return (await this.db.prepare("SELECT COALESCE(public_key,'q_'||id) AS key FROM event_questions WHERE event_type_id=?").bind(eventId).all<{ key: string }>()).results.map(row => row.key); }
  async validTarget(eventId: string) { return Boolean(await this.db.prepare("SELECT 1 FROM event_types WHERE id=? AND status='published'").bind(eventId).first()); }
  async save(eventId: string, input: FollowUpSettings) {
    if (!await this.settings(eventId)) return false;
    const timestamp = nowIso();
    await this.db.batch([
      this.db.prepare(`INSERT INTO event_follow_up_settings(id,event_type_id,enabled,kind,message_text,offset_minutes,attended_only,target_event_type_id,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(event_type_id) DO UPDATE SET enabled=excluded.enabled,kind=excluded.kind,message_text=excluded.message_text,offset_minutes=excluded.offset_minutes,attended_only=excluded.attended_only,target_event_type_id=excluded.target_event_type_id,version=event_follow_up_settings.version+1,updated_at=excluded.updated_at`)
        .bind(createId(), eventId, input.enabled ? 1 : 0, input.kind, input.text, input.offsetMinutes, input.attendedOnly ? 1 : 0, input.targetEventTypeId, timestamp, timestamp),
      this.db.prepare("UPDATE follow_up_runs SET state='skipped',reason='setting_disabled',updated_at=? WHERE ?=0 AND state IN ('pending','waiting') AND booking_id IN (SELECT id FROM bookings WHERE event_type_id=?)").bind(timestamp, input.enabled ? 1 : 0, eventId),
      this.db.prepare("UPDATE delivery_outbox SET state='failed',last_error_code='follow_up_disabled',updated_at=? WHERE ?=0 AND state='pending' AND id IN (SELECT r.outbox_id FROM follow_up_runs r JOIN bookings b ON b.id=r.booking_id WHERE b.event_type_id=?)").bind(timestamp, input.enabled ? 1 : 0, eventId),
    ]); return true;
  }
  async due(now: string) {
    await this.db.prepare("UPDATE follow_up_runs SET state='skipped',reason='setting_unavailable',updated_at=? WHERE state IN ('pending','waiting') AND archive_historical=0 AND NOT EXISTS(SELECT 1 FROM bookings b JOIN event_follow_up_settings s ON s.event_type_id=b.event_type_id WHERE b.id=follow_up_runs.booking_id)").bind(now).run();
    const rows = await this.db.prepare(`SELECT r.id,r.booking_id AS bookingId,r.occurrence_id AS occurrenceId,r.due_at AS dueAt,r.state,
      s.enabled,s.kind,s.message_text AS text,s.offset_minutes AS offsetMinutes,s.attended_only AS attendedOnly,s.target_event_type_id AS targetEventTypeId,s.version,
      b.event_type_id AS eventTypeId,b.event_title AS eventTitle,b.invitee_name AS inviteeName,b.invitee_email AS inviteeEmail,b.invitee_timezone AS timeZone,
      o.start_at AS startsAt,o.end_at AS endsAt,p.name AS hostName,p.handle AS hostHandle,
      CASE WHEN b.location_type IN ('google_meet','microsoft_teams') THEN COALESCE(b.meeting_url,'Meeting link unavailable') ELSE b.location_value END AS location,
      a.status AS attendance,t.slug AS targetSlug,CASE WHEN t.status='published' THEN 1 ELSE 0 END AS targetPublished
      FROM follow_up_runs r JOIN bookings b ON b.id=r.booking_id JOIN booking_occurrences o ON o.id=b.current_occurrence_id
      JOIN event_follow_up_settings s ON s.event_type_id=b.event_type_id JOIN host_profiles p ON p.singleton_key='default'
      LEFT JOIN booking_attendance a ON a.booking_id=b.id LEFT JOIN event_types t ON t.id=COALESCE(s.target_event_type_id,b.event_type_id)
      WHERE r.archive_historical=0 AND r.state IN ('pending','waiting') AND r.due_at<=? AND o.end_at<=? AND r.occurrence_id=o.id AND b.state IN ('confirmed','rescheduled')
      ORDER BY r.due_at,r.id LIMIT 100`).bind(now, now).all<FollowUpCandidate>();
    return Promise.all(rows.results.map(async row => {
      const answers = await this.db.prepare("SELECT question_key AS key,value_json AS value FROM booking_answers WHERE booking_id=?").bind(row.bookingId).all<{ key: string; value: string }>();
      return { ...bools(row), ...row, enabled: Boolean(row.enabled), attendedOnly: Boolean(row.attendedOnly), targetPublished: Boolean(row.targetPublished), answers: Object.fromEntries(answers.results.map(answer => { const value: string | string[] = JSON.parse(answer.value); return [answer.key, Array.isArray(value) ? value.join(", ") : value]; })) };
    }));
  }
  async wait(run: FollowUpCandidate, reason: string, now: string) { await this.db.prepare("UPDATE follow_up_runs SET state='waiting',reason=?,updated_at=? WHERE id=? AND state IN ('pending','waiting') AND archive_historical=0").bind(reason, now, run.id).run(); }
  async fail(run: FollowUpCandidate, reason: string, now: string) { await this.db.prepare("UPDATE follow_up_runs SET state='failed',reason=?,updated_at=? WHERE id=? AND state IN ('pending','waiting') AND archive_historical=0").bind(reason, now, run.id).run(); }
  async recordSkipped(run: FollowUpCandidate, reason: string, now: string) { await this.db.prepare("UPDATE follow_up_runs SET state='skipped',reason=?,updated_at=? WHERE id=? AND state IN ('pending','waiting') AND archive_historical=0").bind(reason, now, run.id).run(); }
  async enqueue(run: FollowUpCandidate, message: { subject: string; text: string; html: string }, now: string) {
    const key = `booking:${run.bookingId}:occurrence:${run.occurrenceId}:follow-up`, id = createId();
    await this.db.batch([
      this.db.prepare(`INSERT INTO delivery_outbox(id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
        SELECT ?,'mail_send',?,b.id,r.occurrence_id,?,'pending',0,?,?,? FROM follow_up_runs r JOIN bookings b ON b.id=r.booking_id
        JOIN event_follow_up_settings s ON s.event_type_id=b.event_type_id
        WHERE r.id=? AND r.state IN ('pending','waiting') AND r.archive_historical=0 AND s.enabled=1 AND s.version=?
          AND b.state IN ('confirmed','rescheduled') AND b.current_occurrence_id=r.occurrence_id
          AND (s.attended_only=0 OR EXISTS(SELECT 1 FROM booking_attendance a WHERE a.booking_id=b.id AND a.status='attended'))
        ON CONFLICT(idempotency_key) DO NOTHING`)
        .bind(id, key, JSON.stringify({ to: run.inviteeEmail, recipientRole: "invitee", messageKind: "follow_up", ...message }), now, now, now, run.id, run.version),
      this.db.prepare("UPDATE follow_up_runs SET state='queued',reason=NULL,outbox_id=(SELECT id FROM delivery_outbox WHERE idempotency_key=?),updated_at=? WHERE id=? AND state IN ('pending','waiting') AND EXISTS(SELECT 1 FROM delivery_outbox WHERE idempotency_key=?)").bind(key, now, run.id, key),
    ]);
  }
  async admit(outboxId: string) {
    return Boolean(await this.db.prepare(`SELECT 1 FROM follow_up_runs r JOIN bookings b ON b.id=r.booking_id
      JOIN event_follow_up_settings s ON s.event_type_id=b.event_type_id
      WHERE r.outbox_id=? AND r.state='queued' AND r.archive_historical=0 AND s.enabled=1
        AND b.state IN ('confirmed','rescheduled') AND b.current_occurrence_id=r.occurrence_id
        AND (s.attended_only=0 OR EXISTS(SELECT 1 FROM booking_attendance a WHERE a.booking_id=b.id AND a.status='attended'))`).bind(outboxId).first());
  }
  async history(bookingId: string) {
    if (!await this.db.prepare("SELECT 1 FROM bookings WHERE id=?").bind(bookingId).first()) return undefined;
    const rows = await this.db.prepare(`SELECT r.id,r.due_at AS dueAt,r.state,r.reason,r.archive_historical AS historical,b.host_timezone AS timezone,d.state AS deliveryState,d.last_error_code AS error
      FROM follow_up_runs r JOIN bookings b ON b.id=r.booking_id LEFT JOIN delivery_outbox d ON d.id=r.outbox_id WHERE r.booking_id=? ORDER BY r.created_at,r.id`).bind(bookingId).all<{ id: string; dueAt: string; state: string; reason: string | null; timezone: string; historical: number; deliveryState: string | null; error: string | null }>();
    return rows.results.map(row => ({ id: row.id, dueAt: row.dueAt, timezone: row.timezone,
      outcome: row.deliveryState === "succeeded" ? "sent" : row.state === "skipped" || row.state === "waiting" || row.historical === 1 && (!row.deliveryState || row.error === "restored_historical_command") ? "skipped" : row.state === "failed" || row.deliveryState === "failed" ? "failed" : row.state === "queued" ? "queued" : "scheduled",
      reason: row.reason ?? row.error ?? (row.historical === 1 && !row.deliveryState ? "restored_historical_job" : null) })) as FollowUpHistory[];
  }
}
