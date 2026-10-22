import { offeredHoldPredicate } from "../booking-links";
import { RescheduleRequestsRepository } from "./reschedule-requests";
import { bookingCorrespondenceStatements } from "./booking-correspondence";
import { contactHost } from "./contact-host";
import { inviteeChangePolicyPredicate } from "../event-types";
import { bookingPresentationStatements } from "./booking-presentation";
import { BookingLimits } from "../availability";
import { foldBookingSearch } from "./search/case-fold.mjs";
import { PublicAbuseRepository, blockedAddressSql, blockedAddressValues } from "../public-abuse";
import { linkedBookingAcknowledgement } from "../availability-requests";
import { restoreCalendarConflict, closeCalendarConflicts } from "./calendar-conflicts";
import { cancellationOutboxStatements, outboxStatements } from "./write-commands";
import { readOperatorCreation, isErasedOperatorCreation, operatorCreationStatement, type OperatorCreationIdentity } from "./operator-creation-receipts";
import { hydrateOperatorBooking, hydrateOperatorBookings, type OperatorBookingRow } from "./operator-booking-hydration";
import { createId } from "../../shared/ids";
import { blockedProbe, holdAdmission, nonceAdmission, slotClaimGuard } from "./claim-guard";
import { activeHoldIntervals, paymentHoldPredicate, PaymentsRepository } from "../payments";
import type { BookingClaim, BookingEmail, BookingRecord, BookingSelection } from "./types";

type OperatorBookingClaim = Omit<BookingClaim, "nonceId" | "nonceHash" | "payloadHash"> & { hostName: string; requestId?: string; creationIdentity?: OperatorCreationIdentity };

type NonceRecord = {
  id: string;
  linkId: string | null;
  purpose: "confirm" | "reschedule";
  eventTypeId: string;
  bookingId: string | null;
  selectionStartAt: string;
  selectionEndAt: string;
  inviteeTimezone: string;
  expiresAt: string;
  consumedAt: string | null;
  payloadHash: string | null;
  resultBookingId: string | null;
};

type ManageTokenLookup = { booking: BookingRecord; status: "active" | "expired" | "rotated" | "invalidated" };
type OperatorBookingFilters = {
  state?: BookingRecord["state"];
  rescheduleRequest?: "open" | "picked" | "expired" | "cancelled";
  time?: "future" | "past";
  eventTypeId?: string;
  from?: string;
  to?: string;
  order?: "created";
  limit?: number;
  offset?: number;
  deliveryFailed?: boolean;
  query?: string;
  /** A drill-through from the scheduling report: exactly the bookings one figure counts. */
  ids?: string[];
};

function operatorBookingWhere(filters: OperatorBookingFilters, now: string) {
  const clauses = ["b.current_occurrence_id = o.id"];
  const values: unknown[] = [];
  if (filters.rescheduleRequest) { clauses.push("EXISTS(SELECT 1 FROM booking_reschedule_requests rr WHERE rr.booking_id=b.id AND rr.state=?)"); values.push(filters.rescheduleRequest); }
  if (filters.state) { clauses.push("b.state = ?"); values.push(filters.state); }
  if (filters.time === "future") { clauses.push("o.start_at >= ?"); values.push(now); }
  if (filters.time === "past") { clauses.push("o.start_at < ?"); values.push(now); }
  if (filters.eventTypeId) { clauses.push("b.event_type_id = ?"); values.push(filters.eventTypeId); }
  if (filters.from) { clauses.push("o.start_at >= ?"); values.push(filters.from); }
  if (filters.to) { clauses.push("o.start_at <= ?"); values.push(filters.to); }
  if (filters.deliveryFailed === true) clauses.push("EXISTS (SELECT 1 FROM delivery_outbox d WHERE d.booking_id = b.id AND d.state = 'failed' AND d.last_error_code IS NOT 'reschedule_requested')");
  if (filters.deliveryFailed === false) clauses.push("NOT EXISTS (SELECT 1 FROM delivery_outbox d WHERE d.booking_id = b.id AND d.state = 'failed' AND d.last_error_code IS NOT 'reschedule_requested')");
  if (filters.ids) { clauses.push("b.id IN (SELECT value FROM json_each(?))"); values.push(JSON.stringify(filters.ids)); }
  if (filters.query) {
    clauses.push("(instr(CAST(b.invitee_name_folded AS BLOB), CAST(? AS BLOB)) > 0 OR instr(CAST(b.invitee_email_folded AS BLOB), CAST(? AS BLOB)) > 0)");
    const folded = foldBookingSearch(filters.query);
    values.push(folded, folded);
  }
  return { clause: clauses.join(" AND "), values };
}

export class BookingsRepository {
  readonly requests: RescheduleRequestsRepository;
  constructor(private readonly binding: D1Database) { this.requests = new RescheduleRequestsRepository(binding); }

