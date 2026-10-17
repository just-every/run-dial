import { publicLocations, type PublicLocationOption } from "./locations";
import type { EventQuestionInput, EventTypeRecord } from "./repository";

export type PublicEventQuestion = Required<Pick<EventQuestionInput, "key">> & Omit<EventQuestionInput, "key" | "private">;

export type PublicEventTypeRecord = Pick<
  EventTypeRecord,
  "bookingPolicy" | "requestOnly" | "slug" | "title" | "description" | "bookingHorizonDays" | "bookingHorizonMode" | "bookingStartDate" | "bookingEndDate" | "durationMinutes" | "durationOptionsMinutes" | "color" | "locationLabel" | "alternativeRequestsEnabled"
> & { locations?: PublicLocationOption[]; questions: PublicEventQuestion[] };

/** Deliberately project only values an invitee may receive before a booking exists. */
export function toPublicEventType(eventType: EventTypeRecord): PublicEventTypeRecord {
  return {
    ...(eventType.bookingPolicy ? { bookingPolicy: eventType.bookingPolicy } : {}),
    requestOnly: eventType.requestOnly,
    slug: eventType.slug,
    title: eventType.title,
    description: eventType.description,
    bookingHorizonDays: eventType.bookingHorizonDays,
    bookingHorizonMode: eventType.bookingHorizonMode,
    bookingStartDate: eventType.bookingStartDate,
    bookingEndDate: eventType.bookingEndDate,
    durationMinutes: eventType.durationMinutes,
    durationOptionsMinutes: eventType.durationOptionsMinutes,
    color: eventType.color,
    locationLabel: publicLocations(eventType).map(location => location.label).join(" or "),
    locations: publicLocations(eventType),
    alternativeRequestsEnabled: eventType.alternativeRequestsEnabled,
    questions: eventType.questions.map((question) => {
      if (!question.key) throw new Error("Persisted event question is missing its public key");
      return { key: question.key, kind: question.kind, label: question.label, required: question.required, options: question.options };
    }),
  };
}
