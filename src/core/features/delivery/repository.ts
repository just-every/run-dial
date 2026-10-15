import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { createDatabase } from "../../platform/db/client";
import { deliveryOutbox, operatorDeliveryPreferences, providerConnectionHealth, providerWebhookEvents } from "../../platform/db/provider-schema";
import { operators } from "../../platform/db/schema";
import { createId, nowIso } from "../../shared/ids";
import { bookingLinkReadyMail, type BookingMailDetails } from "./booking-mails";
import { connectionAlertMail } from "./connection-mails";
import { pendingMeetFollowUp } from "./pending-meet";
import { operatorMailRevoked, operatorRecipientAdmission } from "./operator-mail";
import { calendarErasureRepair, calendarCleanupOutcome } from "../erasure";

export type DeliveryKind = "calendar_upsert" | "calendar_cancel" | "mail_send" | "reminder";
export type DeliveryOutboxRecord = {
  id: string;
  kind: DeliveryKind;
  idempotencyKey: string;
  bookingId: string | null;
  occurrenceId: string | null;
  requestId: string | null;
  payloadJson: string;
  attempts: number;
};

export class DeliveryRepository {
  private readonly db;

  constructor(private readonly binding: D1Database, readonly mailProvider: "resend" | "sendgrid" | "rer" | "development" = "resend", private readonly webhookConfigured = false) {
    this.db = createDatabase(binding);
  }

  async recoverProcessing(now: string) {
    const cutoff = new Date(Date.parse(now) - 60_000).toISOString();
    await this.binding.prepare("UPDATE delivery_outbox SET state = 'pending', next_attempt_at = ?, last_error_code = 'interrupted_delivery', updated_at = ? WHERE state = 'processing' AND updated_at < ? AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.archiveHistorical') END IS NOT 1").bind(now, now, cutoff).run();
  }

  async reminderBooking(record: DeliveryOutboxRecord, now: string) {
    return this.binding.prepare("SELECT b.event_title AS title, p.name AS hostName, (unixepoch(o.end_at) - unixepoch(o.start_at)) / 60 AS durationMinutes, o.start_at AS startAt, o.end_at AS endAt, b.host_timezone AS hostTimezone, b.invitee_timezone AS inviteeTimezone, b.location_type AS locationType, b.location_value AS locationValue, b.location_label AS locationLabel, b.meeting_url AS meetingUrl, b.meeting_state AS meetingState, CASE WHEN b.calendar_required = 0 THEN 'not_required' ELSE b.calendar_state END AS calendarState FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id JOIN host_profiles p ON 1 = 1 WHERE b.id = ? AND o.id = ? AND o.is_current = 1 AND b.state IN ('confirmed', 'rescheduled') AND o.start_at > ?").bind(record.bookingId, record.occurrenceId, now).first<import("./reminders").ReminderBooking>();
  }

  async dueIds(now: string, limit: number) {
    await this.recoverProcessing(now);
    const records = await this.db
      .select({ id: deliveryOutbox.id })
      .from(deliveryOutbox)
      .where(and(eq(deliveryOutbox.state, "pending"), sql`CASE WHEN json_valid(${deliveryOutbox.payloadJson}) THEN json_extract(${deliveryOutbox.payloadJson}, '$.archiveHistorical') END IS NOT 1`, lte(deliveryOutbox.nextAttemptAt, now)))
      .orderBy(asc(deliveryOutbox.nextAttemptAt), asc(deliveryOutbox.createdAt))
      .limit(limit);
    return records.map((record) => record.id);
  }

  async claim(id: string, now: string): Promise<DeliveryOutboxRecord | undefined> {
    const updated = await this.db
      .update(deliveryOutbox)
      .set({ state: "processing", attempts: sql`${deliveryOutbox.attempts} + 1`, updatedAt: now })
      .where(and(eq(deliveryOutbox.id, id), eq(deliveryOutbox.state, "pending"), sql`CASE WHEN json_valid(${deliveryOutbox.payloadJson}) THEN json_extract(${deliveryOutbox.payloadJson}, '$.archiveHistorical') END IS NOT 1`, lte(deliveryOutbox.nextAttemptAt, now)))
      .run();
    if (updated.meta.changes !== 1) return undefined;
    const [record] = await this.db
      .select({
        id: deliveryOutbox.id,
        kind: deliveryOutbox.kind,
        idempotencyKey: deliveryOutbox.idempotencyKey,
        bookingId: deliveryOutbox.bookingId,
        occurrenceId: deliveryOutbox.occurrenceId,
        requestId: deliveryOutbox.requestId,
        payloadJson: deliveryOutbox.payloadJson,
        attempts: deliveryOutbox.attempts,
      })
      .from(deliveryOutbox)
      .where(and(eq(deliveryOutbox.id, id), eq(deliveryOutbox.state, "processing")));
    return record ? { ...record, kind: record.kind as DeliveryKind } : undefined;
  }

