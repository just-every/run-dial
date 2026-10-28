import type { AppServices } from "../core/app/services";
import type { BookingDelivery, BookingOccurrence, BookingRecord } from "../core/features/bookings/types";
import { nativeResource, recordCount, resourceText } from "./resource-definition";

/** Delivery payloads and email bodies carry capabilities, including nested frozen mail. */
export function safeDelivery(delivery: BookingDelivery) {
  return {
    id: delivery.id, kind: delivery.kind, occurrenceId: delivery.occurrenceId, state: delivery.state,
    attempts: delivery.attempts, lastErrorCode: delivery.lastErrorCode,
    createdAt: delivery.createdAt, succeededAt: delivery.succeededAt,
  };
}

/** Explicit projection: newly added native fields never become agent disclosures by default. */
export function safeBooking(booking: BookingRecord) {
  return {
    id: booking.id, eventTypeId: booking.eventTypeId, eventSlug: booking.eventSlug,
    eventTitle: resourceText(booking.eventTitle), durationMinutes: booking.durationMinutes,
    locationType: booking.locationType, locationLabel: resourceText(booking.locationLabel),
    inviteeName: resourceText(booking.inviteeName), inviteeEmail: booking.inviteeEmail,
    hostTimezone: booking.hostTimezone, inviteeTimezone: booking.inviteeTimezone,
    state: booking.state, imported: Boolean(booking.imported), calendarState: booking.calendarState, meetingState: booking.meetingState,
    createdAt: booking.createdAt, updatedAt: booking.updatedAt, cancelledAt: booking.cancelledAt,
    cancelledReason: booking.cancelledReason ? resourceText(booking.cancelledReason) : null,
    occurrence: booking.occurrence,
    answers: booking.answers.map(answer => ({
      key: answer.key, label: resourceText(answer.label), kind: answer.kind,
      value: Array.isArray(answer.value) ? answer.value.map(resourceText) : resourceText(answer.value),
    })),
    history: booking.history.map(entry => ({ ...entry, reason: entry.reason ? resourceText(entry.reason) : null })),
    deliveries: booking.deliveries.map(safeDelivery),
    attendance: booking.attendance ? { ...booking.attendance, note: resourceText(booking.attendance.note) } : null,
    ...(booking.rescheduleRequest ? { rescheduleRequest: {
      id: booking.rescheduleRequest.id, state: booking.rescheduleRequest.state,
      message: resourceText(booking.rescheduleRequest.message), releaseTime: booking.rescheduleRequest.releaseTime,
      createdAt: booking.rescheduleRequest.createdAt, expiresAt: booking.rescheduleRequest.expiresAt,
      reminderAt: booking.rescheduleRequest.reminderAt, remindedAt: booking.rescheduleRequest.remindedAt,
      archiveHistorical: Boolean(booking.rescheduleRequest.archiveHistorical),
    } } : {}),
    ...(booking.payment ? { payment: {
      amountCents: booking.payment.amountCents, currency: booking.payment.currency, kind: booking.payment.kind,
      paidAt: booking.payment.paidAt, taxCents: booking.payment.taxCents,
    } } : {}),
  };
}

type OccurrenceRow = Omit<BookingOccurrence, "isCurrent"> & { bookingId: string; isCurrent: number; createdAt: string; closedAt: string | null };
type DeliveryRow = BookingDelivery & { bookingId: string | null; requestId: string | null; updatedAt: string };

export function bookingResources(services: AppServices) {
  return [
    nativeResource("bookings", "Booking", async id => {
      const booking = await services.bookings.getForOperator(id);
      return booking ? safeBooking(booking) : null;
    }, record => ({
      kind: `${record.imported ? "imported" : "native"}-booking${recordCount(record.answers) ? "-with-invitee-answers" : ""}`,
    })),
    nativeResource("occurrences", "Booking occurrence", async (id, ctx) => {
      const occurrence = await ctx.db.prepare(`SELECT id, booking_id AS bookingId, sequence, start_at AS startAt, end_at AS endAt,
        occupied_start_at AS occupiedStartAt, occupied_end_at AS occupiedEndAt, host_date AS hostDate, state,
        is_current AS isCurrent, created_at AS createdAt, closed_at AS closedAt FROM booking_occurrences WHERE id=?`)
        .bind(id).first<OccurrenceRow>();
      if (!occurrence || !await services.bookings.getForOperator(occurrence.bookingId)) return null;
      return { ...occurrence, isCurrent: Boolean(occurrence.isCurrent) };
    }, record => ({ kind: record.isCurrent ? "current-booking-occurrence" : "historical-booking-occurrence" })),
    nativeResource("deliveries", "Delivery status", async (id, ctx) => {
      const delivery = await ctx.db.prepare(`SELECT id, kind, booking_id AS bookingId, request_id AS requestId,
        occurrence_id AS occurrenceId, state, attempts, last_error_code AS lastErrorCode,
        created_at AS createdAt, updated_at AS updatedAt, succeeded_at AS succeededAt FROM delivery_outbox WHERE id=?`)
        .bind(id).first<DeliveryRow>();
      if (!delivery) return null;
      return { ...safeDelivery(delivery), bookingId: delivery.bookingId, requestId: delivery.requestId, updatedAt: delivery.updatedAt };
    }, record => ({ kind: record.kind === "mail_send" || record.kind === "reminder" ? "mail-delivery-status" : "calendar-delivery-status" })),
    nativeResource("payments", "Booking payment", async (id, ctx) => {
      const identity = await ctx.db.prepare("SELECT id, booking_id AS bookingId, provider, status, created_at AS createdAt, updated_at AS updatedAt FROM booking_payments WHERE id=?")
        .bind(id).first<{ id: string; bookingId: string; provider: string; status: string; createdAt: string; updatedAt: string }>();
      if (!identity) return null;
      const payment = (await services.bookings.getForOperator(identity.bookingId))?.payment;
      if (!payment) return null;
      return {
        ...identity, amountCents: payment.amountCents, currency: payment.currency,
        kind: payment.kind, paidAt: payment.paidAt, taxCents: payment.taxCents,
      };
    }, record => ({ kind: record.kind === "deposit" ? "booking-deposit" : "booking-payment" })),
  ];
}
