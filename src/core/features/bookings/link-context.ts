import { z } from "zod";
import type { EventTypeRecord } from "../event-types";
import type { BookingSelection, ValidatedInvitee } from "./types";

export const attributionKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "source"] as const;
export const attributionSchema = z.object(Object.fromEntries(attributionKeys.map(key => [key, z.string().trim().max(500).optional()])) as Record<typeof attributionKeys[number], z.ZodOptional<z.ZodString>>).strict();
export type BookingAttribution = Partial<Record<typeof attributionKeys[number], string>>;

/** Only explicitly submitted source fields participate in the claim and its replay identity. */
export function cleanAttribution(input: BookingAttribution = {}): BookingAttribution {
  return Object.fromEntries(attributionKeys.flatMap(key => input[key]?.trim() ? [[key, input[key]!.trim()]] : []));
}

/** Construct once, before the atomic claim. Replays read this committed projection. */
export function bookingRedirect(input: { event: EventTypeRecord; selection: BookingSelection; invitee: ValidatedInvitee; hostName: string; bookingId: string; attribution: BookingAttribution; routingAnswers?: import("../routing").RoutingAnswer[] }): string | null {
  const configuration = input.event.postBookingRedirect;
  if (!configuration) return null;
  const url = new URL(configuration.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("postBookingRedirect.url must be an HTTPS URL without credentials.");
  const values: Record<string, string | string[]> = {
    event: input.event.title, start_time: isoInZone(input.selection.startAt, input.selection.inviteeTimezone),
    end_time: isoInZone(input.selection.endAt, input.selection.inviteeTimezone), timezone: input.selection.inviteeTimezone,
    host: input.hostName, name: input.invitee.name, email: input.invitee.email, booking_reference: input.bookingId,
    ...input.attribution,
  };
  for (const question of input.event.questions) {
    if (question.key && !question.private && input.invitee.answers[question.key] !== undefined) values[`answer.${question.key}`] = input.invitee.answers[question.key];
  }
  for(const answer of input.routingAnswers??[])if(!answer.private && !input.event.questions.some(q=>q.key===answer.key))values[`answer.${answer.key}`]=answer.value;
  for (const key of configuration.fields) {
    // A later privacy edit takes precedence over a previously selected answer field.
    if (!(key in values)) continue;
    url.searchParams.delete(key);
    for (const value of Array.isArray(values[key]) ? values[key] : [values[key]]) url.searchParams.append(key, value);
  }
  return url.toString();
}

function isoInZone(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  const offset = part("timeZoneName").replace("GMT", "") || "+00:00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${offset}`;
}
