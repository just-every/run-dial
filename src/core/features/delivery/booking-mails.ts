import { inviteeCalendarUrl, renderBrandedMail, type BrandedMailAction, type BrandedMailFact } from "./branded-layout";
import { mailJoinActions } from "./mail-action-url";

export type BookingMailDetails = {
  hostName: string;
  eventTitle: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  inviteeTimezone: string;
  hostTimezone: string;
  locationType: string;
  locationLabel: string;
  locationValue: string;
  meetingUrl?: string | null;
  calendarState: string;
};

export type BookingCancellationTemplate = {
  kind: "booking-cancellation";
  hostName: string;
  actor: string;
  reason?: string;
};

export function bookingConfirmationMail(input: BookingMailDetails & {
  recipientRole: "invitee" | "operator";
  inviteeName: string;
  inviteeEmail: string;
  manageUrl?: string;
  answers: Array<{ label: string; value: string }>;
}) {
  if (input.recipientRole === "invitee" && !input.manageUrl) throw new TypeError("Invitee confirmation requires its manage capability");
  const location = locationText(input);
  const facts: BrandedMailFact[] = [
    { label: "Event", value: input.eventTitle },
    { label: "Invitee time", value: formatTimeRange(input.startAt, input.endAt, input.inviteeTimezone) },
    { label: "Host time", value: formatTimeRange(input.startAt, input.endAt, input.hostTimezone) },
    { label: "Duration", value: `${input.durationMinutes} minutes` },
    { label: "Location", value: `${input.locationLabel}: ${location}` },
    { label: "Calendar setup", value: input.calendarState },
    ...input.answers.map(({ label, value }) => ({ label, value })),
  ];
  if (input.recipientRole === "operator") facts.push({ label: "Invitee", value: `${input.inviteeName} <${input.inviteeEmail}>` });
  const actions = joinAction(input);
  if (input.recipientRole === "invitee" && input.manageUrl) {
    actions.push({ label: "Manage booking", href: input.manageUrl });
    actions.push({ label: "Add to calendar", href: inviteeCalendarUrl(input.manageUrl) });
  }
  const answerText = input.answers.length ? `\n\nAnswers:\n${input.answers.map(({ label, value }) => `${label}: ${value}`).join("\n")}` : "";
  const joinText = bookingJoinUrl(input) ? `\n\nJoin session: ${bookingJoinUrl(input)}` : "";
  const summary = `${input.eventTitle} with ${input.hostName}\nInvitee time: ${formatTimeRange(input.startAt, input.endAt, input.inviteeTimezone)}\nHost time: ${formatTimeRange(input.startAt, input.endAt, input.hostTimezone)}\nDuration: ${input.durationMinutes} minutes\nLocation: ${input.locationLabel}: ${location}\nCalendar setup: ${input.calendarState}.`;
  const text = input.recipientRole === "invitee"
    ? `${summary}${answerText}${joinText}\n\nManage this booking: ${input.manageUrl}\nAdd to calendar: ${input.manageUrl ? inviteeCalendarUrl(input.manageUrl) : ""}`
    : `${summary}${answerText}\n\nInvitee: ${input.inviteeName} <${input.inviteeEmail}>${joinText}`;
  const html = renderBrandedMail({
    businessName: input.hostName,
    heading: input.eventTitle,
    intro: input.recipientRole === "invitee" ? "Your booking is confirmed." : "A new booking is confirmed.",
    facts,
    actions,
  });
  return { text, html };
}

