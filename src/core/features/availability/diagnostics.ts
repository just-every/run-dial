import { evaluateSlot, hostDateForInstant, type SlotEngineInput, type SlotExclusion } from "./engine";
import { zonedParts } from "./timezone";

/** This projection contains rules only, never claim identities or provider detail. */
export function diagnoseAvailability(input: SlotEngineInput, startAt: string, now: Date) {
  const start = new Date(startAt);
  const end = new Date(start.getTime() + input.constraints.durationMinutes * 60_000);
  const parts = zonedParts(start, input.hostTimeZone);
  const hostDate = hostDateForInstant(start.toISOString(), input.hostTimeZone);
  const evaluation = evaluateSlot(input, hostDate, parts.hour * 60 + parts.minute, start, end, now);
  return { startAt: start.toISOString(), endAt: end.toISOString(), hostDate, hostTimezone: input.hostTimeZone, ...evaluation };
}

const labels: Partial<Record<SlotExclusion, string>> = {
  schedule: "outside the event’s scheduled windows",
  date_override: "excluded by this date’s availability override",
  start_increment: "not aligned to the event’s start increment",
  minimum_notice: "before the event’s minimum notice",
  horizon: "beyond the event’s booking horizon",
  buffer: "overlaps required time buffers",
  host_day_limit: "the host-day booking limit is reached",
  dial_booking: "overlaps an existing Dial booking",
  calendar_busy: "overlaps conflict-calendar busy time",
};
export function unavailableTimeMessage(exclusions: SlotExclusion[]) {
  return `That time is unavailable: ${exclusions.map((rule) => labels[rule] ?? (rule === "invitee_gap" ? "the minimum gap for this invitee is not met" : `the ${rule.replaceAll("_", " ")} limit would be exceeded`)).join("; ")}.`;
}