  async succeeded(record: DeliveryOutboxRecord, providerMessageId?: string | null) {
    const timestamp = nowIso();
    await this.binding.batch([
      this.binding.prepare("UPDATE delivery_outbox SET state = 'succeeded', succeeded_at = ?, last_error_code = NULL, updated_at = ? WHERE id = ? AND state = 'processing' AND attempts = ?").bind(timestamp, timestamp, record.id, record.attempts),
      this.binding.prepare("INSERT INTO delivery_attempts (id, outbox_id, attempt_number, outcome, provider_message_id, error_code, attempted_at) SELECT ?, id, ?, 'succeeded', ?, NULL, ? FROM delivery_outbox WHERE id = ? ON CONFLICT(outbox_id, attempt_number) DO NOTHING")
        .bind(createId(), record.attempts, providerMessageId ?? null, timestamp, record.id),
    ]);
  }

  async failed(record: DeliveryOutboxRecord, input: { retryable: boolean; errorCode: string; nextAttemptAt?: string }) {
    const timestamp = nowIso();
    const retry = input.retryable && record.attempts < 6 && input.nextAttemptAt;
    await this.binding.batch([
      // A rejected or lost response cannot prove that an in-flight upsert had no
      // effect. Erasure has removed its private payload, so retain only a lookup.
      ...(record.kind === "calendar_upsert" && record.bookingId
        ? calendarErasureRepair(record.bookingId, `delivery:${record.id}:${record.attempts}`).map(statement => this.binding.prepare(statement.sql).bind(...statement.params))
        : []),
      ...calendarCleanupOutcome(record, null, input.errorCode).map(statement => this.binding.prepare(statement.sql).bind(...statement.params)),
      this.binding.prepare("UPDATE delivery_outbox SET state = ?, next_attempt_at = ?, last_error_code = ?, updated_at = ? WHERE id = ? AND state = 'processing' AND attempts = ?")
        .bind(retry ? "pending" : "failed", retry ? input.nextAttemptAt! : timestamp, input.errorCode, timestamp, record.id, record.attempts),
      this.binding.prepare("INSERT INTO delivery_attempts (id, outbox_id, attempt_number, outcome, provider_message_id, error_code, attempted_at) SELECT ?, id, ?, ?, NULL, ?, ? FROM delivery_outbox WHERE id = ? ON CONFLICT(outbox_id, attempt_number) DO NOTHING")
        .bind(createId(), record.attempts, retry ? "retrying" : "failed", input.errorCode, timestamp, record.id),
      ...(!retry && (record.kind === "calendar_upsert" || record.kind === "calendar_cancel") && record.bookingId
        ? [this.binding.prepare("UPDATE bookings SET calendar_state = 'failed', updated_at = ? WHERE id = ? AND current_occurrence_id = ? AND calendar_state <> 'succeeded'").bind(timestamp, record.bookingId, record.occurrenceId)]
        : []),
    ]);
  }

  async markCalendarCancelled(record: DeliveryOutboxRecord) {
    if (record.bookingId && record.occurrenceId) await this.binding.prepare("UPDATE bookings SET calendar_state = 'succeeded', updated_at = ? WHERE id = ? AND current_occurrence_id = ? AND state = 'cancelled'").bind(nowIso(), record.bookingId, record.occurrenceId).run();
    await this.markErasureCleanup(record);
  }

  async markErasureCleanup(record: DeliveryOutboxRecord) {
    for (const statement of calendarCleanupOutcome(record, nowIso(), null)) {
      await this.binding.prepare(statement.sql).bind(...statement.params).run();
    }
  }

  async mailHealth() {
    const [record] = await this.db.select().from(providerConnectionHealth).where(eq(providerConnectionHealth.provider, this.mailProvider));
    const health = record ? { state: record.status, checkedAt: record.lastCheckedAt, reason: record.unhealthyCode } : { state: "unchecked" as const, checkedAt: null, reason: null };
    return { ...health, provider: this.mailProvider, eventTracking: ["development", "rer"].includes(this.mailProvider) ? "not_applicable" as const : this.webhookConfigured ? "on" as const : "off" as const };
  }