export function bookingLinkReadyMail(input: BookingMailDetails & { manageUrl: string; meetingUrl: string }) {
  const text = [
    `Your meeting link is ready: ${input.meetingUrl}`,
    "",
    `Event: ${input.eventTitle}`,
    `Host: ${input.hostName}`,
    `Invitee time: ${formatTimeRange(input.startAt, input.endAt, input.inviteeTimezone)}`,
    `Host time: ${formatTimeRange(input.startAt, input.endAt, input.hostTimezone)}`,
    `Duration: ${input.durationMinutes} minutes`,
    `Location: ${input.locationLabel}: ${input.meetingUrl}`,
    `Calendar setup: ${input.calendarState}.`,
    `Join session: ${input.meetingUrl}`,
    `Manage this booking: ${input.manageUrl}`,
    `Add to calendar: ${inviteeCalendarUrl(input.manageUrl)}`,
  ].join("\n");
  const html = renderBrandedMail({
    businessName: input.hostName,
    heading: "Your meeting link is ready",
    intro: "Join the confirmed booking using the meeting link below.",
    facts: [
      { label: "Event", value: input.eventTitle },
      { label: "Invitee time", value: formatTimeRange(input.startAt, input.endAt, input.inviteeTimezone) },
      { label: "Host time", value: formatTimeRange(input.startAt, input.endAt, input.hostTimezone) },
      { label: "Duration", value: `${input.durationMinutes} minutes` },
      { label: "Location", value: `${input.locationLabel}: ${input.meetingUrl}` },
      { label: "Calendar setup", value: input.calendarState },
    ],
    actions: [
      ...mailJoinActions(input.meetingUrl),
      { label: "Manage booking", href: input.manageUrl },
      { label: "Add to calendar", href: inviteeCalendarUrl(input.manageUrl) },
    ],
  });
  return { text, html };
}

export function bookingReminderHtml(input: BookingMailDetails & {
  recipientRole: "invitee" | "operator";
  timeRange: string;
  location: string;
  manageUrl?: string;
}) {
  const actions = joinAction(input);
  if (input.recipientRole === "invitee" && input.manageUrl) {
    actions.push({ label: "Manage booking", href: input.manageUrl });
    actions.push({ label: "Add to calendar", href: inviteeCalendarUrl(input.manageUrl) });
  }
  return renderBrandedMail({
    businessName: input.hostName,
    heading: input.eventTitle,
    intro: "Booking reminder",
    facts: [
      { label: "Host", value: input.hostName },
      { label: `Time (${input.recipientRole === "invitee" ? input.inviteeTimezone : input.hostTimezone})`, value: input.timeRange },
      { label: "Duration", value: `${input.durationMinutes} minutes` },
      { label: input.locationLabel, value: input.location },
      { label: "Calendar setup", value: input.calendarState },
    ],
    actions,
  });
}

export function bookingChangeHtml(input: BookingMailDetails & {
  actor: string;
  previousInviteeTime: string;
  previousHostTime: string;
  reason?: string;
  recipientRole: "invitee" | "operator";
  inviteeName: string;
  inviteeEmail: string;
  manageUrl?: string;
}) {
  const facts: BrandedMailFact[] = [
    { label: "Event", value: input.eventTitle },
    { label: "Previous invitee time", value: input.previousInviteeTime },
    { label: "Previous host time", value: input.previousHostTime },
    { label: "New invitee time", value: formatTimeRange(input.startAt, input.endAt, input.inviteeTimezone) },
    { label: "New host time", value: formatTimeRange(input.startAt, input.endAt, input.hostTimezone) },
    { label: "Duration", value: `${input.durationMinutes} minutes` },
    { label: input.locationLabel, value: locationText(input) },
  ];
  if (input.reason) facts.push({ label: "Reason", value: input.reason });
  facts.push({ label: "Calendar state", value: input.calendarState });
  if (input.recipientRole === "operator") facts.push({ label: "Invitee", value: `${input.inviteeName} <${input.inviteeEmail}>` });
  const actions = joinAction(input);
  if (input.recipientRole === "invitee" && input.manageUrl) {
    actions.push({ label: "Manage booking", href: input.manageUrl });
    actions.push({ label: "Add to calendar", href: inviteeCalendarUrl(input.manageUrl) });
  }
  const text = [
    `${input.eventTitle} with ${input.hostName} was rescheduled by ${input.actor}.`,
    `Previous invitee time: ${input.previousInviteeTime}`,
    `Previous host time: ${input.previousHostTime}`,
    `New invitee time: ${formatTimeRange(input.startAt, input.endAt, input.inviteeTimezone)}`,
    `New host time: ${formatTimeRange(input.startAt, input.endAt, input.hostTimezone)}`,
    ...(input.reason ? [`Reason: ${input.reason}`] : []),
    `Calendar state: ${input.calendarState}.`,
    `Duration: ${input.durationMinutes} minutes`,
    `${input.locationLabel}: ${locationText(input)}`,
    ...(bookingJoinUrl(input) ? [`Join session: ${bookingJoinUrl(input)}`] : []),
    ...(input.recipientRole === "operator" ? [`Invitee: ${input.inviteeName} <${input.inviteeEmail}>`] : []),
    ...(input.recipientRole === "invitee" && input.manageUrl ? [`Manage this booking: ${input.manageUrl}`, `Add to calendar: ${inviteeCalendarUrl(input.manageUrl)}`] : []),
  ].join("\n");
  const html = renderBrandedMail({
    businessName: input.hostName,
    heading: "Booking rescheduled",
    intro: `Booking rescheduled by ${input.actor}.`,
    facts,
    actions,
  });
  return { text, html };
}

