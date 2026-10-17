import { redirectConfigIssue, type PostBookingRedirect } from "../redirect-policy.mjs";
import { asc, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../../platform/db/client";
import { eventQuestions, eventTypes, recurringAvailabilityWindows } from "../../../platform/db/schema";
import type { EventLocationType, EventQuestionKind, EventQuestionOptionInput, EventTypeInput, EventTypeRecord } from "../repository";

/** The known ID lets parent and children share one fresh D1 transaction. */
export async function readEventType(db: ReturnType<typeof createDatabase>, id: string): Promise<EventTypeRecord | undefined> {
  const [records, questions, availability] = await db.batch([
    db.select().from(eventTypes).where(eq(eventTypes.id, id)),
    db.select().from(eventQuestions).where(eq(eventQuestions.eventTypeId, id)).orderBy(asc(eventQuestions.position)),
    db.select().from(recurringAvailabilityWindows).where(eq(recurringAvailabilityWindows.eventTypeId, id))
      .orderBy(asc(recurringAvailabilityWindows.weekday), asc(recurringAvailabilityWindows.startMinute)),
  ]);
  return records[0] ? eventRecord(records[0], questions, availability) : undefined;
}

/** One bound JSON array avoids D1's SQL parameter limit for larger event lists. */
export async function hydrateEventTypes(db: ReturnType<typeof createDatabase>, records: (typeof eventTypes.$inferSelect)[]): Promise<EventTypeRecord[]> {
  if (records.length === 0) return [];
  const ids = JSON.stringify(records.map(record => record.id));
  const [questions, availability] = await Promise.all([
    db.select().from(eventQuestions)
      .where(sql`${eventQuestions.eventTypeId} IN (SELECT value FROM json_each(${ids}))`)
      .orderBy(asc(eventQuestions.position)),
    db.select().from(recurringAvailabilityWindows)
      .where(sql`${recurringAvailabilityWindows.eventTypeId} IN (SELECT value FROM json_each(${ids}))`)
      .orderBy(asc(recurringAvailabilityWindows.weekday), asc(recurringAvailabilityWindows.startMinute)),
  ]);
  const questionsByEvent = groupByEvent(questions);
  const availabilityByEvent = groupByEvent(availability);
  return records.map(record => eventRecord(record, questionsByEvent.get(record.id) ?? [], availabilityByEvent.get(record.id) ?? []));
}

function groupByEvent<T extends { eventTypeId: string }>(records: T[]) {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const group = groups.get(record.eventTypeId);
    if (group) group.push(record);
    else groups.set(record.eventTypeId, [record]);
  }
  return groups;
}

function eventRecord(record: typeof eventTypes.$inferSelect, questions: (typeof eventQuestions.$inferSelect)[], availability: (typeof recurringAvailabilityWindows.$inferSelect)[]): EventTypeRecord {
  return {
    id: record.id,
    status: record.status,
    requestOnly: record.requestOnly,
    slug: record.slug,
    title: record.title,
    description: record.description,
    durationMinutes: record.durationMinutes,
    durationOptionsMinutes: JSON.parse(record.durationOptionsJson) as number[],
    color: record.color,
    locationType: record.locationType as EventLocationType,
    locationLabel: record.locationLabel,
    locationValue: record.locationValue,
    listed: record.listed,
    alternativeRequestsEnabled: record.alternativeRequestsEnabled,
    slotIncrementMinutes: record.slotIncrementMinutes as EventTypeInput["slotIncrementMinutes"],
    minimumNoticeMinutes: record.minimumNoticeMinutes,
    bookingHorizonDays: record.bookingHorizonDays,
    bookingHorizonMode: record.bookingHorizonMode,
    bookingStartDate: record.bookingStartDate,
    bookingEndDate: record.bookingEndDate,
    beforeBufferMinutes: record.beforeBufferMinutes,
    afterBufferMinutes: record.afterBufferMinutes,
    hostDayBookingLimit: record.hostDayBookingLimit,
    postBookingRedirect: parseRedirect(record.postBookingRedirectJson),
    questions: questions.map((question) => ({
      key: question.publicKey ?? `q_${question.id}`,
      kind: question.kind as EventQuestionKind,
      label: question.label,
      required: question.required,
      private: question.private,
      options: parseQuestionOptions(question.optionsJson),
    })),
    availability: availability.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function parseQuestionOptions(value: string): EventQuestionOptionInput[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((option) => {
    if (typeof option === "string") return { value: option, label: option };
    if (typeof option === "object" && option !== null && "value" in option && "label" in option) {
      const candidate = option as { value: unknown; label: unknown };
      if (typeof candidate.value === "string" && typeof candidate.label === "string") {
        return { value: candidate.value, label: candidate.label };
      }
    }
    throw new Error("Persisted event question has invalid options");
  });
}

function parseRedirect(value: string | null): PostBookingRedirect | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || redirectConfigIssue(parsed)) throw new Error("Persisted postBookingRedirect is invalid");
  return parsed as PostBookingRedirect;
}
