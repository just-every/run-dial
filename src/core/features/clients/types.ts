import type { BookingRecord } from "../bookings";

export type ClientList = { clients: Array<{ email: string; bookingCount: number }>; totalCount: number };
export type ClientBooking = {
  id: string; name: string; email: string; eventTitle: string; eventTypeId: string | null;
  state: BookingRecord["state"]; startAt: string; endAt: string; hostTimezone: string; inviteeTimezone: string;
  answers: BookingRecord["answers"]; attendance: BookingRecord["attendance"];
  payment: BookingRecord["payment"] | null; customFields: Array<{ id: string; label: string; value: string | boolean | null }> | null;
};
export type ClientHistory = { email: string; aliases: string[]; notes: Array<{id:string;body:string;operatorId:string;createdAt:string}>; fields: Array<{id:string;label:string;value:string}>; totalCount: number; bookings: ClientBooking[] };
