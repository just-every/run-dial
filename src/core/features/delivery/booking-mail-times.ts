import type { BrandedMailFact } from "./branded-layout";

type BookingMailTimes = {
  startAt: string;
  endAt: string;
  inviteeTimezone: string;
  hostTimezone: string;
  lockedTimezone?: string;
  browserTimezone?: string | null;
};

export function formatTimeRange(startAt: string, endAt: string, timeZone: string, numericUtcOffset = false) {
  const formatter = new Intl.DateTimeFormat("en-US", {
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

export function bookingTimeFacts(input: BookingMailTimes, prefix = ""): BrandedMailFact[] {
  if (input.lockedTimezone) {
    return [
      { label: prefix ? `${prefix} time` : "Time", value: formatTimeRange(input.startAt, input.endAt, input.lockedTimezone, true) },
      ...(input.browserTimezone && input.browserTimezone !== input.lockedTimezone
        ? [{ label: prefix ? `${prefix} browser time` : "Browser time", value: formatTimeRange(input.startAt, input.endAt, input.browserTimezone, true) }]
        : input.browserTimezone ? [] : [{ label: "Invitee browser zone", value: "Zone not provided by invitee" }]),
    ];
  }
  return [
    { label: prefix ? `${prefix} invitee time` : "Invitee time", value: formatTimeRange(input.startAt, input.endAt, input.inviteeTimezone) },
    { label: prefix ? `${prefix} host time` : "Host time", value: formatTimeRange(input.startAt, input.endAt, input.hostTimezone) },
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