  async createNonce(input: {
    nonceHash: string;
    linkId?: string;
    purpose: "confirm" | "reschedule";
    eventTypeId: string;
    bookingId?: string;
    selection: BookingSelection;
    expiresAt: string;
    now: string;
  }) {
    const id = createId();
    await this.binding
      .prepare("INSERT INTO booking_nonces (id, nonce_hash, purpose, event_type_id, booking_id, selection_start_at, selection_end_at, invitee_timezone, expires_at, created_at, link_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, input.nonceHash, input.purpose, input.eventTypeId, input.bookingId ?? null, input.selection.startAt, input.selection.endAt, input.selection.inviteeTimezone, input.expiresAt, input.now, input.linkId ?? null)
      .run();
    return id;
  }

  async getNonce(nonceHash: string): Promise<NonceRecord | undefined> {
    const row = await this.binding
      .prepare("SELECT id, link_id AS linkId, purpose, event_type_id AS eventTypeId, booking_id AS bookingId, selection_start_at AS selectionStartAt, selection_end_at AS selectionEndAt, invitee_timezone AS inviteeTimezone, expires_at AS expiresAt, consumed_at AS consumedAt, payload_hash AS payloadHash, result_booking_id AS resultBookingId FROM booking_nonces WHERE nonce_hash = ?")
      .bind(nonceHash)
      .first<NonceRecord>();
    return row ?? undefined;
  }

  /** A free confirmation is admitted by its nonce; a paid conversion only by its still-active payment hold,
   * whose own statements (payment record, hold confirmation) commit in the same transaction. */
  async claim(input: BookingClaim, payment?: { holdId: string; statements: D1PreparedStatement[] }): Promise<"claimed" | "slot_taken" | "blocked"> {
    const event = input.event;
    const meetingState = event.locationType === "google_meet" ? "pending" : "not_required";
    const nonce = await this.getNonce(input.nonceHash);
    const guard = await slotClaimGuard(this.binding, input, payment ? holdAdmission(payment.holdId) : nonceAdmission(input.nonceId, input.nonceHash, input.now), nonce?.linkId, payment?.holdId);
    const statements: D1PreparedStatement[] = [
      this.binding.prepare(
        `INSERT INTO bookings (id, event_type_id, event_slug, event_title, duration_minutes, location_type, location_label, location_value, invitee_name, invitee_email, host_timezone, invitee_timezone, state, ical_uid, calendar_required, calendar_state, meeting_state, meeting_url, created_at, updated_at, attribution_json, post_booking_redirect_url)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'pending', ?, NULL, ?, ?, ?, ?
         WHERE ${guard.sql}`,
      ).bind(input.bookingId, event.id, event.slug, event.title, (Date.parse(input.selection.endAt) - Date.parse(input.selection.startAt)) / 60_000, event.locationType, event.locationLabel, event.locationValue, input.invitee.name, input.invitee.email, input.hostTimezone, input.selection.inviteeTimezone, `dial-${input.bookingId}@dial`, input.calendarPayload ? 1 : 0, meetingState, input.now, input.now, JSON.stringify(input.attribution ?? {}), input.postBookingRedirectUrl ?? null, ...guard.params),
      this.binding.prepare(
        "INSERT INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at) SELECT ?, ?, 0, ?, ?, ?, ?, ?, 'current', 1, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)",
      ).bind(input.occurrenceId, input.bookingId, input.selection.startAt, input.selection.endAt, input.occupiedStartAt, input.occupiedEndAt, input.hostDate, input.now, input.bookingId),
      this.binding.prepare("UPDATE bookings SET current_occurrence_id = ? WHERE id = ? AND current_occurrence_id IS NULL").bind(input.occurrenceId, input.bookingId),
      ...bookingCorrespondenceStatements(this.binding, input.bookingId, event.id, input.now),
      ...bookingPresentationStatements(this.binding, input, true),
      ...answerStatements(this.binding, input.bookingId, event.questions, input.invitee.answers, input.now),
      this.binding.prepare(
        "INSERT INTO booking_manage_tokens (id, booking_id, token_hash, expires_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)",
      ).bind(input.manageTokenId, input.bookingId, input.manageTokenHash, input.manageTokenExpiresAt, input.now, input.now, input.bookingId),
      this.binding.prepare(
        "INSERT INTO booking_history (id, booking_id, occurrence_id, action, actor_type, actor_id, new_start_at, created_at) SELECT ?, ?, ?, 'created', 'invitee', NULL, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)",
      ).bind(createId(), input.bookingId, input.occurrenceId, input.selection.startAt, input.now, input.bookingId),
      ...outboxStatements(this.binding, input.bookingId, input.occurrenceId, input.calendarPayload, input.emails, input.now),
      this.binding.prepare("UPDATE booking_links SET consumed_at=?,consumed_booking_id=?,updated_at=? WHERE id=(SELECT link_id FROM booking_nonces WHERE id=?) AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM bookings WHERE id=?)").bind(input.now,input.bookingId,input.now,input.nonceId,input.bookingId),
      payment
        // The hold consumed the nonce when the slot was held; the paid booking becomes its replay result.
        ? this.binding.prepare("UPDATE booking_nonces SET result_booking_id = ? WHERE id = ? AND nonce_hash = ? AND EXISTS (SELECT 1 FROM bookings WHERE id = ?)").bind(input.bookingId, input.nonceId, input.nonceHash, input.bookingId)
        : this.binding.prepare(
          "UPDATE booking_nonces SET consumed_at = ?, payload_hash = ?, result_booking_id = ? WHERE id = ? AND nonce_hash = ? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM bookings WHERE id = ?)",
        ).bind(input.now, input.payloadHash, input.bookingId, input.nonceId, input.nonceHash, input.bookingId),
      ...(payment?.statements ?? []),
    ];
    statements.push(blockedProbe(this.binding, input.invitee.email));
    const results = await this.binding.batch(statements);
    // D1 includes search-trigger writes in meta.changes; any successful insert wins.
    return results[0].meta.changes > 0 ? "claimed" : (results.at(-1)?.results[0] as { blocked: number }).blocked ? "blocked" : "slot_taken";
  }

  /** PAY-001: hold the slot for one payer through the same atomic guard, consuming the selection nonce so a
   * replay finds this hold. The pending claim and payer address live only on the active hold. */
  async claimPaymentHold(input: BookingClaim, hold: { id: string; kind: "payment" | "setup"; accountId: string; amountCents: number; returnTokenHash: string; returnExpiresAt: string; expiresAt: string }): Promise<"claimed" | "slot_taken" | "blocked"> {
    const nonce = await this.getNonce(input.nonceHash);
    const guard = await slotClaimGuard(this.binding, input, nonceAdmission(input.nonceId, input.nonceHash, input.now), nonce?.linkId);
    const results = await this.binding.batch([
      this.binding.prepare(`INSERT INTO payment_holds (id, nonce_id, event_type_id, link_id, account_id, state, start_at, end_at, occupied_start_at, occupied_end_at, host_date, amount_cents, currency, checkout_session_id, checkout_url, return_token_hash, return_expires_at, claim_json, invitee_email_folded, booking_id, ended_reason, expires_at, created_at, updated_at, kind)
        SELECT ?, ?, ?, ?, ?, 'held', ?, ?, ?, ?, ?, ?, 'usd', NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?
        WHERE ${guard.sql} AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM payment_holds other WHERE other.link_id = ? AND other.state IN ('held', 'processing')))`)
        .bind(hold.id, input.nonceId, input.event.id, nonce?.linkId ?? null, hold.accountId, input.selection.startAt, input.selection.endAt, input.occupiedStartAt, input.occupiedEndAt, input.hostDate, hold.amountCents, hold.returnTokenHash, hold.returnExpiresAt, JSON.stringify({ ...input, emails: [] }), foldBookingSearch(input.invitee.email), hold.expiresAt, input.now, input.now, hold.kind, ...guard.params, nonce?.linkId ?? null, nonce?.linkId ?? null),
      this.binding.prepare("UPDATE booking_nonces SET consumed_at = ?, payload_hash = ? WHERE id = ? AND nonce_hash = ? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM payment_holds WHERE id = ?)").bind(input.now, input.payloadHash, input.nonceId, input.nonceHash, hold.id),
      blockedProbe(this.binding, input.invitee.email),
    ]);
    return results[0].meta.changes > 0 ? "claimed" : (results.at(-1)?.results[0] as { blocked: number }).blocked ? "blocked" : "slot_taken";
  }

  async requestBrowserTimezone(requestId: string) {
    const row = await this.binding.prepare("SELECT browser_timezone AS browserTimezone FROM availability_requests WHERE id=?").bind(requestId).first<{ browserTimezone: string | null }>();
    return row?.browserTimezone ?? null;
  }

  operatorCreationReceipt(keyHash: string) { return readOperatorCreation(this.binding, keyHash); }
  operatorCreationErased(keyHash: string, operatorId: string) { return isErasedOperatorCreation(this.binding, keyHash, operatorId); }

  /** An operator uses the same conflict-protected write without a public nonce. */
  async claimForOperator(input: OperatorBookingClaim, operatorId: string): Promise<"claimed" | "slot_taken" | "blocked"> {
    const event = input.event;
    const requestForAcknowledgement = input.requestId
      ? await this.binding.prepare("SELECT event_title AS eventTitle FROM availability_requests WHERE id = ?").bind(input.requestId).first<{ eventTitle: string }>()
      : undefined;
    const meetingState = event.locationType === "google_meet" ? "pending" : "not_required";
    const holds=offeredHoldPredicate(input.occupiedStartAt,input.occupiedEndAt), paid=paymentHoldPredicate(input.occupiedStartAt,input.occupiedEndAt);
    const limits = await new BookingLimits(this.binding).predicate(event.id, input.hostTimezone, input.selection.startAt, input.selection.endAt, input.invitee.email, undefined);
    const statements: D1PreparedStatement[] = [
      this.binding.prepare(
        `INSERT INTO bookings (id, event_type_id, event_slug, event_title, duration_minutes, location_type, location_label, location_value, invitee_name, invitee_email, host_timezone, invitee_timezone, state, ical_uid, calendar_required, calendar_state, meeting_state, meeting_url, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'pending', ?, NULL, ?, ?
         WHERE NOT ${blockedAddressSql}
           AND (? IS NULL OR (NOT EXISTS (SELECT 1 FROM operator_creation_receipts WHERE key_hash = ?) AND NOT EXISTS (SELECT 1 FROM operator_creation_tombstones WHERE key_hash = ?))) AND (? IS NULL OR EXISTS (SELECT 1 FROM availability_requests r WHERE r.id = ? AND r.state = 'submitted' AND r.event_type_id = ? AND lower(r.invitee_email) = lower(?))) AND NOT EXISTS (
           SELECT 1 FROM booking_occurrences occurrence
           JOIN bookings existing ON existing.id = occurrence.booking_id
           WHERE occurrence.is_current = 1 AND occurrence.blocks_time = 1
             AND existing.state IN ('confirmed', 'rescheduled')
             AND occurrence.occupied_start_at < ?
             AND occurrence.occupied_end_at > ?
         ) AND (? IS NULL OR (SELECT count(*) FROM booking_occurrences o JOIN bookings b ON b.id = o.booking_id WHERE o.is_current = 1 AND o.blocks_time = 1 AND b.state IN ('confirmed', 'rescheduled') AND o.host_date = ?) < ?) AND ${holds.sql} AND ${limits.sql} AND ${paid.sql}`,
      ).bind(input.bookingId, event.id, event.slug, event.title, (Date.parse(input.selection.endAt) - Date.parse(input.selection.startAt)) / 60_000, event.locationType, event.locationLabel, event.locationValue, input.invitee.name, input.invitee.email, input.hostTimezone, input.selection.inviteeTimezone, `dial-${input.bookingId}@dial`, input.calendarPayload ? 1 : 0, meetingState, input.now, input.now, ...blockedAddressValues(input.invitee.email), input.creationIdentity?.keyHash ?? null, input.creationIdentity?.keyHash ?? null, input.creationIdentity?.keyHash ?? null, input.requestId ?? null, input.requestId ?? null, event.id, input.invitee.email, input.occupiedEndAt, input.occupiedStartAt, event.hostDayBookingLimit, input.hostDate, event.hostDayBookingLimit, ...holds.params, ...limits.params, ...paid.params),
      this.binding.prepare(
        "INSERT INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at) SELECT ?, ?, 0, ?, ?, ?, ?, ?, 'current', 1, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)",
      ).bind(input.occurrenceId, input.bookingId, input.selection.startAt, input.selection.endAt, input.occupiedStartAt, input.occupiedEndAt, input.hostDate, input.now, input.bookingId),
      this.binding.prepare("UPDATE bookings SET current_occurrence_id = ? WHERE id = ? AND current_occurrence_id IS NULL").bind(input.occurrenceId, input.bookingId),
      ...bookingCorrespondenceStatements(this.binding, input.bookingId, event.id, input.now),
      ...bookingPresentationStatements(this.binding, input, false, input.requestId),
      ...answerStatements(this.binding, input.bookingId, event.questions, input.invitee.answers, input.now),
      this.binding.prepare(
        "INSERT INTO booking_manage_tokens (id, booking_id, token_hash, expires_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)",
      ).bind(input.manageTokenId, input.bookingId, input.manageTokenHash, input.manageTokenExpiresAt, input.now, input.now, input.bookingId),
      this.binding.prepare(
        "INSERT INTO booking_history (id, booking_id, occurrence_id, action, actor_type, actor_id, new_start_at, created_at) SELECT ?, ?, ?, 'created', 'operator', ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)",
      ).bind(createId(), input.bookingId, input.occurrenceId, operatorId, input.selection.startAt, input.now, input.bookingId),
      ...(input.requestId ? [this.binding.prepare("UPDATE availability_requests SET state = 'handled', booking_id = ?, handled_at = ?, state_changed_by_operator_id = ?, updated_at = ? WHERE id = ? AND state = 'submitted' AND EXISTS (SELECT 1 FROM bookings WHERE id = ?)").bind(input.bookingId, input.now, operatorId, input.now, input.requestId, input.bookingId)] : []),
      ...(input.requestId && requestForAcknowledgement ? [linkedBookingAcknowledgement(this.binding, input.requestId, input.bookingId, input.hostName, requestForAcknowledgement.eventTitle, input.now)] : []),
      ...outboxStatements(this.binding, input.bookingId, input.occurrenceId, input.calendarPayload, input.emails, input.now),
      ...(input.creationIdentity ? [operatorCreationStatement(this.binding, input.creationIdentity, operatorId, input.bookingId, input.now)] : []),
    ];
    statements.push(this.binding.prepare(`SELECT ${blockedAddressSql} AS blocked`).bind(...blockedAddressValues(input.invitee.email)));
    const results = await this.binding.batch(statements);
    // D1 includes search-trigger writes in meta.changes; any successful insert wins.
    return results[0].meta.changes > 0 ? "claimed" : (results.at(-1)?.results[0] as { blocked: number }).blocked ? "blocked" : "slot_taken";
  }

  async getById(id: string): Promise<BookingRecord | undefined> {
    const row = await this.binding
      .prepare(
        `SELECT b.imported, b.attribution_json AS attributionJson, b.post_booking_redirect_url AS postBookingRedirectUrl, b.id, b.event_type_id AS eventTypeId, b.event_slug AS eventSlug, b.event_title AS eventTitle, b.location_type AS locationType, b.location_label AS locationLabel, b.location_value AS locationValue, b.invitee_name AS inviteeName, b.invitee_email AS inviteeEmail, b.host_timezone AS hostTimezone, b.invitee_timezone AS inviteeTimezone, b.state, b.ical_uid AS icalUid, CASE WHEN b.calendar_required = 0 THEN 'not_required' ELSE b.calendar_state END AS calendarState, b.meeting_state AS meetingState, b.meeting_url AS meetingUrl, b.calendar_provider_event_id AS calendarProviderEventId, b.calendar_provider_updated_at AS calendarProviderUpdatedAt, b.created_at AS createdAt, b.updated_at AS updatedAt, b.cancelled_at AS cancelledAt, b.cancelled_reason AS cancelledReason,
          o.id AS occurrenceId, o.sequence AS occurrenceSequence, o.start_at AS occurrenceStartAt, o.end_at AS occurrenceEndAt, o.occupied_start_at AS occupiedStartAt, o.occupied_end_at AS occupiedEndAt, o.host_date AS hostDate, o.state AS occurrenceState, o.is_current AS isCurrent
         FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id WHERE b.id = ?`,
      )
      .bind(id)
      .first<OperatorBookingRow>();
    if (!row) return undefined;
    const [booking, payment] = await Promise.all([hydrateOperatorBooking(this.binding, row), new PaymentsRepository(this.binding).bookingPayment(id)]);
    return payment ? { ...booking, payment } : booking;
  }

  async getByConsumedNonce(nonce: NonceRecord): Promise<BookingRecord | undefined> {
    return nonce.resultBookingId ? this.getById(nonce.resultBookingId) : undefined;
  }

  async getByProviderEventId(providerEventId: string): Promise<BookingRecord | undefined> {
    const row = await this.binding.prepare("SELECT id FROM bookings WHERE calendar_provider_event_id = ?").bind(providerEventId).first<{ id: string }>();
    return row ? this.getById(row.id) : undefined;
  }

  async advanceCalendarWatermark(booking: BookingRecord, providerUpdatedAt: string) {
    await this.binding.prepare("UPDATE bookings SET calendar_provider_updated_at = ? WHERE id = ? AND current_occurrence_id = ? AND (calendar_provider_updated_at IS NULL OR calendar_provider_updated_at < ?)").bind(providerUpdatedAt, booking.id, booking.occurrence.id, providerUpdatedAt).run();
  }

  async enqueueCalendarRepair(booking: BookingRecord, source: string) {
    const now = new Date().toISOString();
    if (booking.calendarState === "not_required") return;
    const kind = booking.state === "cancelled" ? "calendar_cancel" : "calendar_upsert";
    const payload = { bookingId: booking.id, occurrenceId: booking.occurrence.id, icalUid: booking.icalUid, eventTitle: booking.eventTitle, startAt: booking.occurrence.startAt, endAt: booking.occurrence.endAt, hostTimezone: booking.hostTimezone, invitee: { name: booking.inviteeName, email: booking.inviteeEmail }, location: booking.locationValue, locationType: booking.locationType };
    const id = createId();
    await this.binding.batch([
      this.binding.prepare("INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at) SELECT ?, ?, ?, id, ?, NULL, ?, 'pending', 0, ?, ?, ? FROM bookings WHERE id = ? AND current_occurrence_id = ? ON CONFLICT(idempotency_key) DO NOTHING").bind(id, kind, `booking:${booking.id}:repair:${source}`, booking.occurrence.id, JSON.stringify(payload), now, now, now, booking.id, booking.occurrence.id),
      this.binding.prepare("UPDATE bookings SET calendar_state = 'pending' WHERE id = ? AND current_occurrence_id = ? AND EXISTS (SELECT 1 FROM delivery_outbox WHERE id = ?)").bind(booking.id, booking.occurrence.id, id),
    ]);
  }

  async recordCalendarConflict(input: { booking: BookingRecord; providerEventId: string; providerUpdatedAt: string; externalStartAt?: string; externalEndAt?: string; externalLocation?: string }) {
    const canonicalLocation = input.booking.locationType === "google_meet" ? (input.booking.locationValue || "Google Meet") : input.booking.locationValue;
    const now = new Date().toISOString();
    await this.binding.batch([
      this.binding.prepare("INSERT INTO booking_calendar_conflicts (id, booking_id, occurrence_id, provider_event_id, provider_updated_at, canonical_start_at, canonical_end_at, canonical_location, external_start_at, external_end_at, external_location, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?) ON CONFLICT(booking_id, occurrence_id, provider_event_id, provider_updated_at) DO NOTHING")
        .bind(createId(), input.booking.id, input.booking.occurrence.id, input.providerEventId, input.providerUpdatedAt, input.booking.occurrence.startAt, input.booking.occurrence.endAt, canonicalLocation, input.externalStartAt ?? null, input.externalEndAt ?? null, input.externalLocation ?? null, now, now),
      this.binding.prepare("UPDATE bookings SET calendar_provider_updated_at = ?, updated_at = ? WHERE id = ? AND (calendar_provider_updated_at IS NULL OR calendar_provider_updated_at < ?)")
        .bind(input.providerUpdatedAt, now, input.booking.id, input.providerUpdatedAt),
    ]);
  }

  async restoreCalendarConflict(booking: BookingRecord, conflictId: string, now: string) {
    return restoreCalendarConflict(this.binding, booking, conflictId, now);
  }

  async findManageToken(tokenHash: string, now: string): Promise<ManageTokenLookup | undefined> {
    const token = await this.binding
      .prepare("SELECT booking_id AS bookingId, expires_at AS expiresAt, rotated_at AS rotatedAt, invalidated_at AS invalidatedAt FROM booking_manage_tokens WHERE token_hash = ?")
      .bind(tokenHash)
      .first<{ bookingId: string; expiresAt: string; rotatedAt: string | null; invalidatedAt: string | null }>();
    if (!token) return undefined;
    const booking = await this.getById(token.bookingId);
    if (!booking) return undefined;
    const status = token.invalidatedAt ? "invalidated" : token.rotatedAt ? "rotated" : token.expiresAt <= now ? "expired" : "active";
    return { booking, status };
  }

  async listInternalClaims(startAt: string, endAt: string, excludedBookingId?: string) {
    const records = await this.binding
      .prepare(
        `SELECT o.occupied_start_at AS startAt, o.occupied_end_at AS endAt, o.host_date AS hostDate
         FROM booking_occurrences o JOIN bookings b ON b.id = o.booking_id
         WHERE o.is_current = 1 AND o.blocks_time = 1 AND b.state IN ('confirmed', 'rescheduled')
           AND o.occupied_start_at < ? AND o.occupied_end_at > ?
           AND (? IS NULL OR b.id <> ?)`,
      )
      .bind(endAt, startAt, excludedBookingId ?? null, excludedBookingId ?? null)
      .all<{ startAt: string; endAt: string; hostDate: string }>();
    return [...records.results, ...await activeHoldIntervals(this.binding, startAt, endAt)];
  }

  async contactHost(booking: BookingRecord, key: string, message: string | undefined, now: string) {
    return contactHost(this.binding, booking, key, message, now);
  }

  async listOperatorRecipients() {
    const result = await this.binding.prepare("SELECT id, email, access_generation AS generation FROM operators WHERE removed_at IS NULL ORDER BY created_at").all<{ id: string; email: string; generation: number }>();
    return result.results;
  }

  async listForOperator(filters: OperatorBookingFilters, now: string) {
    const { clause, values } = operatorBookingWhere(filters, now);
    const order = filters.order === "created" ? "b.created_at DESC, b.id DESC" : "o.start_at";
    const results = await this.binding.prepare(
      `SELECT b.imported, b.attribution_json AS attributionJson, b.post_booking_redirect_url AS postBookingRedirectUrl, b.id, b.event_type_id AS eventTypeId, b.event_slug AS eventSlug, b.event_title AS eventTitle, b.location_type AS locationType, b.location_label AS locationLabel, b.location_value AS locationValue, b.invitee_name AS inviteeName, b.invitee_email AS inviteeEmail, b.host_timezone AS hostTimezone, b.invitee_timezone AS inviteeTimezone, b.state, b.ical_uid AS icalUid, CASE WHEN b.calendar_required = 0 THEN 'not_required' ELSE b.calendar_state END AS calendarState, b.meeting_state AS meetingState, b.meeting_url AS meetingUrl, b.calendar_provider_event_id AS calendarProviderEventId, b.calendar_provider_updated_at AS calendarProviderUpdatedAt, b.created_at AS createdAt, b.updated_at AS updatedAt, b.cancelled_at AS cancelledAt, b.cancelled_reason AS cancelledReason,
        o.id AS occurrenceId, o.sequence AS occurrenceSequence, o.start_at AS occurrenceStartAt, o.end_at AS occurrenceEndAt, o.occupied_start_at AS occupiedStartAt, o.occupied_end_at AS occupiedEndAt, o.host_date AS hostDate, o.state AS occurrenceState, o.is_current AS isCurrent
       FROM bookings b JOIN booking_occurrences o ON ${clause} ORDER BY ${order}, b.id LIMIT ? OFFSET ?`,
    ).bind(...values, filters.limit ?? 500, filters.offset ?? 0).all<OperatorBookingRow>();
    const [bookings, payments] = await Promise.all([hydrateOperatorBookings(this.binding, results.results), new PaymentsRepository(this.binding).bookingPayments(results.results.map(row => row.id))]);
    return bookings.map(booking => payments.has(booking.id) ? { ...booking, payment: payments.get(booking.id) } : booking);
  }

  async countForOperator(filters: OperatorBookingFilters, now: string) {
    const { clause, values } = operatorBookingWhere(filters, now);
    const result = await this.binding.prepare(`SELECT COUNT(DISTINCT b.id) AS totalCount FROM bookings b JOIN booking_occurrences o ON ${clause}`).bind(...values).first<{ totalCount: number }>();
    return result?.totalCount ?? 0;
  }

  async markAttendance(booking: BookingRecord, operatorId: string, status: "attended" | "no_show", note: string, now: string) {
    await this.binding.batch([
      this.binding.prepare("INSERT INTO booking_attendance (booking_id, status, note, marked_by_operator_id, marked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(booking_id) DO UPDATE SET status = excluded.status, note = excluded.note, marked_by_operator_id = excluded.marked_by_operator_id, marked_at = excluded.marked_at").bind(booking.id, status, note, operatorId, now),
      this.binding.prepare("INSERT INTO booking_history (id, booking_id, occurrence_id, action, actor_type, actor_id, reason, created_at) VALUES (?, ?, ?, 'attendance_marked', 'operator', ?, ?, ?)").bind(createId(), booking.id, booking.occurrence.id, operatorId, status, now),
    ]);
  }

  isBlocked(email: string) { return new PublicAbuseRepository(this.binding).isBlocked(email); }
  limitExclusions(eventId: string, zone: string, startAt: string, endAt: string, email: string, excludedBookingId?: string) {
    return new BookingLimits(this.binding).evaluate(eventId, zone, startAt, endAt, email, excludedBookingId);
  }

  /** `money` holds PAY-003's pending refund or fee movements, each conditioned on this cancellation winning. */
  async cancel(booking: BookingRecord, actor: { type: "invitee" | "operator" | "calendar_provider" | "system"; id?: string }, reason: string | undefined, now: string, emails: BookingEmail[], money: D1PreparedStatement[] = []) {
    if (booking.state === "cancelled") return booking;
    const policy = actor.type === "invitee" ? inviteeChangePolicyPredicate({ bookingId: booking.id, action: "cancel", now }) : { sql: "1", params: [] };
    // This transaction deliberately selects `current_occurrence_id` after it wins the
    // cancellation update. A concurrent reschedule therefore cancels its replacement,
    // instead of closing the stale occurrence supplied by the caller.
    const statements: D1PreparedStatement[] = [
      this.binding.prepare(`UPDATE bookings SET state = 'cancelled', calendar_state = CASE WHEN calendar_required=0 THEN calendar_state WHEN imported=1 AND calendar_provider_event_id IS NULL THEN 'succeeded' ELSE 'pending' END, cancelled_at = ?, cancelled_reason = ?, updated_at = ? WHERE id = ? AND state IN ('confirmed', 'rescheduled') AND ${policy.sql}`).bind(now, reason ?? null, now, booking.id, ...policy.params),
      this.binding.prepare(`UPDATE booking_occurrences
        SET state = 'cancelled', closed_at = ?
        WHERE booking_id = ? AND is_current = 1
          AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND state = 'cancelled' AND cancelled_at = ?)`)
        .bind(now, booking.id, booking.id, now),
      this.binding.prepare(`UPDATE delivery_outbox
        SET state = 'failed', last_error_code = 'superseded_occurrence', updated_at = ?
        WHERE booking_id = ? AND kind IN ('calendar_upsert', 'reminder')
          AND state = 'pending'
          AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND state = 'cancelled' AND cancelled_at = ?)`)
        .bind(now, booking.id, booking.id, now),
      this.binding.prepare(`INSERT INTO booking_history (id, booking_id, occurrence_id, action, actor_type, actor_id, previous_start_at, reason, created_at)
        SELECT ?, booking.id, occurrence.id, 'cancelled', ?, ?, occurrence.start_at, ?, ?
        FROM bookings booking JOIN booking_occurrences occurrence ON occurrence.id = booking.current_occurrence_id
        WHERE booking.id = ? AND booking.state = 'cancelled' AND booking.cancelled_at = ?
          AND NOT EXISTS (SELECT 1 FROM booking_history WHERE booking_id = booking.id AND action = 'cancelled')`)
        .bind(createId(), actor.type, actor.id ?? null, reason ?? null, now, booking.id, now),
      this.binding.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
        SELECT ?, 'calendar_cancel', ? || occurrence.id || ':calendar-cancel', booking.id, occurrence.id, NULL,
          json_object('bookingId', booking.id, 'occurrenceId', occurrence.id), 'pending', 0, ?, ?, ?
        FROM bookings booking JOIN booking_occurrences occurrence ON occurrence.id = booking.current_occurrence_id
        WHERE booking.calendar_required = 1 AND (booking.imported = 0 OR booking.calendar_provider_event_id IS NOT NULL) AND booking.id = ? AND booking.state = 'cancelled' AND booking.cancelled_at = ?
        ON CONFLICT(idempotency_key) DO NOTHING`)
        .bind(createId(), `booking:${booking.id}:occurrence:`, now, now, now, booking.id, now),
      ...cancellationOutboxStatements(this.binding, booking.id, emails, now),
      closeCalendarConflicts(this.binding, booking.id, now),
      ...money,
    ];
    await this.binding.batch(statements);
    return this.getById(booking.id);
  }

  async reschedule(input: {
    booking: BookingRecord;
    nonceId: string;
    nonceHash: string;
    payloadHash: string;
    reason?: string;
    selection: BookingSelection;
    hostDate: string;
    hostTimezone: string;
    occupiedStartAt: string;
    occupiedEndAt: string;
    now: string;
    calendarPayload: Record<string, unknown> | undefined;
    emails: BookingEmail[];
  }): Promise<"rescheduled" | "slot_taken"> {
    const policy = inviteeChangePolicyPredicate({ bookingId: input.booking.id, action: "reschedule", now: input.now });
    const occurrenceId = createId();
    const nextSequence = input.booking.occurrence.sequence + 1;
    const holds=offeredHoldPredicate(input.occupiedStartAt,input.occupiedEndAt), paid=paymentHoldPredicate(input.occupiedStartAt,input.occupiedEndAt);
    const limits = await new BookingLimits(this.binding).predicate(input.booking.eventTypeId!, input.hostTimezone, input.selection.startAt, input.selection.endAt, input.booking.inviteeEmail, input.booking.id);
    const statements: D1PreparedStatement[] = [
      this.binding.prepare(
        `INSERT INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'current', 0, ?
         WHERE EXISTS (SELECT 1 FROM booking_nonces WHERE id = ? AND nonce_hash = ? AND consumed_at IS NULL AND expires_at > ? AND booking_id = ?)
           AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND state IN ('confirmed', 'rescheduled') AND current_occurrence_id = ?)
           AND NOT EXISTS (
             SELECT 1 FROM booking_occurrences occurrence JOIN bookings existing ON existing.id = occurrence.booking_id
             WHERE occurrence.is_current = 1 AND occurrence.blocks_time = 1 AND existing.state IN ('confirmed', 'rescheduled')
               AND existing.id <> ? AND occurrence.occupied_start_at < ? AND occurrence.occupied_end_at > ?
           ) AND NOT EXISTS (SELECT 1 FROM event_types et WHERE et.id = ? AND et.host_day_booking_limit IS NOT NULL AND (SELECT count(*) FROM booking_occurrences o JOIN bookings b ON b.id = o.booking_id WHERE o.is_current = 1 AND o.blocks_time = 1 AND b.state IN ('confirmed', 'rescheduled') AND b.id <> ? AND o.host_date = ?) >= et.host_day_booking_limit) AND ${holds.sql} AND ${limits.sql} AND ${paid.sql} AND ${policy.sql}`,
      ).bind(occurrenceId, input.booking.id, nextSequence, input.selection.startAt, input.selection.endAt, input.occupiedStartAt, input.occupiedEndAt, input.hostDate, input.now, input.nonceId, input.nonceHash, input.now, input.booking.id, input.booking.id, input.booking.occurrence.id, input.booking.id, input.occupiedEndAt, input.occupiedStartAt, input.booking.eventTypeId, input.booking.id, input.hostDate, ...holds.params, ...limits.params, ...paid.params, ...policy.params),
      this.binding.prepare("UPDATE booking_occurrences SET state = 'rescheduled', is_current = 0, replaced_by_occurrence_id = ?, closed_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND booking_id = ?)").bind(occurrenceId, input.now, input.booking.occurrence.id, occurrenceId, input.booking.id),
      this.binding.prepare("UPDATE delivery_outbox SET state = 'failed', last_error_code = 'superseded_occurrence', updated_at = ? WHERE booking_id = ? AND occurrence_id = ? AND kind IN ('calendar_upsert', 'reminder') AND state = 'pending' AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND booking_id = ?)").bind(input.now, input.booking.id, input.booking.occurrence.id, occurrenceId, input.booking.id),
      this.binding.prepare("UPDATE booking_occurrences SET is_current = 1 WHERE id = ? AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND is_current = 0 AND state = 'rescheduled')").bind(occurrenceId, input.booking.occurrence.id),
      this.binding.prepare("UPDATE bookings SET state = 'rescheduled', current_occurrence_id = ?, invitee_timezone = ?, calendar_required = ?, calendar_state = 'pending', updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND is_current = 1)").bind(occurrenceId, input.selection.inviteeTimezone, input.calendarPayload ? 1 : 0, input.now, input.booking.id, occurrenceId),
      this.binding.prepare("UPDATE booking_presentation SET browser_timezone=?,updated_at=? WHERE booking_id=? AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id=? AND is_current=1)").bind(input.selection.inviteeTimezone, input.now, input.booking.id, occurrenceId),
      this.binding.prepare("INSERT INTO booking_history (id, booking_id, occurrence_id, action, actor_type, actor_id, previous_start_at, new_start_at, reason, created_at) SELECT ?, ?, ?, 'rescheduled', 'invitee', NULL, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND is_current = 1)").bind(createId(), input.booking.id, occurrenceId, input.booking.occurrence.startAt, input.selection.startAt, input.reason ?? null, input.now, occurrenceId),
      this.binding.prepare("UPDATE booking_manage_tokens SET expires_at = ?, updated_at = ? WHERE booking_id = ? AND rotated_at IS NULL AND invalidated_at IS NULL AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND is_current = 1)").bind(new Date(Date.parse(input.selection.startAt) + 90 * 86400000).toISOString(), input.now, input.booking.id, occurrenceId),
      ...outboxStatements(this.binding, input.booking.id, occurrenceId, input.calendarPayload ? { ...input.calendarPayload, occurrenceId } : undefined, input.emails, input.now),
      this.binding.prepare("UPDATE booking_nonces SET consumed_at = ?, payload_hash = ?, result_booking_id = ? WHERE id = ? AND nonce_hash = ? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND is_current = 1)").bind(input.now, input.payloadHash, input.booking.id, input.nonceId, input.nonceHash, occurrenceId),
    ];
    const results = await this.binding.batch(statements);
    return results[0].meta.changes === 1 ? "rescheduled" : "slot_taken";
  }

  async rescheduleForOperator(input: {
    booking: BookingRecord;
    operatorId: string;
    manageCapability?: { previousTokenId: string | undefined; id: string; hash: string };
    reason?: string;
    selection: BookingSelection;
    hostDate: string;
    hostTimezone: string;
    occupiedStartAt: string;
    occupiedEndAt: string;
    now: string;
    calendarPayload: Record<string, unknown> | undefined;
    emails: BookingEmail[];
  }): Promise<"rescheduled" | "slot_taken"> {
    const occurrenceId = createId();
    const nextSequence = input.booking.occurrence.sequence + 1;
    const holds=offeredHoldPredicate(input.occupiedStartAt,input.occupiedEndAt), paid=paymentHoldPredicate(input.occupiedStartAt,input.occupiedEndAt);
    const limits = await new BookingLimits(this.binding).predicate(input.booking.eventTypeId!, input.hostTimezone, input.selection.startAt, input.selection.endAt, input.booking.inviteeEmail, input.booking.id);
    const statements: D1PreparedStatement[] = [
      this.binding.prepare(
        `INSERT INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'current', 0, ?
         WHERE EXISTS (
           SELECT 1 FROM booking_occurrences current
           JOIN bookings booking ON booking.id = current.booking_id
           WHERE current.id = ? AND current.is_current = 1 AND current.booking_id = ?
             AND booking.state IN ('confirmed', 'rescheduled')
         )
           AND (? = 0 OR COALESCE((SELECT id FROM booking_manage_tokens WHERE booking_id = ? AND rotated_at IS NULL AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1), '') = ?)
           AND NOT EXISTS (
             SELECT 1 FROM booking_occurrences occurrence JOIN bookings existing ON existing.id = occurrence.booking_id
             WHERE occurrence.is_current = 1 AND occurrence.blocks_time = 1 AND existing.state IN ('confirmed', 'rescheduled')
               AND existing.id <> ? AND occurrence.occupied_start_at < ? AND occurrence.occupied_end_at > ?
           ) AND NOT EXISTS (SELECT 1 FROM event_types et WHERE et.id = ? AND et.host_day_booking_limit IS NOT NULL AND (SELECT count(*) FROM booking_occurrences o JOIN bookings b ON b.id = o.booking_id WHERE o.is_current = 1 AND o.blocks_time = 1 AND b.state IN ('confirmed', 'rescheduled') AND b.id <> ? AND o.host_date = ?) >= et.host_day_booking_limit) AND ${holds.sql} AND ${limits.sql} AND ${paid.sql}`,
      ).bind(occurrenceId, input.booking.id, nextSequence, input.selection.startAt, input.selection.endAt, input.occupiedStartAt, input.occupiedEndAt, input.hostDate, input.now, input.booking.occurrence.id, input.booking.id, input.manageCapability ? 1 : 0, input.booking.id, input.manageCapability?.previousTokenId ?? "", input.booking.id, input.occupiedEndAt, input.occupiedStartAt, input.booking.eventTypeId, input.booking.id, input.hostDate, ...holds.params, ...limits.params, ...paid.params),
      this.binding.prepare("UPDATE booking_occurrences SET state = 'rescheduled', is_current = 0, replaced_by_occurrence_id = ?, closed_at = ? WHERE id = ? AND is_current = 1 AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND booking_id = ?)").bind(occurrenceId, input.now, input.booking.occurrence.id, occurrenceId, input.booking.id),
      this.binding.prepare("UPDATE delivery_outbox SET state = 'failed', last_error_code = 'superseded_occurrence', updated_at = ? WHERE booking_id = ? AND occurrence_id = ? AND kind IN ('calendar_upsert', 'reminder') AND state = 'pending' AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND booking_id = ?)").bind(input.now, input.booking.id, input.booking.occurrence.id, occurrenceId, input.booking.id),
      this.binding.prepare("UPDATE booking_occurrences SET is_current = 1 WHERE id = ? AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND state = 'rescheduled' AND is_current = 0)").bind(occurrenceId, input.booking.occurrence.id),
      this.binding.prepare("UPDATE bookings SET state = 'rescheduled', current_occurrence_id = ?, invitee_timezone = ?, calendar_required = ?, calendar_state = 'pending', updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND is_current = 1)").bind(occurrenceId, input.selection.inviteeTimezone, input.calendarPayload ? 1 : 0, input.now, input.booking.id, occurrenceId),
      this.binding.prepare("INSERT INTO booking_history (id, booking_id, occurrence_id, action, actor_type, actor_id, previous_start_at, new_start_at, reason, created_at) SELECT ?, ?, ?, 'rescheduled', 'operator', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND is_current = 1)").bind(createId(), input.booking.id, occurrenceId, input.operatorId, input.booking.occurrence.startAt, input.selection.startAt, input.reason ?? null, input.now, occurrenceId),
      this.binding.prepare("UPDATE booking_manage_tokens SET expires_at = ?, updated_at = ? WHERE booking_id = ? AND rotated_at IS NULL AND invalidated_at IS NULL AND EXISTS (SELECT 1 FROM booking_occurrences WHERE id = ? AND is_current = 1)").bind(new Date(Date.parse(input.selection.startAt) + 90 * 86400000).toISOString(), input.now, input.booking.id, occurrenceId),
      ...(input.manageCapability ? [
        this.binding.prepare("UPDATE booking_manage_tokens SET rotated_at = ?, updated_at = ? WHERE booking_id = ? AND rotated_at IS NULL AND invalidated_at IS NULL AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND current_occurrence_id = ?)").bind(input.now, input.now, input.booking.id, input.booking.id, occurrenceId),
        this.binding.prepare("INSERT INTO booking_manage_tokens (id, booking_id, token_hash, expires_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND current_occurrence_id = ?)").bind(input.manageCapability.id, input.booking.id, input.manageCapability.hash, new Date(Date.parse(input.selection.startAt) + 90 * 86400000).toISOString(), input.now, input.now, input.booking.id, occurrenceId),
      ] : []),
      ...outboxStatements(this.binding, input.booking.id, occurrenceId, input.calendarPayload ? { ...input.calendarPayload, occurrenceId } : undefined, input.emails, input.now),
    ];
    const results = await this.binding.batch(statements);
    return results[0].meta.changes === 1 ? "rescheduled" : "slot_taken";
  }

  async storedManageUrl(bookingId: string) {
    const rows = await this.binding.prepare("SELECT payload_json AS payload FROM delivery_outbox WHERE booking_id = ? AND json_extract(payload_json, '$.recipientRole') = 'invitee' ORDER BY updated_at DESC").bind(bookingId).all<{ payload: string }>();
    for (const row of rows.results) {
      const payload = JSON.parse(row.payload) as { manageUrl?: string; text?: string };
      const url = payload.manageUrl ?? /https?:\/\/[^\s]+\/manage\/[^\s]+/u.exec(payload.text ?? "")?.[0];
      if (url) return url;
    }
    return undefined;
  }

  async rotateManageToken(bookingId: string, tokenId: string, tokenHash: string, expiresAt: string, now: string, manageUrl?: string) {
    await this.binding.batch([
      this.binding.prepare("UPDATE booking_manage_tokens SET rotated_at = ?, updated_at = ? WHERE booking_id = ? AND rotated_at IS NULL AND invalidated_at IS NULL").bind(now, now, bookingId),
      this.binding.prepare("INSERT INTO booking_manage_tokens (id, booking_id, token_hash, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(tokenId, bookingId, tokenHash, expiresAt, now, now),
      ...(manageUrl ? [this.binding.prepare("UPDATE delivery_outbox SET payload_json = json_set(payload_json, '$.manageUrl', ?), updated_at = ? WHERE booking_id = ? AND json_extract(payload_json, '$.recipientRole') = 'invitee'").bind(manageUrl, now, bookingId)] : []),
    ]);
  }

  async getActiveManageTokenId(bookingId: string) {
    const record = await this.binding.prepare("SELECT id FROM booking_manage_tokens WHERE booking_id = ? AND rotated_at IS NULL AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(bookingId).first<{ id: string }>();
    return record?.id;
  }
}

function answerStatements(binding: D1Database, bookingId: string, questions: BookingClaim["event"]["questions"], answers: BookingClaim["invitee"]["answers"], now: string) {
  return questions.flatMap((question) => {
    if (!question.key || answers[question.key] === undefined) return [];
    return [binding.prepare("INSERT INTO booking_answers (id, booking_id, question_key, question_label, question_kind, value_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)").bind(createId(), bookingId, question.key, question.label, question.kind, JSON.stringify(answers[question.key]), now, bookingId)];
  });
}