  async setMailHealth(status: "healthy" | "unhealthy", reason: string | null) {
    return this.setConnectionHealth(this.mailProvider, status, reason);
  }

  async connectionStatus(provider: "google_calendar" | "resend" | "sendgrid" | "rer" | "development") {
    const [existing] = await this.db.select({ status: providerConnectionHealth.status }).from(providerConnectionHealth).where(eq(providerConnectionHealth.provider, provider));
    return existing?.status;
  }

  async setConnectionHealth(provider: "google_calendar" | "resend" | "sendgrid" | "rer" | "development", status: "healthy" | "unhealthy", reason: string | null) {
    const [existing] = await this.db.select().from(providerConnectionHealth).where(eq(providerConnectionHealth.provider, provider));
    const timestamp = nowIso();
    const changed = Boolean(existing && existing.status !== status);
    const alertCycle = existing ? existing.alertCycle + (changed ? 1 : 0) : 0;
    await this.db.insert(providerConnectionHealth).values({
      provider, status, lastCheckedAt: timestamp, unhealthyCode: reason, alertState: "unannounced", alertCycle, createdAt: timestamp, updatedAt: timestamp,
    }).onConflictDoUpdate({
      target: providerConnectionHealth.provider,
      set: { status, lastCheckedAt: timestamp, unhealthyCode: reason, alertCycle, updatedAt: timestamp },
    });
    return { changed, alertCycle };
  }

  async enqueueConnectionAlert(input: { provider: "google_calendar" | "resend" | "sendgrid" | "rer" | "development"; status: "healthy" | "unhealthy"; reason: string | null; alertCycle: number }) {
    const recipients = await this.db.select({ id: operators.id, email: operators.email, generation: operators.accessGeneration }).from(operators).where(isNull(operators.removedAt)).orderBy(asc(operators.email));
    if (recipients.length === 0) return;
    const timestamp = nowIso();
    const providerName = input.provider === "google_calendar" ? "Calendar" : "Transactional mail";
    const message = connectionAlertMail(providerName, input.status, input.reason);
    await this.binding.batch(recipients.map((recipient) => {
      const operatorAccess = { id: recipient.id, generation: recipient.generation };
      const admission = operatorRecipientAdmission({ to: recipient.email, recipientRole: "operator", operatorAccess });
      return this.binding.prepare(
        `INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, last_error_code, succeeded_at, created_at, updated_at)
          SELECT ?, 'mail_send', ?, NULL, NULL, NULL, ?, 'pending', 0, ?, NULL, NULL, ?, ? WHERE ${admission.sql}
          ON CONFLICT(idempotency_key) DO NOTHING`,
      ).bind(
        createId(),
        `connection:${input.provider}:${input.status}:${input.alertCycle}:operator:${recipient.id}`,
        JSON.stringify({ to: recipient.email, recipientRole: "operator", operatorAccess, ...message }),
        timestamp, timestamp, timestamp, ...admission.params,
      );
    }));
  }

  async recordWebhook(input: { providerEventId: string; occurredAt?: string; providerMessageId?: string }) {
    const timestamp = nowIso();
    const result = await this.binding.prepare(`INSERT INTO provider_webhook_events(id,provider,provider_event_id,occurred_at,received_at,processed_at,state,payload_hash,delivery_id)
      SELECT ?, 'resend', ?, ?, ?, NULL, 'received', '', COALESCE(json_extract(d.payload_json,'$.providerIdempotencyKey'),d.idempotency_key)
      FROM delivery_outbox d JOIN delivery_attempts a ON a.outbox_id=d.id WHERE a.provider_message_id=? LIMIT 1 ON CONFLICT DO NOTHING`)
      .bind(createId(),input.providerEventId,input.occurredAt??null,timestamp,input.providerMessageId??null).run();
    return result.meta.changes === 1;
  }

  async completeWebhook(providerEventId: string, state: "processed" | "ignored") {
    await this.db.update(providerWebhookEvents).set({ state, processedAt: nowIso() })
      .where(and(eq(providerWebhookEvents.provider, "resend"), eq(providerWebhookEvents.providerEventId, providerEventId)));
  }

  async markProviderMessageFailed(providerMessageId: string, errorCode: string) {
    const result = await this.binding.prepare("UPDATE delivery_outbox SET state = 'failed', last_error_code = ?, updated_at = ? WHERE state = 'succeeded' AND id IN (SELECT outbox_id FROM delivery_attempts WHERE provider_message_id = ?)").bind(errorCode, nowIso(), providerMessageId).run();
    return result.meta.changes > 0;
  }

