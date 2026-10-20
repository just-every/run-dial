import { blockedAddressSql, blockedAddressValues } from "../public-abuse";
import { asc, eq, isNull } from "drizzle-orm";
import { createDatabase } from "../../platform/db/client";
import {
  availabilityRequestReviewNonces,
  availabilityRequests,
  availabilityRequestWindows,
} from "../../platform/db/request-embed-schema";
import { operators } from "../../platform/db/schema";
import { createId, nowIso } from "../../shared/ids";
import { operatorRecipientAdmission, requestSubmissionMail, requestUpdateMail } from "../delivery/mail";
import { defaultRequestRouting, requestRoutingSchema } from "../../shared/correspondence";

export type RequestState = "submitted" | "handled" | "closed";
export type RequestAcknowledgementState = "queued" | "sent" | "failed";
export type RequestedWindow = { date: string; startMinute: number; endMinute: number };
export type RequestComposition = {
  inviteeName: string;
  inviteeEmail: string;
  inviteeTimezone: string;
  browserTimezone?: string | null;
  note: string | null;
  windows: RequestedWindow[];
};
export type RequestRecord = RequestComposition & {
  id: string;
  eventTypeId: string;
  eventTitle: string;
  compositionHash: string;
  state: RequestState;
  bookingId: string | null;
  submittedAt: string;
  handledAt: string | null;
  closedAt: string | null;
  stateChangedByOperatorId: string | null;
};
export type ReviewNonceRecord = {
  eventTypeId: string;
  compositionHash: string;
  expiresAt: string;
  consumedAt: string | null;
  requestId: string | null;
};

export class AvailabilityRequestsRepository {
  private readonly db;

  constructor(private readonly binding: D1Database) {
    this.db = createDatabase(binding);
  }

  async issueReviewNonce(eventTypeId: string, nonceHash: string, compositionHash: string, expiresAt: string, inviteeEmail: string) {
    const timestamp = nowIso();
    await this.db.insert(availabilityRequestReviewNonces).values({
      id: createId(), eventTypeId, nonceHash, compositionHash, expiresAt, inviteeEmail, consumedAt: null, requestId: null, createdAt: timestamp, updatedAt: timestamp,
    });
  }

  async getReviewNonce(nonceHash: string): Promise<ReviewNonceRecord | undefined> {
    const [record] = await this.db.select({
      eventTypeId: availabilityRequestReviewNonces.eventTypeId,
      compositionHash: availabilityRequestReviewNonces.compositionHash,
      expiresAt: availabilityRequestReviewNonces.expiresAt,
      consumedAt: availabilityRequestReviewNonces.consumedAt,
      requestId: availabilityRequestReviewNonces.requestId,
    }).from(availabilityRequestReviewNonces).where(eq(availabilityRequestReviewNonces.nonceHash, nonceHash));
    return record;
  }

  async get(id: string): Promise<RequestRecord | undefined> {
    const [record] = await this.db.select().from(availabilityRequests).where(eq(availabilityRequests.id, id));
    return record ? this.hydrate(record) : undefined;
  }

  async getAcknowledgementState(input: { requestId: string; eventTypeId: string; nonceHash: string; compositionHash: string }): Promise<RequestAcknowledgementState | undefined> {
    const record = await this.binding.prepare(`SELECT d.state FROM availability_requests r
      JOIN delivery_outbox d ON d.request_id = r.id AND d.kind = 'mail_send'
        AND d.idempotency_key = 'request:' || r.id || ':invitee:ack'
      WHERE r.id = ? AND r.event_type_id = ? AND r.nonce_hash = ? AND r.composition_hash = ?`)
      .bind(input.requestId, input.eventTypeId, input.nonceHash, input.compositionHash)
      .first<{ state: string }>();
    if (record?.state === "succeeded") return "sent";
    if (record?.state === "pending" || record?.state === "processing") return "queued";
    if (record?.state === "failed") return "failed";
    return undefined;
  }

  async getByNonceHash(nonceHash: string): Promise<RequestRecord | undefined> {
    const [record] = await this.db.select().from(availabilityRequests).where(eq(availabilityRequests.nonceHash, nonceHash));
    return record ? this.hydrate(record) : undefined;
  }

  async list(state?: RequestState): Promise<RequestRecord[]> {
    const records = state
      ? await this.db.select().from(availabilityRequests).where(eq(availabilityRequests.state, state)).orderBy(asc(availabilityRequests.submittedAt))
      : await this.db.select().from(availabilityRequests).orderBy(asc(availabilityRequests.submittedAt));
    return Promise.all(records.map((record) => this.hydrate(record)));
  }

