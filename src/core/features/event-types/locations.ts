import { normalizePhoneNumber } from "../../shared/phone";
import type { EventTypeRecord } from "./repository";

export const locationTypes = ["google_meet", "microsoft_teams", "fixed_link", "phone", "invitee_phone", "in_person", "ask_invitee", "custom"] as const;
export type EventLocationType = typeof locationTypes[number];
export type EventLocationOption = { id: string; type: EventLocationType; label: string; value: string; prompt?: string };
export type PublicLocationOption = { key: string; label: string; input?: "phone" | "place"; prompt?: string };
type LocationSource = { locationType: EventLocationType; locationLabel: string; locationValue: string; locations?: EventLocationOption[] };

/** Older event records have a single primary location; their stable key survives edits. */
export function offeredLocations(event: LocationSource): EventLocationOption[] {
  return event.locations ?? [{ id: "default", type: event.locationType, label: event.locationLabel, value: event.locationValue }];
}
export function publicLocations(event: LocationSource): PublicLocationOption[] {
  return offeredLocations(event).map(({ id, type, label, prompt }) => ({ key: id, label,
    ...(type === "invitee_phone" ? { input: "phone" as const, prompt: prompt || "Phone number the host should call" } : {}),
    ...(type === "ask_invitee" ? { input: "place" as const, prompt } : {}),
  }));
}
export function locationIssue(location: EventLocationOption): string | undefined {
  if (!location.label.trim()) return "Give this location a public label.";
  if (location.type === "google_meet" || location.type === "microsoft_teams" || location.type === "invitee_phone") return undefined;
  if (location.type === "ask_invitee") return location.prompt?.trim() ? undefined : "Write the question invitees must answer for this location.";
  // Receipts, mail and calendars link only safe web URLs; any other fixed value is delivered as text.
  if (!location.value.trim()) return "This location needs its private value.";
  return undefined;
}
export function resolveBookingLocation(event: EventTypeRecord, input: { locationId?: string; locationInput?: string }): EventTypeRecord | undefined {
  const options = offeredLocations(event);
  const selected = input.locationId ? options.find(location => location.id === input.locationId) : options.length === 1 ? options[0] : undefined;
  if (!selected || locationIssue(selected)) return undefined;
  let value = selected.type === "microsoft_teams" ? "Microsoft Teams" : selected.value.trim();
  if (selected.type === "invitee_phone") {
    const phone = normalizePhoneNumber(input.locationInput ?? "");
    if (!phone) return undefined;
    value = phone;
  } else if (selected.type === "ask_invitee") {
    value = input.locationInput?.trim() ?? "";
    if (!value || value.length > 1000) return undefined;
  } else if (input.locationInput?.trim()) return undefined;
  return { ...event, locationType: selected.type, locationLabel: selected.label, locationValue: value };
}
