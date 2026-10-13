import type { EventQuestionInput, EventTypeRecord } from "./repository";

export type PublicEventQuestion = Required<Pick<EventQuestionInput, "key">> & Omit<EventQuestionInput, "key">;

export type PublicEventTypeRecord = Pick<
  EventTypeRecord,
  "requestOnly" | "slug" | "title" | "description" | "bookingHorizonDays" | "durationMinutes" | "color" | "locationLabel" | "alternativeRequestsEnabled"
> & { questions: PublicEventQuestion[] };

/** Deliberately project only values an invitee may receive before a booking exists. */
export function toPublicEventType(eventType: EventTypeRecord): PublicEventTypeRecord {
  return {
    requestOnly: eventType.requestOnly,
    slug: eventType.slug,
    title: eventType.title,
    description: eventType.description,
    bookingHorizonDays: eventType.bookingHorizonDays,
    durationMinutes: eventType.durationMinutes,
    color: eventType.color,
    locationLabel: eventType.locationLabel,
    alternativeRequestsEnabled: eventType.alternativeRequestsEnabled,
    questions: eventType.questions.map((question) => {
      if (!question.key) throw new Error("Persisted event question is missing its public key");
      return { ...question, key: question.key };
    }),
  };
}
