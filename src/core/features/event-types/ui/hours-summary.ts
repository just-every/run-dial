import type { HoursRead } from "../../availability";
import { hoursSummary as windowsSummary } from "../../../shared/hours-label";
import type { EventTypeRecord } from "../repository";

export function hoursSummary(event: EventTypeRecord, hours?: HoursRead | null) {
  if (hours === undefined) return "";
  if (hours === null) return "Hours could not be loaded";
  const uses = hours.events.find(item => item.id === event.id)?.uses;
  if (uses === "yours") return `Your hours · ${windowsSummary(hours.yours?.windows ?? [])}`;
  if (uses && uses !== "own") return hours.others.find(item => item.id === uses)?.name ?? "Hours unavailable";
  return `Its own hours · ${windowsSummary(event.availability)}`;
}
