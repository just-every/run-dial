import { evaluateChangePolicy, defaultInheritedChangePolicyWindows } from "../../shared/change-policy";
import type { EventBookingPolicy } from "../../shared/booking-policy";
import type { BookingCalendarConflict, BookingDelivery, BookingHistoryEntry, BookingOccurrence, BookingRecord } from "./types";

export type OperatorBookingRow = {
  imported: number;
  attributionJson: string;
  postBookingRedirectUrl: string | null;
  id: string;
  eventTypeId: string | null;
  eventSlug: string;
  eventTitle: string;
  locationType: string;
  locationLabel: string;
  locationValue: string;
  inviteeName: string;
  inviteeEmail: string;
  hostTimezone: string;
  inviteeTimezone: string;
  state: BookingRecord["state"];
  icalUid: string;
  calendarState: BookingRecord["calendarState"];
  meetingState: BookingRecord["meetingState"];
  meetingUrl: string | null;
  calendarProviderEventId: string | null;
  calendarProviderUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledReason: string | null;
  occurrenceId: string;
  occurrenceSequence: number;
  occurrenceStartAt: string;
  occurrenceEndAt: string;
  occupiedStartAt: string;
  occupiedEndAt: string;
  hostDate: string;
  occurrenceState: BookingOccurrence["state"];
  isCurrent: number;
};

type AnswerRow = { key: string; label: string; kind: string; valueJson: string };
type HistoryRow = BookingHistoryEntry;
type DeliveryRow = { id: string; kind: BookingDelivery["kind"]; occurrenceId: string | null; payloadJson: string; state: BookingDelivery["state"]; attempts: number; lastErrorCode: string | null; createdAt: string; succeededAt: string | null };
type AttendanceRow = { status: string; note: string; operatorId: string; markedAt: string };
type CalendarConflictRow = BookingCalendarConflict;
type BookingAnswerRow = AnswerRow & { bookingId: string };
type BookingHistoryRow = HistoryRow & { bookingId: string };
type BookingDeliveryRow = DeliveryRow & { bookingId: string };
type BookingAttendanceRow = AttendanceRow & { bookingId: string };
type BookingCalendarConflictRow = CalendarConflictRow & { bookingId: string };

type BookingHydrationData = {
  answers: AnswerRow[];
  history: HistoryRow[];
  deliveries: DeliveryRow[];
  attendance?: AttendanceRow;
  calendarConflicts: CalendarConflictRow[];
};

export async function hydrateOperatorBooking(binding: D1Database, row: OperatorBookingRow): Promise<BookingRecord> {
  const [booking] = await hydrateOperatorBookings(binding, [row]);
  return booking;
}

