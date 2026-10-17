import { z } from "zod";
import { ianaTimeZoneSchema } from "./scheduling";

/** Bounded integers remain exact in JavaScript and in SQLite arithmetic. */
export const bookingPolicyIntegerSchema = z.number().int().min(0).max(2_147_483_647);

export const eventBookingPolicySchema = z.object({
  lockedTimezone: ianaTimeZoneSchema.nullable().default(null),
  rescheduleCutoffMinutes: bookingPolicyIntegerSchema.nullable().default(null),
  cancellationCutoffMinutes: bookingPolicyIntegerSchema.nullable().default(null),
  maxInviteeReschedules: bookingPolicyIntegerSchema.nullable().default(null),
}).strict();

export type EventBookingPolicy = z.infer<typeof eventBookingPolicySchema>;

/** Null cutoffs inherit deployment policy; a null cap permits unlimited changes. */
export const defaultEventBookingPolicy: Readonly<EventBookingPolicy> = Object.freeze(eventBookingPolicySchema.parse({}));
