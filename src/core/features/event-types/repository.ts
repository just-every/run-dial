import { afterPersistedTimestampSql, nextEventTimestampSql } from "./revision";
import { replaceDateOverride, deleteDateOverride } from "./override-writes";
import { readDateOverrides } from "./date-overrides/repository";
import type { ProfileRecord } from "../host-profile";
import { replaceEventDetails } from "./details-writes";
import { replaceRecurringWindows } from "./recurring-writes";
import { and, asc, eq, sql } from "drizzle-orm";
import { createDatabase } from "../../platform/db/client";
import {
  eventQuestions,
  eventTypes,
  recurringAvailabilityWindows,
} from "../../platform/db/schema";
import { createId, nowIso } from "../../shared/ids";
import { toPublicEventType, type PublicEventTypeRecord } from "./public";

export type EventStatus = "draft" | "published" | "disabled";
export type EventLocationType = "google_meet" | "fixed_link" | "phone" | "in_person";
export type EventQuestionKind = "text" | "textarea" | "single_choice" | "multiple_choice" | "checkbox";
export type EventQuestionOptionInput = { value: string; label: string };
export type EventQuestionInput = {
  /** A persisted, public-safe question key. Omit only when creating a new question. */
  key?: string;
  kind: EventQuestionKind;
  label: string;
  required: boolean;
  options: EventQuestionOptionInput[];
};
export type AvailabilityWindowInput = { weekday: number; startMinute: number; endMinute: number };
export type DateAvailabilityWindowInput = { startMinute: number; endMinute: number };
export type DateAvailabilityOverrideInput = {
  hostDate: string;
  mode: "open" | "closed";
  windows: DateAvailabilityWindowInput[];
};
export type DateAvailabilityOverrideRecord = DateAvailabilityOverrideInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
export type EventTypeInput = {
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  color: string;
  locationType: EventLocationType;
  locationLabel: string;
  locationValue: string;
  listed: boolean;
  alternativeRequestsEnabled: boolean;
  slotIncrementMinutes: 5 | 10 | 15 | 30 | 60;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  beforeBufferMinutes: number;
  afterBufferMinutes: number;
  hostDayBookingLimit: number | null;
  questions: EventQuestionInput[];
  availability: AvailabilityWindowInput[];
};
export type EventDetailsInput = Omit<EventTypeInput, "availability" | "alternativeRequestsEnabled">;

export type EventTypeRecord = EventTypeInput & { id: string; requestOnly?: boolean; status: EventStatus; createdAt: string; updatedAt: string };
export type { PublicEventTypeRecord } from "./public";

const nextEventTimestamp = (timestamp: string) => sql`max(${timestamp}, ${sql.raw(afterPersistedTimestampSql)})`;

export class EventTypesRepository {
  private readonly db;
  private readonly binding: D1Database;

  constructor(binding: D1Database) {
    this.binding = binding;
    this.db = createDatabase(binding);
  }

  async list(): Promise<EventTypeRecord[]> {
    const records = await this.db.select().from(eventTypes).orderBy(asc(eventTypes.createdAt));
    return Promise.all(records.map((record) => this.hydrate(record)));
  }

  async listPublishedListed(): Promise<PublicEventTypeRecord[]> {
    const records = await this.db
      .select()
      .from(eventTypes)
      .where(and(eq(eventTypes.status, "published"), eq(eventTypes.listed, true)))
      .orderBy(asc(eventTypes.createdAt));
    return Promise.all(records.map(async (record) => toPublicEventType(await this.hydrate(record))));
  }

  async get(id: string): Promise<EventTypeRecord | undefined> {
    const [record] = await this.db.select().from(eventTypes).where(eq(eventTypes.id, id));
    return record ? this.hydrate(record) : undefined;
  }

  async getBySlug(slug: string): Promise<EventTypeRecord | undefined> {
    const [record] = await this.db.select().from(eventTypes).where(eq(eventTypes.slug, slug));
    return record ? this.hydrate(record) : undefined;
  }