export async function hydrateOperatorBookings(binding: D1Database, rows: OperatorBookingRow[]): Promise<BookingRecord[]> {
  if (rows.length === 0) return [];
  const bookingIdsJson = JSON.stringify(rows.map((row) => row.id));
  const idSet = "IN (SELECT value FROM json_each(?))";
  const [answers, history, deliveries, attendance, calendarConflicts, presentations, policies] = await Promise.all([
    binding.prepare(`SELECT booking_id AS bookingId, question_key AS key, question_label AS label, question_kind AS kind, value_json AS valueJson FROM booking_answers WHERE booking_id ${idSet} ORDER BY created_at`).bind(bookingIdsJson).all<BookingAnswerRow>(),
    binding.prepare(`SELECT booking_id AS bookingId, id, occurrence_id AS occurrenceId, action, actor_type AS actorType, actor_id AS actorId, previous_start_at AS previousStartAt, new_start_at AS newStartAt, reason, created_at AS createdAt FROM booking_history WHERE booking_id ${idSet} ORDER BY created_at`).bind(bookingIdsJson).all<BookingHistoryRow>(),
    binding.prepare(`SELECT booking_id AS bookingId, id, kind, occurrence_id AS occurrenceId, payload_json AS payloadJson, state, attempts, last_error_code AS lastErrorCode, created_at AS createdAt, succeeded_at AS succeededAt FROM delivery_outbox WHERE booking_id ${idSet} ORDER BY created_at`).bind(bookingIdsJson).all<BookingDeliveryRow>(),
    binding.prepare(`SELECT booking_id AS bookingId, status, note, marked_by_operator_id AS operatorId, marked_at AS markedAt FROM booking_attendance WHERE booking_id ${idSet}`).bind(bookingIdsJson).all<BookingAttendanceRow>(),
    binding.prepare(`SELECT booking_id AS bookingId, id, occurrence_id AS occurrenceId, provider_event_id AS providerEventId, provider_updated_at AS providerUpdatedAt, canonical_start_at AS canonicalStartAt, canonical_end_at AS canonicalEndAt, canonical_location AS canonicalLocation, external_start_at AS externalStartAt, external_end_at AS externalEndAt, external_location AS externalLocation, state, created_at AS createdAt FROM booking_calendar_conflicts WHERE booking_id ${idSet} ORDER BY created_at DESC`).bind(bookingIdsJson).all<BookingCalendarConflictRow>(),
    binding.prepare(`SELECT booking_id AS bookingId, locked_timezone AS lockedTimezone, browser_timezone AS browserTimezone FROM booking_presentation WHERE booking_id ${idSet}`).bind(bookingIdsJson).all<{ bookingId: string; lockedTimezone: string; browserTimezone: string | null }>(),
    binding.prepare(`SELECT b.id AS bookingId, p.locked_timezone AS lockedTimezone, p.reschedule_cutoff_minutes AS rescheduleCutoffMinutes, p.cancellation_cutoff_minutes AS cancellationCutoffMinutes, p.reschedule_cap AS maxInviteeReschedules FROM bookings b JOIN event_booking_policies p ON p.event_type_id=b.event_type_id WHERE b.id ${idSet}`).bind(bookingIdsJson).all<EventBookingPolicy & { bookingId: string }>(),
  ]);
  const policyById = new Map(policies.results.map(({ bookingId, ...policy }) => [bookingId, policy]));
  const presentationById = new Map(presentations.results.map(row => [row.bookingId, row]));
  const answersByBooking = groupByBookingId(answers.results, (row) => ({ key: row.key, label: row.label, kind: row.kind, valueJson: row.valueJson }));
  const historyByBooking = groupByBookingId(history.results, (row) => ({ id: row.id, occurrenceId: row.occurrenceId, action: row.action, actorType: row.actorType, actorId: row.actorId, previousStartAt: row.previousStartAt, newStartAt: row.newStartAt, reason: row.reason, createdAt: row.createdAt }));
  const deliveriesByBooking = groupByBookingId(deliveries.results, (row) => ({ id: row.id, kind: row.kind, occurrenceId: row.occurrenceId, payloadJson: row.payloadJson, state: row.state, attempts: row.attempts, lastErrorCode: row.lastErrorCode, createdAt: row.createdAt, succeededAt: row.succeededAt }));
  const attendanceByBooking = groupByBookingId(attendance.results, (row) => ({ status: row.status, note: row.note, operatorId: row.operatorId, markedAt: row.markedAt }));
  const conflictsByBooking = groupByBookingId(calendarConflicts.results, (row) => ({ id: row.id, occurrenceId: row.occurrenceId, providerEventId: row.providerEventId, providerUpdatedAt: row.providerUpdatedAt, canonicalStartAt: row.canonicalStartAt, canonicalEndAt: row.canonicalEndAt, canonicalLocation: row.canonicalLocation, externalStartAt: row.externalStartAt, externalEndAt: row.externalEndAt, externalLocation: row.externalLocation, state: row.state, createdAt: row.createdAt }));
  return rows.map((row) => ({ ...toBookingRecord(row, {
    answers: answersByBooking.get(row.id) ?? [],
    history: historyByBooking.get(row.id) ?? [],
    deliveries: deliveriesByBooking.get(row.id) ?? [],
    attendance: attendanceByBooking.get(row.id)?.[0],
    calendarConflicts: conflictsByBooking.get(row.id) ?? [],
  }), ...(policyById.has(row.id) ? { changePolicy: evaluateChangePolicy({ policy: policyById.get(row.id), startAt: row.occurrenceStartAt, now: new Date(), successfulInviteeReschedules: (historyByBooking.get(row.id) ?? []).filter(entry => entry.action === "rescheduled" && entry.actorType === "invitee").length, inherited: defaultInheritedChangePolicyWindows }) } : {}), ...(presentationById.has(row.id) ? { lockedTimezone: presentationById.get(row.id)!.lockedTimezone, browserTimezone: presentationById.get(row.id)!.browserTimezone } : {}) }));
}

