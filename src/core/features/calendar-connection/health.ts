import { ProviderFailure } from "../../platform/calendar";
import type { CalendarConnectionRecord } from "./repository";

export type ProviderHealth = {
  provider: "google_calendar";
  state: "healthy" | "unhealthy" | "disconnected";
  checkedAt: string | null;
  reason: string | null;
  destinationSelected: boolean;
  destinationCalendarId: string | null;
  conflictCalendarIds: string[];
  conflictCalendarCount: number;
  conferenceCapable: boolean;
};

export function connectionHealth(connection: CalendarConnectionRecord | undefined): ProviderHealth {
  const selection = connection?.selection ?? [];
  const destination = selection.find((entry) => entry.purpose === "destination");
  return {
    provider: "google_calendar",
    state: connection?.status ?? "disconnected",
    checkedAt: connection?.lastCheckedAt ?? null,
    reason: connection?.unhealthyCode ?? (connection ? null : "disconnected"),
    destinationSelected: Boolean(destination),
    destinationCalendarId: destination?.calendarId ?? null,
    conflictCalendarIds: selection.filter((entry) => entry.purpose === "conflict").map((entry) => entry.calendarId),
    conflictCalendarCount: selection.filter((entry) => entry.purpose === "conflict").length,
    conferenceCapable: destination?.conferenceCapable ?? false,
  };
}

export function failureCode(error: unknown) {
  return error instanceof ProviderFailure ? error.code : "provider_unavailable";
}