  async currentBookingMail(record: DeliveryOutboxRecord, cancelled: boolean) {
    if (!record.bookingId) return true;
    return Boolean(await this.binding.prepare("SELECT 1 FROM bookings WHERE id = ? AND current_occurrence_id = ? AND ((? = 1 AND state = 'cancelled') OR (? = 0 AND state IN ('confirmed', 'rescheduled')))").bind(record.bookingId, record.occurrenceId, cancelled ? 1 : 0, cancelled ? 1 : 0).first());
  }

  async currentInviteeManageCapability(record: DeliveryOutboxRecord, now: string) {
    if (!record.bookingId || !record.occurrenceId) return undefined;
    const capabilities = await this.binding.prepare(`SELECT token.token_hash AS tokenHash, json_extract(mail.payload_json, '$.manageUrl') AS manageUrl
      FROM booking_manage_tokens token
      JOIN delivery_outbox mail ON mail.booking_id = token.booking_id
      WHERE token.booking_id = ? AND token.rotated_at IS NULL AND token.invalidated_at IS NULL AND token.expires_at > ?
        AND mail.kind IN ('mail_send', 'reminder')
        AND json_extract(mail.payload_json, '$.recipientRole') = 'invitee'
        AND json_type(mail.payload_json, '$.manageUrl') = 'text'
      ORDER BY mail.updated_at DESC`).bind(record.bookingId, now).all<{ tokenHash: string; manageUrl: string }>();
    const tokenHash = capabilities.results[0]?.tokenHash;
    const manageUrls = capabilities.results.filter((row) => row.tokenHash === tokenHash).map((row) => row.manageUrl);
    return tokenHash && manageUrls.length ? { tokenHash, manageUrls } : undefined;
  }

  async cancellationMailSnapshot(record: DeliveryOutboxRecord) {
    if (!record.bookingId || !record.occurrenceId) return undefined;
    return this.binding.prepare("SELECT b.event_title AS eventTitle, (unixepoch(o.end_at) - unixepoch(o.start_at)) / 60 AS durationMinutes, b.invitee_name AS inviteeName, b.invitee_email AS inviteeEmail, b.host_timezone AS hostTimezone, b.invitee_timezone AS inviteeTimezone, b.location_type AS locationType, b.location_label AS locationLabel, b.location_value AS locationValue, b.meeting_url AS meetingUrl, b.meeting_state AS meetingState, CASE WHEN b.calendar_required = 0 THEN 'not_required' ELSE 'pending' END AS calendarState, o.start_at AS startAt, o.end_at AS endAt FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id WHERE b.id = ? AND o.id = ? AND b.state = 'cancelled'").bind(record.bookingId, record.occurrenceId).first<Pick<BookingMailDetails, "eventTitle" | "durationMinutes" | "hostTimezone" | "inviteeTimezone" | "locationType" | "locationLabel" | "locationValue" | "meetingUrl" | "calendarState" | "meetingState" | "startAt" | "endAt"> & { inviteeName: string; inviteeEmail: string }>();
  }

  async freezeMail(record: DeliveryOutboxRecord, message: unknown, manageUrl?: string) {
    const wire = JSON.stringify(message);
    if (wire === undefined) throw new TypeError("Mail message is not serializable");
    const parts = JSON.parse(wire) as { html?: unknown };
    const hasHtml = typeof parts.html === "string";
    const setHtml = hasHtml ? ", '$.html', json_extract(?, '$.html')" : "";
    const setManageUrl = manageUrl === undefined ? "" : ", '$.manageUrl', ?";
    const setFrozen = `json_set(payload_json, '$.wireMail', json(?), '$.subject', json_extract(?, '$.subject'), '$.text', json_extract(?, '$.text')${setHtml}${setManageUrl})`;
    const frozenPayload = hasHtml ? setFrozen : `json_remove(${setFrozen}, '$.html')`;
    const values: unknown[] = [wire, wire, wire];
    if (hasHtml) values.push(wire);
    if (manageUrl !== undefined) values.push(manageUrl);
    values.push(record.id);
    await this.binding.prepare(`UPDATE delivery_outbox SET payload_json = ${frozenPayload} WHERE id = ? AND state = 'processing'`).bind(...values).run();
  }

