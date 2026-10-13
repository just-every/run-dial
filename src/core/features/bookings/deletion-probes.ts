export type CalendarDeletionProbe = {
  bookingId: string; providerEventId: string; occurrenceId: string;
  state: "pending" | "processing" | "resolved" | "failed"; attempts: number;
  nextAttemptAt: string; lastErrorCode: string | null; resolution: string | null;
  archiveHistorical: 0 | 1;
};
const columns = "booking_id AS bookingId, provider_event_id AS providerEventId, occurrence_id AS occurrenceId, state, attempts, next_attempt_at AS nextAttemptAt, last_error_code AS lastErrorCode, resolution, archive_historical AS archiveHistorical";
const delays = [60_000, 180_000, 480_000, 1_080_000, 1_800_000];

/** Minimal durable wake-ups: no callback body, invitee data, or provider credentials. */
export class CalendarDeletionProbesRepository {
  constructor(private readonly binding: D1Database) {}
  async stage(bookingId: string, providerEventId: string, occurrenceId: string, now: string) {
    await this.binding.prepare(`INSERT INTO calendar_deletion_probes (booking_id, provider_event_id, occurrence_id, state, attempts, next_attempt_at, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', 0, ?, ?, ?) ON CONFLICT(booking_id, provider_event_id) DO UPDATE SET
      occurrence_id = excluded.occurrence_id, state = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at,
      last_error_code = NULL, resolution = NULL, updated_at = excluded.updated_at
      WHERE calendar_deletion_probes.archive_historical = 0
        AND (calendar_deletion_probes.state = 'resolved' OR calendar_deletion_probes.occurrence_id <> excluded.occurrence_id)`)
      .bind(bookingId, providerEventId, occurrenceId, now, now, now).run();
  }
  async get(bookingId: string, providerEventId: string) {
    return this.binding.prepare(`SELECT ${columns} FROM calendar_deletion_probes WHERE booking_id = ? AND provider_event_id = ?`).bind(bookingId, providerEventId).first<CalendarDeletionProbe>();
  }
  async claim(bookingId: string, providerEventId: string, now: string) {
    const stale = new Date(Date.parse(now) - 60_000).toISOString();
    const result = await this.binding.prepare(`UPDATE calendar_deletion_probes SET state = 'processing', attempts = attempts + 1, updated_at = ?
      WHERE booking_id = ? AND provider_event_id = ? AND archive_historical = 0 AND attempts < 6
      AND ((state = 'pending' AND next_attempt_at <= ?) OR (state = 'processing' AND updated_at <= ?))`)
      .bind(now, bookingId, providerEventId, now, stale).run();
    return result.meta.changes === 1 ? this.get(bookingId, providerEventId) : null;
  }
  async resolve(probe: CalendarDeletionProbe, resolution: string, now: string) {
    await this.binding.prepare("UPDATE calendar_deletion_probes SET state = 'resolved', resolution = ?, last_error_code = NULL, updated_at = ? WHERE booking_id = ? AND provider_event_id = ? AND archive_historical = 0 AND state = 'processing' AND attempts = ?")
      .bind(resolution, now, probe.bookingId, probe.providerEventId, probe.attempts).run();
  }
  async defer(probe: CalendarDeletionProbe, code: string, now: string) {
    const delay = delays[probe.attempts - 1];
    await this.binding.prepare("UPDATE calendar_deletion_probes SET state = ?, next_attempt_at = ?, last_error_code = ?, updated_at = ? WHERE booking_id = ? AND provider_event_id = ? AND archive_historical = 0 AND state = 'processing' AND attempts = ?")
      .bind(delay === undefined ? "failed" : "pending", new Date(Date.parse(now) + (delay ?? 0)).toISOString(), code, now, probe.bookingId, probe.providerEventId, probe.attempts).run();
  }
  async due(now: string, limit = 25) {
    const stale = new Date(Date.parse(now) - 60_000).toISOString();
    // A last attempt interrupted by a restart must become reviewable, not remain processing forever.
    await this.binding.prepare("UPDATE calendar_deletion_probes SET state = 'failed', last_error_code = 'inspection_interrupted', updated_at = ? WHERE archive_historical = 0 AND state = 'processing' AND attempts >= 6 AND updated_at <= ?").bind(now, stale).run();
    return (await this.binding.prepare(`SELECT ${columns} FROM calendar_deletion_probes WHERE archive_historical = 0 AND ((state = 'pending' AND next_attempt_at <= ?) OR (state = 'processing' AND updated_at <= ?)) ORDER BY next_attempt_at LIMIT ?`).bind(now, stale, limit).all<CalendarDeletionProbe>()).results;
  }
  async list(bookingId: string) { return (await this.binding.prepare(`SELECT ${columns} FROM calendar_deletion_probes WHERE booking_id = ? ORDER BY updated_at DESC`).bind(bookingId).all<CalendarDeletionProbe>()).results; }
  async retry(bookingId: string, providerEventId: string, now: string) {
    const result = await this.binding.prepare("UPDATE calendar_deletion_probes SET state = 'pending', attempts = 0, next_attempt_at = ?, last_error_code = NULL, resolution = NULL, updated_at = ? WHERE booking_id = ? AND provider_event_id = ? AND archive_historical = 0 AND state = 'failed'").bind(now, now, bookingId, providerEventId).run();
    return result.meta.changes === 1;
  }
}