export function bookingCancellationMail(input: BookingMailDetails & {
  actor: string;
  reason?: string;
  recipientRole: "invitee" | "operator";
  inviteeName: string;
  inviteeEmail: string;
}) {
  const reasonLine = `Reason: ${input.reason?.trim() || "No reason provided"}.`;
  const previousInviteeTime = formatTimeRange(input.startAt, input.endAt, input.inviteeTimezone);
  const previousHostTime = formatTimeRange(input.startAt, input.endAt, input.hostTimezone);
  const location = locationText(input);
  const facts: BrandedMailFact[] = [
    { label: "Event", value: input.eventTitle },
    { label: "Previous invitee time", value: previousInviteeTime },
    { label: "Previous host time", value: previousHostTime },
    { label: "Duration", value: `${input.durationMinutes} minutes` },
    { label: "Location", value: `${input.locationLabel}: ${location}` },
    { label: "Calendar state", value: input.calendarState },
  ];
  if (input.recipientRole === "operator") facts.push({ label: "Invitee", value: `${input.inviteeName} <${input.inviteeEmail}>` });
  const text = [
    `Booking cancelled by ${input.actor}.`,
    `Event: ${input.eventTitle}`,
    `Host: ${input.hostName}`,
    `Previous invitee time: ${previousInviteeTime}`,
    `Previous host time: ${previousHostTime}`,
    `Duration: ${input.durationMinutes} minutes`,
    `Location: ${input.locationLabel}: ${location}`,
    reasonLine,
    `Calendar state: ${input.calendarState}.`,
    ...(input.recipientRole === "operator" ? [`Invitee: ${input.inviteeName} <${input.inviteeEmail}>`] : []),
  ].join("\n");
  const html = renderBrandedMail({
    businessName: input.hostName,
    heading: "Booking cancelled",
    intro: `Booking cancelled by ${input.actor}.`,
    paragraphs: [reasonLine],
    facts,
  });
  return { subject: `Booking cancelled: ${input.eventTitle}`, text, html };
}

export function bookingJoinUrl(input: Pick<BookingMailDetails, "locationType" | "locationValue" | "meetingUrl">) {
  return input.locationType === "google_meet" ? input.meetingUrl ?? undefined
    : input.locationType === "fixed_link" ? input.locationValue : undefined;
}

export function formatTimeRange(startAt: string, endAt: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "shortOffset" });
  return `${formatter.format(new Date(startAt))}–${formatter.format(new Date(endAt))} (${timeZone})`;
}

function joinAction(input: BookingMailDetails): BrandedMailAction[] {
  return mailJoinActions(bookingJoinUrl(input));
}

function locationText(input: BookingMailDetails) {
  if (input.locationType === "google_meet") return input.meetingUrl ?? "Google Meet link pending";
  return input.locationValue;
}