  async bookingMailMuted(email: string) {
    const [record] = await this.db.select({ muted: operatorDeliveryPreferences.bookingMailMuted })
      .from(operators)
      .leftJoin(operatorDeliveryPreferences, eq(operatorDeliveryPreferences.operatorId, operators.id))
      .where(eq(operators.normalizedEmail, email.trim().toLowerCase()));
    return record?.muted === true;
  }

  async operatorMailRevoked(record: DeliveryOutboxRecord) {
    return operatorMailRevoked(this.binding, record.id);
  }

  async calendarCommandState(record: DeliveryOutboxRecord) {
    if (!record.bookingId) return "stale" as const;
    if (record.kind === "calendar_cancel" && !record.occurrenceId) {
      const erased = await this.binding.prepare("SELECT 1 AS existsFlag FROM erased_calendar_targets WHERE booking_id = ? AND archive_historical = 0 AND completed_at IS NULL").bind(record.bookingId).first();
      return erased ? "current" as const : "stale" as const;
    }
    if (!record.occurrenceId) return "stale" as const;
    const booking = await this.binding.prepare("SELECT state, current_occurrence_id AS currentOccurrenceId FROM bookings WHERE id = ?").bind(record.bookingId).first<{ state: string; currentOccurrenceId: string | null }>();
    if (!booking || booking.currentOccurrenceId !== record.occurrenceId) return "stale" as const;
    if (record.kind === "calendar_upsert") return booking.state === "confirmed" || booking.state === "rescheduled" ? "current" as const : "stale" as const;
    if (record.kind === "calendar_cancel") return booking.state === "cancelled" ? "current" as const : "stale" as const;
    return "stale" as const;
  }

