import { spanishConfirmation, type ConfirmationLanguage } from "../locales";
import type { BrandedMailFact } from "./branded-layout";

type BookingMailTimes = {
  startAt: string;
  endAt: string;
  inviteeTimezone: string;
  hostTimezone: string;
  lockedTimezone?: string;
  browserTimezone?: string | null;
};

export function formatTimeRange(startAt: string, endAt: string, timeZone: string, numericUtcOffset = false, language: ConfirmationLanguage = "en") {
  const formatter = new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", {
    hour12: true,
    timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZoneName: numericUtcOffset ? "longOffset" : "shortOffset",
  });
  const format = (instant: string) => numericUtcOffset
    ? formatter.formatToParts(new Date(instant)).map(part => part.type === "timeZoneName"
      ? part.value === "GMT" ? "UTC+00:00" : part.value.replace("GMT", "UTC")
      : part.value).join("")
    : formatter.format(new Date(instant));
  return `${format(startAt)}–${format(endAt)} (${timeZone})`;
}

export function bookingTimeFacts(input: BookingMailTimes, prefix = "", language: ConfirmationLanguage = "en"): BrandedMailFact[] {
  const labels = language === "es" ? spanishConfirmation : { time: "Time", browserTime: "Browser time", browserZone: "Invitee browser zone", missingZone: "Zone not provided by invitee", inviteeTime: "Invitee time", hostTime: "Host time" };
  if (input.lockedTimezone) {
    return [
      { label: prefix ? `${prefix} time` : labels.time, value: formatTimeRange(input.startAt, input.endAt, input.lockedTimezone, true, language) },
      ...(input.browserTimezone && input.browserTimezone !== input.lockedTimezone
        ? [{ label: prefix ? `${prefix} browser time` : labels.browserTime, value: formatTimeRange(input.startAt, input.endAt, input.browserTimezone, true, language) }]
        : input.browserTimezone ? [] : [{ label: labels.browserZone, value: labels.missingZone }]),
    ];
  }
  return [
    { label: prefix ? `${prefix} invitee time` : labels.inviteeTime, value: formatTimeRange(input.startAt, input.endAt, input.inviteeTimezone, false, language) },
    { label: prefix ? `${prefix} host time` : labels.hostTime, value: formatTimeRange(input.startAt, input.endAt, input.hostTimezone, false, language) },
  ];
}

export function previousBookingTimeFacts(input: {
  lockedTimezone?: string;
  previousLockedTime?: string;
  previousInviteeTime: string;
  previousHostTime: string;
}): BrandedMailFact[] {
  if (input.lockedTimezone) {
    if (!input.previousLockedTime) throw new TypeError("Locked reschedule mail requires its previous locked time");
    return [{ label: "Previous time", value: input.previousLockedTime }];
  }
  return [
    { label: "Previous invitee time", value: input.previousInviteeTime },
    { label: "Previous host time", value: input.previousHostTime },
  ];
}

export function timeFactsText(facts: BrandedMailFact[]) {
  return facts.map(({ label, value }) => `${label}: ${value}`).join("\n");
}
