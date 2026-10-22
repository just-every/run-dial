import type { PublicEvent, PublicEventPayload, PublicProfile, SelectionPayment } from "./types";
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
    && (value.locations === undefined || (Array.isArray(value.locations) && value.locations.every(location => record(location) && strings(location, ["key", "label"]) && (location.input === undefined || ["phone", "place"].includes(String(location.input))) && (location.prompt === undefined || typeof location.prompt === "string"))))
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
  return { bookingPolicy: value.bookingPolicy, requestOnly: value.requestOnly, slug: value.slug, title: value.title, description: value.description, bookingHorizonDays: value.bookingHorizonDays, bookingHorizonMode: value.bookingHorizonMode, bookingStartDate: value.bookingStartDate, bookingEndDate: value.bookingEndDate, durationMinutes: value.durationMinutes, durationOptionsMinutes: value.durationOptionsMinutes, color: value.color,
    locations: value.locations?.map(({ key, label, input, prompt }) => ({ key, label, input, prompt })),
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
  const payment = selectionPayment(value.payment);
  return { ...(record(value.approval)&&typeof value.approval.windowHours==="number"?{approval:{windowHours:value.approval.windowHours}}:{}), guestLimit: typeof value.guestLimit === "number" && Number.isInteger(value.guestLimit) && value.guestLimit >= 0 && value.guestLimit <= 20 ? value.guestLimit : 0, nonce: capability.nonce, expiresAt: value.expiresAt, selection: { startAt: capability.startAt, endAt: value.selection.endAt, hostTimezone: value.host.timezone, inviteeTimezone: capability.inviteeTimezone }, host: profile(value.host), event: event(value.event), ...(payment ? { payment } : {}) };
}

/** PAY-001 and PAY-003: the pay step's amounts, balance, policy and consent, or nothing for a free booking. */
function selectionPayment(value: unknown): SelectionPayment | undefined {
  if (!record(value) || value.currency !== "usd" || !["payment", "setup"].includes(String(value.mode)) || !Array.isArray(value.policy) || !value.policy.every(line => typeof line === "string")) return undefined;
  const amounts = ["amountCents", "priceCents", "depositCents", "balanceCents"] as const;
  if (amounts.some(key => !Number.isInteger(value[key]))) return undefined;
  const instant = (entry: unknown) => typeof entry === "string" && Number.isFinite(Date.parse(entry)) ? entry : null;
  const consent = record(value.consent) && typeof value.consent.version === "string" && typeof value.consent.text === "string" && Number.isInteger(value.consent.lateCancelFeeCents) && Number.isInteger(value.consent.noShowFeeCents)
    ? { version: value.consent.version, text: value.consent.text, lateCancelFeeCents: value.consent.lateCancelFeeCents as number, noShowFeeCents: value.consent.noShowFeeCents as number } : undefined;
  return { amountCents: value.amountCents as number, currency: "usd", mode: value.mode as SelectionPayment["mode"], priceCents: value.priceCents as number, depositCents: value.depositCents as number, balanceCents: value.balanceCents as number,
    balanceDueAt: instant(value.balanceDueAt), freeWindowEndsAt: instant(value.freeWindowEndsAt), policy: value.policy as string[], taxRequired: value.taxRequired === true, ...(consent ? { consent } : {}) };
}