function toBookingRecord(row: OperatorBookingRow, data: BookingHydrationData): BookingRecord {
  // Event edits preserve the creation snapshot; the current occurrence owns its verified duration.
  return {
    attribution: JSON.parse(row.attributionJson), postBookingRedirectUrl: row.postBookingRedirectUrl,
    imported: row.imported, id: row.id, eventTypeId: row.eventTypeId, eventSlug: row.eventSlug, eventTitle: row.eventTitle, durationMinutes: (Date.parse(row.occurrenceEndAt) - Date.parse(row.occurrenceStartAt)) / 60_000, locationType: row.locationType, locationLabel: row.locationLabel, locationValue: row.locationValue,
    inviteeName: row.inviteeName, inviteeEmail: row.inviteeEmail, hostTimezone: row.hostTimezone, inviteeTimezone: row.inviteeTimezone, state: row.state, icalUid: row.icalUid, calendarState: row.calendarState, meetingState: row.meetingState, meetingUrl: row.meetingUrl, calendarProviderEventId: row.calendarProviderEventId, calendarProviderUpdatedAt: row.calendarProviderUpdatedAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt, cancelledAt: row.cancelledAt, cancelledReason: row.cancelledReason,
    occurrence: { id: row.occurrenceId, sequence: row.occurrenceSequence, startAt: row.occurrenceStartAt, endAt: row.occurrenceEndAt, occupiedStartAt: row.occupiedStartAt, occupiedEndAt: row.occupiedEndAt, hostDate: row.hostDate, state: row.occurrenceState, isCurrent: Boolean(row.isCurrent) },
    answers: data.answers.map((answer) => ({ key: answer.key, label: answer.label, kind: answer.kind, value: JSON.parse(answer.valueJson) as string | string[] })),
    history: data.history,
    deliveries: data.deliveries.map(toOperatorDelivery),
    attendance: data.attendance ? { status: data.attendance.status as "attended" | "no_show", note: data.attendance.note, operatorId: data.attendance.operatorId, markedAt: data.attendance.markedAt } : null,
    calendarConflicts: data.calendarConflicts,
  };
}

function groupByBookingId<T extends { bookingId: string }, Value>(rows: T[], valueFor: (row: T) => Value) {
  const grouped = new Map<string, Value[]>();
  for (const row of rows) {
    const values = grouped.get(row.bookingId) ?? [];
    values.push(valueFor(row));
    grouped.set(row.bookingId, values);
  }
  return grouped;
}

function toOperatorDelivery(row: DeliveryRow): BookingDelivery {
  const delivery: BookingDelivery = { id: row.id, kind: row.kind, occurrenceId: row.occurrenceId, state: row.state, attempts: row.attempts, lastErrorCode: row.lastErrorCode, createdAt: row.createdAt, succeededAt: row.succeededAt };
  if (row.kind !== "mail_send" && row.kind !== "reminder") return delivery;
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  if (typeof payload.to !== "string" || typeof payload.subject !== "string" || typeof payload.text !== "string") return delivery;
  return { ...delivery, email: { to: payload.to, subject: payload.subject, text: payload.text.replace(/https?:\/\/[^\s]+\/manage\/[^\s]+/gu, "[private manage link]") } };
}