  /** Creates the inbox item and every initial mail command in the same D1 batch. */
  async createFromNonce(input: {
    nonceHash: string;
    compositionHash: string;
    eventTypeId: string;
    eventTitle: string;
    hostName: string;
    composition: RequestComposition;
    operatorRecipients: Array<{ id: string; email: string; generation: number }>;
  }): Promise<RequestRecord | "blocked"> {
    const requestId = createId();
    const timestamp = nowIso();
    const messageDetails = { hostName: input.hostName, eventTitle: input.eventTitle, ...input.composition };
    const operatorMail = requestSubmissionMail(messageDetails, "operator");
    const inviteeMail = requestSubmissionMail(messageDetails, "invitee");
    const recipientCommands = [
      ...input.operatorRecipients.map((operator) => this.createDeliveryCommand({
        requestId,
        idempotencyKey: `request:${requestId}:operator:${operator.id}:submitted`,
        to: operator.email,
        recipientRole: "operator",
        operatorAccess: { id: operator.id, generation: operator.generation },
        subject: operatorMail.subject,
        text: operatorMail.text,
        html: operatorMail.html,
        timestamp,
      })),
      this.createDeliveryCommand({
        requestId,
        idempotencyKey: `request:${requestId}:invitee:ack`,
        to: input.composition.inviteeEmail,
        recipientRole: "invitee",
        subject: inviteeMail.subject,
        text: inviteeMail.text,
        html: inviteeMail.html,
        timestamp,
      }),
    ];
    try {
      const result = await this.binding.batch([
        this.binding.prepare(`INSERT INTO availability_requests (id, event_type_id, event_title, invitee_name, invitee_email, invitee_timezone, browser_timezone, note, state, nonce_hash, composition_hash, booking_id, submitted_at, handled_at, closed_at, state_changed_by_operator_id, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, NULL, ?, NULL, NULL, NULL, ?, ? WHERE NOT ${blockedAddressSql}`)
          .bind(requestId, input.eventTypeId, input.eventTitle, input.composition.inviteeName, input.composition.inviteeEmail, input.composition.inviteeTimezone, input.composition.browserTimezone ?? null, input.composition.note, input.nonceHash, input.compositionHash, timestamp, timestamp, timestamp, ...blockedAddressValues(input.composition.inviteeEmail)),
        ...input.composition.windows.map((window, position) => this.binding.prepare("INSERT INTO availability_request_windows (id, request_id, requested_date, start_minute, end_minute, position, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM availability_requests WHERE id = ?)")
          .bind(createId(), requestId, window.date, window.startMinute, window.endMinute, position, timestamp, timestamp, requestId)),
        this.binding.prepare("UPDATE availability_request_review_nonces SET consumed_at = ?, request_id = ?, updated_at = ? WHERE nonce_hash = ? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM availability_requests WHERE id = ?)")
          .bind(timestamp, requestId, timestamp, input.nonceHash, requestId),
        ...recipientCommands,
      ]);
      if (result[0].meta.changes !== 1) {
        const existing = await this.getByNonceHash(input.nonceHash);
        if (existing && existing.compositionHash === input.compositionHash) return existing;
        return "blocked";
      }
    } catch (error) {
      const existing = await this.getByNonceHash(input.nonceHash);
      if (existing && existing.compositionHash === input.compositionHash) return existing;
      throw error;
    }
    const result = await this.get(requestId);
    if (!result) throw new Error("Alternative request was not persisted");
    return result;
  }

  async transition(id: string, state: Exclude<RequestState, "submitted">, operatorId: string, hostName: string): Promise<"not_found" | "already_resolved" | RequestRecord> {
    const existing = await this.get(id);
    if (!existing) return "not_found";
    if (existing.state !== "submitted") return "already_resolved";
    const timestamp = nowIso();
    const result = await this.binding.batch([
      this.binding.prepare("UPDATE availability_requests SET state = ?, handled_at = ?, closed_at = ?, state_changed_by_operator_id = ?, updated_at = ? WHERE id = ? AND state = 'submitted'")
        .bind(state, state === "handled" ? timestamp : null, state === "closed" ? timestamp : null, operatorId, timestamp, id),
      this.lifecycleDeliveryCommand(existing, state, hostName, timestamp, "state", operatorId),
    ]);
    if (result[0].meta.changes !== 1) return "already_resolved";
    const updated = await this.get(id);
    if (!updated) throw new Error("Alternative request disappeared after its state changed");
    return updated;
  }

  async linkBooking(id: string, bookingId: string, operatorId: string, hostName: string): Promise<"not_found" | "already_resolved" | RequestRecord> {
    const existing = await this.get(id);
    if (!existing) return "not_found";
    if (existing.state !== "submitted") return existing.bookingId === bookingId ? existing : "already_resolved";
    const timestamp = nowIso();
    const result = await this.binding.batch([
      this.binding.prepare("UPDATE availability_requests SET state = 'handled', booking_id = ?, handled_at = ?, closed_at = NULL, state_changed_by_operator_id = ?, updated_at = ? WHERE id = ? AND state = 'submitted'")
        .bind(bookingId, timestamp, operatorId, timestamp, id),
      this.lifecycleDeliveryCommand(existing, "handled", hostName, timestamp, "booking", bookingId),
    ]);
    if (result[0].meta.changes !== 1) return "already_resolved";
    const updated = await this.get(id);
    if (!updated) throw new Error("Alternative request disappeared after booking linkage");
    return updated;
  }