  async markCalendarDelivered(record: DeliveryOutboxRecord, input: { providerEventId: string; providerUpdatedAt: string; conferenceState: "pending" | "ready" | "not_requested" | "failed"; conferenceUrl?: string }) {
    if (!record.bookingId || !record.occurrenceId) return { updated: false, meetingFailed: false };
    let meetingFailed = input.conferenceState === "failed";
    const timestamp = nowIso();
    const meetingState = input.conferenceState === "not_requested" ? "not_required" : input.conferenceState === "ready" ? "succeeded" : input.conferenceState === "failed" ? "failed" : "pending";
    const statements: D1PreparedStatement[] = [
      this.binding.prepare("UPDATE bookings SET calendar_state = 'succeeded', calendar_provider_event_id = ?, calendar_provider_updated_at = CASE WHEN calendar_provider_updated_at IS NULL OR calendar_provider_updated_at < ? THEN ? ELSE calendar_provider_updated_at END, meeting_state = ?, meeting_url = ?, updated_at = ? WHERE id = ? AND current_occurrence_id = ? AND state IN ('confirmed', 'rescheduled')")
        .bind(input.providerEventId, input.providerUpdatedAt, input.providerUpdatedAt, meetingState, input.conferenceUrl ?? null, timestamp, record.bookingId, record.occurrenceId),
    ];
    if (input.conferenceState === "ready" && input.conferenceUrl) {
      const snapshot = await this.binding.prepare(`SELECT b.state, b.current_occurrence_id AS currentOccurrenceId,
          o.is_current AS occurrenceIsCurrent, b.event_title AS eventTitle, b.invitee_email AS inviteeEmail,
          p.name AS hostName, (unixepoch(o.end_at) - unixepoch(o.start_at)) / 60 AS durationMinutes, o.start_at AS startAt, o.end_at AS endAt,
          b.host_timezone AS hostTimezone, b.invitee_timezone AS inviteeTimezone, b.location_type AS locationType,
          b.location_label AS locationLabel, b.location_value AS locationValue,
          (SELECT json_extract(payload_json, '$.manageUrl') FROM delivery_outbox
            WHERE booking_id = b.id AND occurrence_id = o.id AND kind = 'mail_send'
              AND json_extract(payload_json, '$.recipientRole') = 'invitee'
              AND json_type(payload_json, '$.manageUrl') = 'text'
            ORDER BY updated_at DESC LIMIT 1) AS manageUrl
        FROM bookings b
        LEFT JOIN booking_occurrences o ON o.id = b.current_occurrence_id AND o.id = ?
        LEFT JOIN host_profiles p ON 1 = 1
        WHERE b.id = ?`).bind(record.occurrenceId, record.bookingId).first<{
          state: string; currentOccurrenceId: string; occurrenceIsCurrent: number | null; eventTitle: string;
          inviteeEmail: string; hostName: string | null; durationMinutes: number; startAt: string | null; endAt: string | null;
          hostTimezone: string; inviteeTimezone: string; locationType: string; locationLabel: string; locationValue: string;
          manageUrl: string | null;
        }>();
      const current = snapshot && snapshot.currentOccurrenceId === record.occurrenceId && snapshot.occurrenceIsCurrent === 1
        && (snapshot.state === "confirmed" || snapshot.state === "rescheduled");
      // This single read binds current-state and mail facts to one database snapshot.
      // If a reschedule or cancellation lands after it, the final write guards below
      // remain no-ops and the already-completed provider call is still acknowledged.
      if (current) {
        if (!snapshot.hostName || !snapshot.startAt || !snapshot.endAt || !snapshot.manageUrl) throw new Error("Meeting link mail requires a current booking and invitee manage capability");
        const message = bookingLinkReadyMail({
          eventTitle: snapshot.eventTitle,
          hostName: snapshot.hostName,
          durationMinutes: snapshot.durationMinutes,
          startAt: snapshot.startAt,
          endAt: snapshot.endAt,
          hostTimezone: snapshot.hostTimezone,
          inviteeTimezone: snapshot.inviteeTimezone,
          locationType: snapshot.locationType,
          locationLabel: snapshot.locationLabel,
          locationValue: snapshot.locationValue,
          meetingUrl: input.conferenceUrl,
          calendarState: "succeeded",
          manageUrl: snapshot.manageUrl,
        });
        const payload = {
          to: snapshot.inviteeEmail,
          recipientRole: "invitee",
          manageUrl: snapshot.manageUrl,
          subject: "Your meeting link is ready",
          ...message,
        };
        // Preserve the durable notice across a concurrent rotation; mail dispatch resolves the active booking capability before freezing its wire payload.
        statements.push(this.binding.prepare(
          "INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, last_error_code, succeeded_at, created_at, updated_at) SELECT ?, 'mail_send', ?, b.id, ?, NULL, ?, 'pending', 0, ?, NULL, NULL, ?, ? FROM bookings b WHERE b.id = ? AND b.current_occurrence_id = ? AND b.state IN ('confirmed', 'rescheduled') ON CONFLICT(idempotency_key) DO NOTHING",
        ).bind(
          createId(),
          `booking:${record.bookingId}:occurrence:${record.occurrenceId}:link-ready`,
          record.occurrenceId,
          JSON.stringify(payload),
          timestamp,
          timestamp,
          timestamp,
          record.bookingId, record.occurrenceId,
        ));
      }
    }
    if (input.conferenceState === "pending") {
      const followUp = pendingMeetFollowUp(record.payloadJson, record.bookingId, record.occurrenceId, new Date(timestamp));
      if (followUp) {
        statements.push(this.binding.prepare(
          "INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, last_error_code, succeeded_at, created_at, updated_at) SELECT ?, 'calendar_upsert', ?, ?, ?, NULL, ?, 'pending', 0, ?, NULL, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND current_occurrence_id = ? AND state IN ('confirmed', 'rescheduled')) ON CONFLICT(idempotency_key) DO NOTHING",
        ).bind(createId(), followUp.idempotencyKey, record.bookingId, record.occurrenceId, followUp.payloadJson, followUp.nextAttemptAt, timestamp, timestamp, record.bookingId, record.occurrenceId));
      } else {
        meetingFailed = true;
        statements.push(this.binding.prepare("UPDATE bookings SET meeting_state = 'failed', updated_at = ? WHERE id = ? AND current_occurrence_id = ? AND state IN ('confirmed', 'rescheduled') AND meeting_state = 'pending'").bind(timestamp, record.bookingId, record.occurrenceId));
      }
    }
    // A request accepted before erasure may finish after the first cleanup. Its
    // completion must re-open cleanup even when its provider timestamp is older.
    statements.push(...calendarErasureRepair(record.bookingId, `delivery:${record.id}:${record.attempts}`)
      .map(statement => this.binding.prepare(statement.sql).bind(...statement.params)));
    const results = await this.binding.batch(statements);
    return { updated: results[0].meta.changes === 1, meetingFailed };
  }

  async isCurrentFutureOccurrence(bookingId: string | null, occurrenceId: string | null, now: string) {
    if (!bookingId || !occurrenceId) return false;
    const row = await this.binding.prepare(
      "SELECT 1 AS active FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id WHERE b.id = ? AND o.id = ? AND b.state IN ('confirmed', 'rescheduled') AND o.is_current = 1 AND o.start_at > ?",
    ).bind(bookingId, occurrenceId, now).first<{ active: number }>();
    return Boolean(row?.active);
  }
}