  async getPublishedRecordBySlug(slug: string): Promise<EventTypeRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(eventTypes)
      .where(and(eq(eventTypes.slug, slug), eq(eventTypes.status, "published")));
    return record ? this.hydrate(record) : undefined;
  }

  async hasEventType(id: string) {
    const [record] = await this.db.select({ id: eventTypes.id }).from(eventTypes).where(eq(eventTypes.id, id));
    return Boolean(record);
  }

  async listDateAvailabilityOverrides(eventTypeId: string): Promise<DateAvailabilityOverrideRecord[]> {
    return readDateOverrides(this.db, eventTypeId);
  }

  async replaceDateAvailabilityOverride(eventTypeId: string, input: DateAvailabilityOverrideInput): Promise<DateAvailabilityOverrideRecord> {
    await replaceDateOverride(this.binding, eventTypeId, input);
    const [result] = await readDateOverrides(this.db, eventTypeId, input.hostDate);
    if (!result) throw new Error("Date availability override was not persisted");
    return result;
  }

  async deleteDateAvailabilityOverride(eventTypeId: string, hostDate: string) {
    return deleteDateOverride(this.binding, eventTypeId, hostDate);
  }

  async getPublishedBySlug(slug: string): Promise<PublicEventTypeRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(eventTypes)
      .where(and(eq(eventTypes.slug, slug), eq(eventTypes.status, "published")));
    return record ? toPublicEventType(await this.hydrate(record)) : undefined;
  }

  async create(input: EventTypeInput): Promise<EventTypeRecord> {
    const id = createId();
    const timestamp = nowIso();
    await this.db.batch([
      this.db.insert(eventTypes).values({ id, status: "draft", ...eventColumns(input), createdAt: timestamp, updatedAt: timestamp }),
      ...childWrites(this.db, id, input, timestamp),
    ]);
    const result = await this.get(id);
    if (!result) throw new Error("Event type was not persisted");
    return result;
  }

  async update(id: string, input: EventTypeInput): Promise<EventTypeRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    const timestamp = nowIso();
    await this.db.batch([
      this.db.update(eventTypes).set({ ...eventColumns(input), updatedAt: nextEventTimestamp(timestamp) }).where(eq(eventTypes.id, id)),
      this.db.delete(eventQuestions).where(eq(eventQuestions.eventTypeId, id)),
      this.db.delete(recurringAvailabilityWindows).where(eq(recurringAvailabilityWindows.eventTypeId, id)),
      ...childWrites(this.db, id, input, timestamp),
    ]);
    return this.get(id);
  }

  async updateDetails(id: string, input: EventDetailsInput) {
    return await replaceEventDetails(this.binding, id, input) ? this.get(id) : undefined;
  }

  async replaceRecurringAvailability(id: string, windows: AvailabilityWindowInput[]) {
    return await replaceRecurringWindows(this.binding, id, windows) ? this.get(id) : undefined;
  }

  async setStatus(id: string, status: EventStatus): Promise<EventTypeRecord | undefined> {
    const timestamp = nowIso();
    // D1's changes count also includes copy-report deletion by the update trigger.
    const updated = await this.db.update(eventTypes).set({ status, updatedAt: nextEventTimestamp(timestamp) }).where(eq(eventTypes.id, id)).returning({ id: eventTypes.id });
    return updated.length === 1 && updated[0].id === id ? this.get(id) : undefined;
  }

  /** Provider checks may await network reads; recheck their local prerequisites at commit. */
  async publishChecked(event: EventTypeRecord, profile: ProfileRecord): Promise<EventTypeRecord | undefined> {
    const result = await this.binding.prepare(`UPDATE event_types SET status = 'published', request_only = 0, updated_at = ${nextEventTimestampSql} WHERE id = ? AND status = ? AND location_type = ? AND updated_at = ? AND EXISTS (SELECT 1 FROM host_profiles WHERE id = ? AND updated_at = ? AND handle = ? AND name = ? AND timezone = ?) AND EXISTS (SELECT 1 FROM recurring_availability_windows WHERE event_type_id = event_types.id) RETURNING id`)
      .bind(nowIso(), event.id, event.status, event.locationType, event.updatedAt, profile.id, profile.updatedAt, profile.handle, profile.name, profile.timezone).all();
    return result.results.length === 1 ? this.get(event.id) : undefined;
  }

  async openRequestsChecked(event: EventTypeRecord, profile: ProfileRecord): Promise<EventTypeRecord | undefined> {
    const result = await this.binding.prepare(`UPDATE event_types SET status='published', request_only=1, updated_at=${nextEventTimestampSql} WHERE id=? AND status=? AND updated_at=? AND alternative_requests_enabled=1 AND EXISTS(SELECT 1 FROM host_profiles WHERE id=? AND updated_at=? AND handle=? AND name=? AND timezone=?) RETURNING id`)
      .bind(nowIso(), event.id, event.status, event.updatedAt, profile.id, profile.updatedAt, profile.handle, profile.name, profile.timezone).all();
    return result.results.length === 1 ? this.get(event.id) : undefined;
  }

  async setAlternativeRequests(id: string, enabled: boolean) {
    const result = await this.binding.prepare(`UPDATE event_types SET alternative_requests_enabled=?, updated_at=${nextEventTimestampSql} WHERE id=? RETURNING id`).bind(Number(enabled), nowIso(), id).first();
    return result ? this.get(id) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    if (!(await this.get(id))) return false;
    await this.db.delete(eventTypes).where(eq(eventTypes.id, id)).run();
    return !(await this.get(id));
  }

  async ensureDraft(input: EventTypeInput): Promise<EventTypeRecord> {
    const existing = await this.getBySlug(input.slug);
    return existing ?? this.create(input);
  }

  private async hydrate(record: typeof eventTypes.$inferSelect): Promise<EventTypeRecord> {
    const [questions, availability] = await Promise.all([
      this.db.select().from(eventQuestions).where(eq(eventQuestions.eventTypeId, record.id)).orderBy(asc(eventQuestions.position)),
      this.db
        .select()
        .from(recurringAvailabilityWindows)
        .where(eq(recurringAvailabilityWindows.eventTypeId, record.id))
        .orderBy(asc(recurringAvailabilityWindows.weekday), asc(recurringAvailabilityWindows.startMinute)),
    ]);
    return {
      id: record.id,
      status: record.status,
      requestOnly: record.requestOnly,
      slug: record.slug,
      title: record.title,
      description: record.description,
      durationMinutes: record.durationMinutes,
      color: record.color,
      locationType: record.locationType as EventLocationType,
      locationLabel: record.locationLabel,
      locationValue: record.locationValue,
      listed: record.listed,
      alternativeRequestsEnabled: record.alternativeRequestsEnabled,
      slotIncrementMinutes: record.slotIncrementMinutes as EventTypeInput["slotIncrementMinutes"],
      minimumNoticeMinutes: record.minimumNoticeMinutes,
      bookingHorizonDays: record.bookingHorizonDays,
      beforeBufferMinutes: record.beforeBufferMinutes,
      afterBufferMinutes: record.afterBufferMinutes,
      hostDayBookingLimit: record.hostDayBookingLimit,
      questions: questions.map((question) => ({
        key: question.publicKey ?? `q_${question.id}`,
        kind: question.kind as EventQuestionKind,
        label: question.label,
        required: question.required,
        options: parseQuestionOptions(question.optionsJson),
      })),
      availability: availability.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

}

function childWrites(db: ReturnType<typeof createDatabase>, id: string, input: EventTypeInput, timestamp: string) {
  return [
    ...input.questions.map((question, position) =>
      db.insert(eventQuestions).values({
        id: createId(),
        eventTypeId: id,
        publicKey: question.key ?? `q_${createId()}`,
        position,
        kind: question.kind,
        label: question.label,
        required: question.required,
        optionsJson: JSON.stringify(question.options),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ),
    ...input.availability.map((window) =>
      db.insert(recurringAvailabilityWindows).values({
        id: createId(),
        eventTypeId: id,
        weekday: window.weekday,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ),
  ];
}

function eventColumns(input: EventTypeInput) {
  return {
    slug: input.slug,
    title: input.title,
    description: input.description,
    durationMinutes: input.durationMinutes,
    color: input.color,
    locationType: input.locationType,
    locationLabel: input.locationLabel,
    locationValue: input.locationValue,
    listed: input.listed,
    alternativeRequestsEnabled: input.alternativeRequestsEnabled,
    slotIncrementMinutes: input.slotIncrementMinutes,
    minimumNoticeMinutes: input.minimumNoticeMinutes,
    bookingHorizonDays: input.bookingHorizonDays,
    beforeBufferMinutes: input.beforeBufferMinutes,
    afterBufferMinutes: input.afterBufferMinutes,
    hostDayBookingLimit: input.hostDayBookingLimit,
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
