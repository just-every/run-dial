import { calendarStatus } from "../../shared/booking-status";
import { inviteeCalendarUrl, renderBrandedMail, type BrandedMailAction, type BrandedMailFact } from "./branded-layout";
import { mailJoinActions } from "./mail-action-url";
import { bookingTimeFacts, previousBookingTimeFacts, timeFactsText } from "./booking-mail-times";
export { formatTimeRange } from "./booking-mail-times";

export type BookingMailDetails = {
  hostName: string;
  eventTitle: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  inviteeTimezone: string;
  hostTimezone: string;
  lockedTimezone?: string;
  browserTimezone?: string | null;
  locationType: string;
  locationLabel: string;
  locationValue: string;
  meetingUrl?: string | null;
  calendarState: string;
  meetingState?: string;
  /** PAY-001: the amount paid through Stripe and its reference. */
  payment?: { amount: string; reference: string };
};

/** Until PAY-003 ships, Dial issues no refund for a cancelled or moved paid booking. */
export const paidChangeRefundNote = "No refund is issued by Dial. The host refunds payments in Stripe.";
const paymentFacts = (input: BookingMailDetails): BrandedMailFact[] => input.payment ? [{ label: "Payment", value: `${input.payment.amount} paid · Stripe reference ${input.payment.reference}` }] : [];
const paymentText = (input: BookingMailDetails) => input.payment ? `\nPayment: ${input.payment.amount} paid · Stripe reference ${input.payment.reference}` : "";
const refundFacts = (input: BookingMailDetails): BrandedMailFact[] => input.payment ? [...paymentFacts(input), { label: "Refunds", value: paidChangeRefundNote }] : [];
const refundLines = (input: BookingMailDetails) => input.payment ? [`Payment: ${input.payment.amount} paid · Stripe reference ${input.payment.reference}`, paidChangeRefundNote] : [];

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
  const timeFacts = bookingTimeFacts(input);
  const facts: BrandedMailFact[] = [
    { label: "Event", value: input.eventTitle },
    ...timeFacts,
    { label: "Duration", value: `${input.durationMinutes} minutes` },
    ...paymentFacts(input),
    { label: "Location", value: `${bookingLocationLabel(input)}: ${location}` },
    ...(input.recipientRole === "operator" ? [{ label: "Calendar setup", value: calendarStatus(input.calendarState) }] : []),
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
  const summary = `${input.eventTitle} with ${input.hostName}\n${timeFactsText(timeFacts)}\nDuration: ${input.durationMinutes} minutes${paymentText(input)}\nLocation: ${bookingLocationLabel(input)}: ${location}${input.recipientRole === "operator" ? `\nCalendar setup: ${calendarStatus(input.calendarState)}.` : ""}`;
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
  const timeFacts = bookingTimeFacts(input);
  const text = [
    `Your meeting link is ready: ${input.meetingUrl}`,
    "",
    `Event: ${input.eventTitle}`,
    `Host: ${input.hostName}`,
    timeFactsText(timeFacts),
    `Duration: ${input.durationMinutes} minutes`,
    `Location: ${bookingLocationLabel(input)}: ${input.meetingUrl}`,
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
      ...timeFacts,
      { label: "Duration", value: `${input.durationMinutes} minutes` },
      { label: "Location", value: `${bookingLocationLabel(input)}: ${input.meetingUrl}` },
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
      { label: `Time (${input.lockedTimezone ?? (input.recipientRole === "invitee" ? input.inviteeTimezone : input.hostTimezone)})`, value: input.timeRange },
      { label: "Duration", value: `${input.durationMinutes} minutes` },
      { label: bookingLocationLabel(input), value: input.location },
      ...(input.recipientRole === "operator" ? [{ label: "Calendar setup", value: calendarStatus(input.calendarState) }] : []),
    ],
    actions,
  });
}

export function bookingChangeHtml(input: BookingMailDetails & {
  actor: string;
  previousInviteeTime: string;
  previousHostTime: string;
  previousLockedTime?: string;
  reason?: string;
  recipientRole: "invitee" | "operator";
  inviteeName: string;
  inviteeEmail: string;
  manageUrl?: string;
}) {
  const timeFacts = [...previousBookingTimeFacts(input), ...bookingTimeFacts(input, "New")];
  const facts: BrandedMailFact[] = [
    { label: "Event", value: input.eventTitle },
    ...timeFacts,
    { label: "Duration", value: `${input.durationMinutes} minutes` },
    { label: bookingLocationLabel(input), value: locationText(input) },
    ...refundFacts(input),
  ];
  if (input.reason) facts.push({ label: "Reason", value: input.reason });
  if (input.recipientRole === "operator") facts.push({ label: "Calendar state", value: calendarStatus(input.calendarState) });
  if (input.recipientRole === "operator") facts.push({ label: "Invitee", value: `${input.inviteeName} <${input.inviteeEmail}>` });
  const actions = joinAction(input);
  if (input.recipientRole === "invitee" && input.manageUrl) {
    actions.push({ label: "Manage booking", href: input.manageUrl });
    actions.push({ label: "Add to calendar", href: inviteeCalendarUrl(input.manageUrl) });
  }
  const text = [
    `${input.eventTitle} with ${input.hostName} was rescheduled by ${input.actor}.`,
    timeFactsText(timeFacts),
    ...(input.reason ? [`Reason: ${input.reason}`] : []),
    ...(input.recipientRole === "operator" ? [`Calendar state: ${calendarStatus(input.calendarState)}.`] : []),
    `Duration: ${input.durationMinutes} minutes`,
    `${bookingLocationLabel(input)}: ${locationText(input)}`,
    ...refundLines(input),
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
  const timeFacts = bookingTimeFacts(input, "Previous");
  const location = locationText(input);
  const facts: BrandedMailFact[] = [
    { label: "Event", value: input.eventTitle },
    ...timeFacts,
    { label: "Duration", value: `${input.durationMinutes} minutes` },
    { label: "Location", value: `${bookingLocationLabel(input)}: ${location}` },
    ...refundFacts(input),
    ...(input.recipientRole === "operator" ? [{ label: "Calendar state", value: calendarStatus(input.calendarState) }] : []),
  ];
  if (input.recipientRole === "operator") facts.push({ label: "Invitee", value: `${input.inviteeName} <${input.inviteeEmail}>` });
  const text = [
    `Booking cancelled by ${input.actor}.`,
    `Event: ${input.eventTitle}`,
    `Host: ${input.hostName}`,
    timeFactsText(timeFacts),
    `Duration: ${input.durationMinutes} minutes`,
    `Location: ${bookingLocationLabel(input)}: ${location}`,
    ...refundLines(input),
    reasonLine,
    ...(input.recipientRole === "operator" ? [`Calendar state: ${calendarStatus(input.calendarState)}.`] : []),
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

function joinAction(input: BookingMailDetails): BrandedMailAction[] {
  return mailJoinActions(bookingJoinUrl(input));
}

export function bookingLocationLabel(input: Pick<BookingMailDetails, "locationLabel" | "locationType" | "locationValue" | "meetingUrl">) {
  return bookingJoinUrl(input) ? input.locationLabel.replace(/\s*\(link on confirmation\)/giu, "").trim() : input.locationLabel;
}

function locationText(input: BookingMailDetails) {
  if (input.locationType === "google_meet") return input.meetingUrl ?? (input.meetingState === "failed" || input.calendarState === "failed" ? "Meeting link unavailable — contact the host." : "Google Meet link pending");
  return input.locationValue;
}
