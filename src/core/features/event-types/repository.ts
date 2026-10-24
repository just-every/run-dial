import type { EventBookingPolicy } from "../../shared/booking-policy";
import { duplicateEvent } from "./duplicate";
import { eventScheduleBindings } from "../../platform/db/availability-schema";
import { NamedSchedules, bindEvent, yoursId } from "../availability";
import { hydrateEventTypes, readEventType } from "./hydration/repository";
import { afterPersistedTimestampSql, nextEventTimestampSql } from "../../shared/event-revision";
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

import type { PostBookingRedirect } from "./redirect-policy.mjs";
export type { PostBookingRedirect } from "./redirect-policy.mjs";

export type EventStatus = "draft" | "published" | "disabled";
import { offeredLocations, type EventLocationOption, type EventLocationType } from "./locations";
export type { EventLocationType } from "./locations";
export type EventQuestionKind = "text" | "textarea" | "phone" | "dropdown" | "single_choice" | "multiple_choice" | "checkbox";
export type EventQuestionOptionInput = { value: string; label: string };
export type EventQuestionInput = {
  /** A persisted, public-safe question key. Omit only when creating a new question. */
  key?: string;
  kind: EventQuestionKind;
  label: string;
  required: boolean;
  private?: boolean;
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
  durationOptionsMinutes?: number[];
  color: string;
  locations?: EventLocationOption[];
  locationType: EventLocationType;
  locationLabel: string;
  locationValue: string;
  listed: boolean;
  alternativeRequestsEnabled: boolean;
  slotIncrementMinutes: 5 | 10 | 15 | 30 | 45 | 60;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  bookingHorizonMode?: "calendar_days" | "weekdays" | "fixed_range" | "indefinite";
  bookingStartDate?: string | null;
  bookingEndDate?: string | null;

  beforeBufferMinutes: number;
  afterBufferMinutes: number;
  hostDayBookingLimit: number | null;
  postBookingRedirect?: PostBookingRedirect | null;
  questions: EventQuestionInput[];
  availability: AvailabilityWindowInput[];
};
export type EventDetailsInput = Omit<EventTypeInput, "availability" | "alternativeRequestsEnabled">;

