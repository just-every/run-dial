import type { PublicEvent, PublicEventPayload, PublicProfile } from "./types";
import type { BookingDetailsCapability, PublicSelectionLookup } from "./selection-types";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof value[key] === "string");
function isProfile(value: unknown): value is PublicProfile {
  return record(value) && strings(value, ["handle", "name", "title", "biography", "timezone"])
    && Array.isArray(value.focusAreas) && value.focusAreas.every((area) => record(area) && strings(area, ["label"]))
    && Array.isArray(value.socialProof) && value.socialProof.every((proof) => record(proof) && strings(proof, ["quote", "attribution"]));
}
function isEvent(value: unknown): value is PublicEvent {
  return record(value) && strings(value, ["slug", "title", "description", "color", "locationLabel"])
    && typeof value.bookingHorizonDays === "number" && Number.isInteger(value.bookingHorizonDays) && value.bookingHorizonDays > 0
    && typeof value.durationMinutes === "number" && Number.isFinite(value.durationMinutes)
    && (value.requestOnly === undefined || typeof value.requestOnly === "boolean")
    && typeof value.alternativeRequestsEnabled === "boolean" && Array.isArray(value.questions)
    && value.questions.every((question) => record(question) && strings(question, ["key", "label", "kind"])
      && ["text", "textarea", "phone", "dropdown", "single_choice", "multiple_choice", "checkbox"].includes(String(question.kind))
      && typeof question.required === "boolean" && Array.isArray(question.options)
      && question.options.every((option) => record(option) && strings(option, ["value", "label"])));
}
function profile(value: PublicProfile): PublicProfile {
  return { avatarKey: value.avatarKey, handle: value.handle, name: value.name, title: value.title, biography: value.biography, timezone: value.timezone,
    focusAreas: value.focusAreas.map(({ label }) => ({ label })), socialProof: value.socialProof.map(({ quote, attribution }) => ({ quote, attribution })) };
}
function event(value: PublicEvent): PublicEvent {
  return { requestOnly: value.requestOnly, slug: value.slug, title: value.title, description: value.description, bookingHorizonDays: value.bookingHorizonDays, bookingHorizonMode: value.bookingHorizonMode, bookingStartDate: value.bookingStartDate, bookingEndDate: value.bookingEndDate, durationMinutes: value.durationMinutes, color: value.color,
    locationLabel: value.locationLabel, alternativeRequestsEnabled: value.alternativeRequestsEnabled,
    questions: value.questions.map(({ key, kind, label, required, options }) => ({ key, kind, label, required, options: options.map(({ value, label }) => ({ value, label })) })) };
}

/** Root document data is untyped and can belong to another route during navigation. */
export function seedEvent(value: unknown, handle: string, slug: string): PublicEventPayload | undefined {
  if (!record(value) || !isProfile(value.profile) || !isEvent(value.eventType) || value.profile.handle !== handle || value.eventType.slug !== slug) return undefined;
  return { profile: profile(value.profile), eventType: event(value.eventType) };
}
export function seedProfile(value: unknown, handle: string): { profile: PublicProfile; eventTypes: PublicEvent[] } | undefined {
  if (!record(value) || !isProfile(value.profile) || value.profile.handle !== handle || !Array.isArray(value.eventTypes) || !value.eventTypes.every(isEvent)) return undefined;
  return { profile: profile(value.profile), eventTypes: value.eventTypes.map(event) };
}
export function seedSelection(value: unknown, handle: string, slug: string, capability: BookingDetailsCapability): PublicSelectionLookup | undefined {
  if (!record(value) || !isProfile(value.host) || !isEvent(value.event) || !record(value.selection)
    || value.host.handle !== handle || value.event.slug !== slug || value.nonce !== capability.nonce
    || value.selection.startAt !== capability.startAt || value.selection.inviteeTimezone !== capability.inviteeTimezone
    || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))
    || typeof value.selection.endAt !== "string" || !Number.isFinite(Date.parse(value.selection.endAt))
    || !Number.isFinite(Date.parse(capability.startAt)) || Date.parse(value.selection.endAt) <= Date.parse(capability.startAt)
    || value.selection.hostTimezone !== value.host.timezone) return undefined;
  return { nonce: capability.nonce, expiresAt: value.expiresAt, selection: { startAt: capability.startAt, endAt: value.selection.endAt, hostTimezone: value.host.timezone, inviteeTimezone: capability.inviteeTimezone }, host: profile(value.host), event: event(value.event) };
}