  /** `availability-request.routing.v1`: every host recipient (each current operator of a single-host install) unless the event's policy selects some of them or suppresses email. */
  async requestRecipients(eventTypeId: string) {
    const row = await this.binding.prepare("SELECT json_extract(templates_json, '$.requestRouting') AS routing FROM event_correspondence WHERE event_type_id = ?").bind(eventTypeId).first<{ routing: string | null }>();
    const routing = row?.routing ? requestRoutingSchema.parse(JSON.parse(row.routing)) : defaultRequestRouting;
    if (routing.mode === "suppressed") return [];
    const current = await this.db.select({ id: operators.id, email: operators.email, generation: operators.accessGeneration }).from(operators).where(isNull(operators.removedAt)).orderBy(asc(operators.email));
    return routing.mode === "selected" ? current.filter(operator => routing.operatorIds.includes(operator.id)) : current;
  }

  private lifecycleDeliveryCommand(record: RequestRecord, state: Exclude<RequestState, "submitted">, hostName: string, timestamp: string, reason: "state" | "booking", correlation: string) {
    const key = `request:${record.id}:invitee:${state}`;
    const match = reason === "booking"
      ? "state = 'handled' AND booking_id = ? AND updated_at = ?"
      : "state = ? AND state_changed_by_operator_id = ? AND updated_at = ?";
    const values = reason === "booking" ? [correlation, timestamp] : [state, correlation, timestamp];
    const message = requestUpdateMail({ hostName, eventTitle: record.eventTitle, state });
    return this.binding.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, last_error_code, succeeded_at, created_at, updated_at) SELECT ?, 'mail_send', ?, NULL, NULL, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ? FROM availability_requests WHERE id = ? AND ${match} ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(
        createId(), key, record.id,
        JSON.stringify({ to: record.inviteeEmail, ...message }),
        timestamp, timestamp, timestamp, record.id, ...values,
      );
  }

  private createDeliveryCommand(input: { operatorAccess?: { id: string; generation: number }; requestId: string; idempotencyKey: string; to: string; recipientRole: "invitee" | "operator"; subject: string; text: string; html: string; timestamp: string }) {
    const admission = operatorRecipientAdmission(input);
    return this.binding.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, last_error_code, succeeded_at, created_at, updated_at) SELECT ?, 'mail_send', ?, NULL, NULL, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM availability_requests WHERE id = ?) AND ${admission.sql}`)
      .bind(
        createId(), input.idempotencyKey, input.requestId,
        JSON.stringify({ to: input.to, recipientRole: input.recipientRole, ...(input.operatorAccess ? { operatorAccess: input.operatorAccess } : {}), subject: input.subject, text: input.text, html: input.html }),
        input.timestamp, input.timestamp, input.timestamp, input.requestId, ...admission.params,
      );
  }

  private async hydrate(record: typeof availabilityRequests.$inferSelect): Promise<RequestRecord> {
    const windows = await this.db.select({
      date: availabilityRequestWindows.requestedDate,
      startMinute: availabilityRequestWindows.startMinute,
      endMinute: availabilityRequestWindows.endMinute,
    }).from(availabilityRequestWindows).where(eq(availabilityRequestWindows.requestId, record.id)).orderBy(asc(availabilityRequestWindows.position));
    return {
      id: record.id,
      eventTypeId: record.eventTypeId,
      eventTitle: record.eventTitle,
      compositionHash: record.compositionHash,
      inviteeName: record.inviteeName,
      inviteeEmail: record.inviteeEmail,
      inviteeTimezone: record.inviteeTimezone,
      browserTimezone: record.browserTimezone,
      note: record.note,
      windows,
      state: record.state as RequestState,
      bookingId: record.bookingId,
      submittedAt: record.submittedAt,
      handledAt: record.handledAt,
      closedAt: record.closedAt,
      stateChangedByOperatorId: record.stateChangedByOperatorId,
    };
  }
}

/** Shares the booking claim transaction while retaining request-owned erasure custody. */
export function linkedBookingAcknowledgement(binding: D1Database, requestId: string, bookingId: string, hostName: string, eventTitle: string, now: string) {
  const message = requestUpdateMail({ hostName, eventTitle, state: "handled" });
  return binding.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
    SELECT ?, 'mail_send', 'request:' || id || ':invitee:handled', NULL, NULL, id,
      json_object('to', invitee_email, 'subject', ?, 'text', ?, 'html', ?),
      'pending', 0, ?, ?, ? FROM availability_requests WHERE id = ? AND state = 'handled' AND booking_id = ? AND updated_at = ?
    ON CONFLICT(idempotency_key) DO NOTHING`).bind(createId(), message.subject, message.text, message.html, now, now, now, requestId, bookingId, now);
}