export type EventTypeRecord = EventTypeInput & { bookingPolicy?: EventBookingPolicy; id: string; requestOnly?: boolean; status: EventStatus; createdAt: string; updatedAt: string };
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
    return hydrateEventTypes(this.db, records);
  }

  async listPublishedListed(): Promise<PublicEventTypeRecord[]> {
    const records = await this.db
      .select()
      .from(eventTypes)
      .where(and(eq(eventTypes.status, "published"), eq(eventTypes.listed, true)))
      .orderBy(asc(eventTypes.createdAt));
    return (await hydrateEventTypes(this.db, records)).map(toPublicEventType);
  }

  get(id: string): Promise<EventTypeRecord | undefined> {
    return readEventType(this.db, id);
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

  async effectiveDateOverrides(eventTypeId: string, firstDate: string, days: number) {
    return new NamedSchedules(this.binding).applyClosures(await this.listDateAvailabilityOverrides(eventTypeId), firstDate, days);
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

  /** On your hours, the event is bound to them and takes their windows in the same batch (made first when the install has none). */
  async create(input: EventTypeInput, hours: "own" | "yours" = "own"): Promise<EventTypeRecord> {
    const id = createId();
    const timestamp = nowIso();
    const scheduleId = hours === "yours" ? await yoursId(this.binding) : undefined;
    const writes = [
      this.db.insert(eventTypes).values({ id, status: "draft", ...eventColumns(input), createdAt: timestamp, updatedAt: timestamp }),
      ...childWrites(this.db, id, scheduleId ? { ...input, availability: [] } : input, timestamp),
    ].map(write => write.toSQL()).map(({ sql: text, params }) => this.binding.prepare(text).bind(...params));
    await this.binding.batch([...writes, ...scheduleId ? bindEvent(this.binding, id, scheduleId, timestamp) : []]);
    const result = await this.get(id);
    if (!result) throw new Error("Event type was not persisted");
    return result;
  }

  duplicate(id: string) { return duplicateEvent(this.binding, id); }

  async update(id: string, input: EventTypeInput): Promise<EventTypeRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    const timestamp = nowIso();
    const keepsHours = JSON.stringify(existing.availability) === JSON.stringify([...input.availability].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute));
    await this.db.batch([
      this.db.update(eventTypes).set({ ...eventColumns(input), updatedAt: nextEventTimestamp(timestamp) }).where(eq(eventTypes.id, id)),
      ...(keepsHours ? [] : [this.db.delete(eventScheduleBindings).where(eq(eventScheduleBindings.eventTypeId, id))]),
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
    // Poll invitations and their mail custody use ownership links outside the FK
    // graph. Remove them before participants cascade, in the same transaction as
    // the event and its booking links (whose deletion releases held candidates).
    const invitations = `json_extract(payload_json,'$.pollParticipantId') IN (
      SELECT p.id FROM poll_participants p JOIN meeting_polls m ON m.id=p.poll_id WHERE m.event_type_id=?
    )`;
    const deliveryIds = `SELECT COALESCE(json_extract(payload_json,'$.providerIdempotencyKey'),idempotency_key)
      FROM delivery_outbox WHERE ${invitations}`;
    await this.binding.batch([
      this.binding.prepare(`DELETE FROM rer_mail_development_outbox WHERE json_extract(message,'$.deliveryId') IN (${deliveryIds})`).bind(id),
      this.binding.prepare(`DELETE FROM provider_webhook_events WHERE delivery_id IN (${deliveryIds})`).bind(id),
      this.binding.prepare(`DELETE FROM base_mail_dispatch WHERE delivery_id IN (${deliveryIds})`).bind(id),
      this.binding.prepare(`DELETE FROM delivery_outbox WHERE ${invitations}`).bind(id),
      this.binding.prepare("DELETE FROM meeting_polls WHERE event_type_id=?").bind(id),
      this.binding.prepare("DELETE FROM event_types WHERE id=?").bind(id),
    ]);
    return !(await this.get(id));
  }

  async ensureDraft(input: EventTypeInput): Promise<EventTypeRecord> {
    const existing = await this.getBySlug(input.slug);
    return existing ?? this.create(input);
  }

  private async hydrate(record: typeof eventTypes.$inferSelect): Promise<EventTypeRecord> {
    const [event] = await hydrateEventTypes(this.db, [record]);
    return event;
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
        private: question.private ?? false,
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
    durationOptionsJson: JSON.stringify(input.durationOptionsMinutes ?? [input.durationMinutes]),
    color: input.color,
    locationsJson: input.locations ? JSON.stringify(input.locations) : null,
    locationType: offeredLocations(input)[0].type,
    locationLabel: offeredLocations(input)[0].label,
    locationValue: offeredLocations(input)[0].value,
    listed: input.listed,
    alternativeRequestsEnabled: input.alternativeRequestsEnabled,
    slotIncrementMinutes: input.slotIncrementMinutes,
    minimumNoticeMinutes: input.minimumNoticeMinutes,
    bookingHorizonDays: input.bookingHorizonDays,
    bookingHorizonMode: input.bookingHorizonMode ?? "calendar_days",
    bookingStartDate: input.bookingStartDate ?? null,
    bookingEndDate: input.bookingEndDate ?? null,
    beforeBufferMinutes: input.beforeBufferMinutes,
    afterBufferMinutes: input.afterBufferMinutes,
    hostDayBookingLimit: input.hostDayBookingLimit,
    postBookingRedirectJson: input.postBookingRedirect ? JSON.stringify(input.postBookingRedirect) : null,
  };
}
