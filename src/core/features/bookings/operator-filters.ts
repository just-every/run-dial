import type { BookingRecord } from "./types";
import { bookingPaymentStateSql, type BookingPaymentState } from "./payment-state-filter";
import { foldBookingSearch } from "./search/case-fold.mjs";

export type OperatorBookingFilters = {
  paymentState?: BookingPaymentState;
  attendance?: "attended" | "no_show" | "unmarked";
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

export function operatorBookingWhere(filters: OperatorBookingFilters, now: string) {
  const clauses = ["b.current_occurrence_id = o.id"];
  const values: unknown[] = [];
  if (filters.paymentState) { clauses.push(`(${bookingPaymentStateSql}) = ?`); values.push(filters.paymentState); }
  if (filters.attendance === "unmarked") clauses.push("NOT EXISTS(SELECT 1 FROM booking_attendance a WHERE a.booking_id=b.id)");
  else if (filters.attendance) { clauses.push("EXISTS(SELECT 1 FROM booking_attendance a WHERE a.booking_id=b.id AND a.status=?)"); values.push(filters.attendance); }
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

/** Keep ordering identical across the list and export, including ties. */
export function operatorBookingOrder(filters: OperatorBookingFilters) {
  return filters.order === "created" ? "b.created_at DESC, b.id DESC" : "o.start_at, b.id";
}
