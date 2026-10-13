import { z } from "zod";

export const calendarChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deleted"), bookingId: z.string().optional(), occurrenceId: z.string().optional(), providerEventId: z.string().min(1), updatedAt: z.string().datetime({ offset: true }).optional() }),
  z.object({ kind: z.literal("changed"), bookingId: z.string().min(1), occurrenceId: z.string().min(1), providerEventId: z.string().min(1), updatedAt: z.string().datetime({ offset: true }), startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }), location: z.string().optional() }),
]);

/** A destination-calendar fact. No provider title, attendee, or description crosses this boundary. */
export type CalendarExternalChange =
  | {
    /** Google omits extended properties on some cancelled-event notifications. */
    bookingId?: string;
    occurrenceId?: string;
    providerEventId: string;
    /** Google can send a cancelled event with only its provider id. */
    updatedAt?: string;
    kind: "deleted";
  }
  | {
    bookingId: string;
    occurrenceId: string;
    providerEventId: string;
    updatedAt: string;
    kind: "changed";
    startAt: string;
    endAt: string;
    location?: string;
  };

/** Implemented by bookings so calendar transport never imports booking internals. */
export interface CalendarExternalChangeHandler {
  reconcileCalendarChange(change: CalendarExternalChange): Promise<void>;
}
