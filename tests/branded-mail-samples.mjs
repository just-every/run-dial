import { build } from "esbuild";
import { hostileMailFixture } from "./fixtures/branded-mail.mjs";

async function loadModule(path) {
  const result = await build({
    entryPoints: [new URL(path, import.meta.url).pathname],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

export async function brandedMailSamples() {
  const [booking, reminders, requests, connections, layout] = await Promise.all([
    loadModule("../src/core/features/delivery/booking-mails.ts"),
    loadModule("../src/core/features/delivery/reminders.ts"),
    loadModule("../src/core/features/delivery/request-mails.ts"),
    loadModule("../src/core/features/delivery/connection-mails.ts"),
    loadModule("../src/core/features/delivery/branded-layout.ts"),
  ]);
  const f = hostileMailFixture;
  const bookingDetails = {
    hostName: f.hostName,
    eventTitle: f.eventTitle,
    startAt: f.startAt,
    endAt: f.endAt,
    durationMinutes: f.durationMinutes,
    inviteeTimezone: f.inviteeTimezone,
    hostTimezone: f.hostTimezone,
    locationType: f.locationType,
    locationLabel: f.locationLabel,
    locationValue: f.locationValue,
    meetingUrl: f.meetingUrl,
    calendarState: "pending",
  };
  const answer = [{ label: f.answerLabel, value: f.answerValue }];
  const requestDetails = {
    hostName: f.hostName,
    eventTitle: f.eventTitle,
    inviteeName: f.inviteeName,
    inviteeEmail: f.inviteeEmail,
    inviteeTimezone: f.inviteeTimezone,
    windows: f.windows,
    note: f.note,
  };
  const reminderInput = {
    title: f.eventTitle,
    hostName: f.hostName,
    durationMinutes: f.durationMinutes,
    startAt: f.startAt,
    endAt: f.endAt,
    hostTimezone: f.hostTimezone,
    inviteeTimezone: f.inviteeTimezone,
    locationType: f.locationType,
    locationValue: f.locationValue,
    locationLabel: f.locationLabel,
    meetingUrl: f.meetingUrl,
    calendarState: "succeeded",
  };
  const reminderInvitee = reminders.reminderMessage(reminderInput, { to: f.inviteeEmail, recipientRole: "invitee", manageUrl: f.manageUrl });
  const reminderOperator = reminders.reminderMessage(reminderInput, { to: "operator@dial.test", recipientRole: "operator" });
  const readyDetails = {
    ...bookingDetails,
    locationType: "google_meet",
    locationLabel: "Google Meet",
    locationValue: "",
    meetingUrl: "https://meet.google.com/aaa-bbbb-ccc",
    calendarState: "succeeded",
  };
  const confirmationInvitee = booking.bookingConfirmationMail({ ...bookingDetails, recipientRole: "invitee", inviteeName: f.inviteeName, inviteeEmail: f.inviteeEmail, answers: answer, manageUrl: f.manageUrl });
  const confirmationOperator = booking.bookingConfirmationMail({ ...bookingDetails, recipientRole: "operator", inviteeName: f.inviteeName, inviteeEmail: f.inviteeEmail, answers: answer });
  const linkReady = booking.bookingLinkReadyMail({ ...readyDetails, meetingUrl: readyDetails.meetingUrl, manageUrl: f.manageUrl });
  const reschedule = booking.bookingChangeHtml({
    ...bookingDetails,
    kind: "rescheduled",
    actor: f.inviteeName,
    previousInviteeTime: booking.formatTimeRange(f.startAt, f.endAt, f.inviteeTimezone),
    previousHostTime: booking.formatTimeRange(f.startAt, f.endAt, f.hostTimezone),
    reason: f.note,
    recipientRole: "invitee",
    inviteeName: f.inviteeName,
    inviteeEmail: f.inviteeEmail,
    manageUrl: f.manageUrl,
  });
  const rescheduleOperator = booking.bookingChangeHtml({
    ...bookingDetails,
    kind: "rescheduled",
    actor: f.inviteeName,
    previousInviteeTime: booking.formatTimeRange(f.startAt, f.endAt, f.inviteeTimezone),
    previousHostTime: booking.formatTimeRange(f.startAt, f.endAt, f.hostTimezone),
    reason: f.note,
    recipientRole: "operator",
    inviteeName: f.inviteeName,
    inviteeEmail: f.inviteeEmail,
  });
  const cancellation = booking.bookingCancellationMail({
    ...bookingDetails,
    calendarState: "pending",
    actor: "the connected calendar",
    reason: f.reason,
    recipientRole: "operator",
    inviteeName: f.inviteeName,
    inviteeEmail: f.inviteeEmail,
  });
  const cancellationInvitee = booking.bookingCancellationMail({
    ...bookingDetails,
    calendarState: "pending",
    actor: "the connected calendar",
    reason: f.reason,
    recipientRole: "invitee",
    inviteeName: f.inviteeName,
    inviteeEmail: f.inviteeEmail,
  });
  const requestInvitee = requests.requestSubmissionMail(requestDetails, "invitee");
  const requestOperator = requests.requestSubmissionMail(requestDetails, "operator");
  const requestHandled = requests.requestUpdateMail({ hostName: f.hostName, eventTitle: f.eventTitle, state: "handled" });
  const requestClosed = requests.requestUpdateMail({ hostName: f.hostName, eventTitle: f.eventTitle, state: "closed" });
  const alert = connections.connectionAlertMail("Calendar", "unhealthy", f.note);

  return {
    layout,
    fixture: f,
    texts: { requestInvitee: requestInvitee.text, requestOperator: requestOperator.text, requestHandled: requestHandled.text, requestClosed: requestClosed.text, reminderInvitee: reminderInvitee.text, reminderOperator: reminderOperator.text, linkReady: linkReady.text, confirmationInvitee: confirmationInvitee.text, confirmationOperator: confirmationOperator.text, rescheduleInvitee: reschedule.text, rescheduleOperator: rescheduleOperator.text, cancellationInvitee: cancellationInvitee.text, cancellationOperator: cancellation.text, alert: alert.text },
    samples: [
      { kind: "confirmation invitee", html: confirmationInvitee.html },
      { kind: "confirmation operator", html: confirmationOperator.html },
      { kind: "link ready", html: linkReady.html },
      { kind: "reminder invitee", html: reminderInvitee.html },
      { kind: "reminder operator", html: reminderOperator.html },
      { kind: "reschedule invitee", html: reschedule.html },
      { kind: "reschedule operator", html: rescheduleOperator.html },
      { kind: "cancellation invitee", html: cancellationInvitee.html },
      { kind: "cancellation operator", html: cancellation.html },
      { kind: "request acknowledgement invitee", html: requestInvitee.html },
      { kind: "request acknowledgement operator", html: requestOperator.html },
      { kind: "request handled update", html: requestHandled.html },
      { kind: "request closed update", html: requestClosed.html },
      { kind: "connection alert", html: alert.html },
      { kind: "connection recovery", html: connections.connectionAlertMail("Calendar", "healthy", null).html },
    ],
    source: { booking, reminders, requests, connections },
  };
}
