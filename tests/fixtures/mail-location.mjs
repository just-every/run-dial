export const locationMail = {
  hostName: 'Host <studio> & "team"',
  eventTitle: 'Session <review> & "notes"',
  startAt: "2026-10-20T09:00:00.000Z",
  endAt: "2026-10-20T10:00:00.000Z",
  durationMinutes: 60,
  inviteeTimezone: "UTC",
  hostTimezone: "UTC",
  locationType: "fixed_link",
  locationLabel: 'Room <one> & "two"',
  locationValue: "https://session.example.test/room",
  meetingUrl: null,
  calendarState: "pending",
  inviteeName: 'Guest <three> & "four"',
  inviteeEmail: "location-mail@dial.test",
  manageUrl: "https://dial.example.test/manage/location-mail-fixture",
  answers: [{ label: "Agenda <five>", value: 'Review & "six"' }],
  actor: "the invitee",
  previousInviteeTime: "Oct 19, 2026, 9:00 AM GMT–Oct 19, 2026, 10:00 AM GMT (UTC)",
  previousHostTime: "Oct 19, 2026, 9:00 AM GMT–Oct 19, 2026, 10:00 AM GMT (UTC)",
  reason: "deleted_in_google_calendar",
};

export const unsafeLocations = [
  "javascript:alert('synthetic')",
  "zoommtg://synthetic.example.test/session",
  "JaVaScRiPt:alert('<img src=x onerror=alert(1)> & \"quoted\"')",
  "data:text/html,<svg onload=alert(1)>",
  "mailto:session@example.test",
  "ftp://session.example.test/room",
  "/relative/session",
  "not an absolute URL <script>alert(1)</script>",
  "https://user:password@session.example.test/room",
  "https://session.example.test/\nroom",
  "https://session.example.test/\u007froom",
];

const f = locationMail;
const calendarUrl = "https://dial.example.test/api/public/manage/location-mail-fixture/calendar.ics";
const actions = `Manage this booking: ${f.manageUrl}\nAdd to calendar: ${calendarUrl}`;
const invitee = `Invitee: ${f.inviteeName} <${f.inviteeEmail}>`;

// Fixed expected copy keeps text-byte preservation independent of the HTML composers.
export function expectedLocationText(kind, role, location, utcOffset = "GMT+0") {
  const range = `Oct 20, 2026, 9:00 AM ${utcOffset}–Oct 20, 2026, 10:00 AM ${utcOffset} (UTC)`;
  if (kind === "confirmation") {
    const summary = `${f.eventTitle} with ${f.hostName}\nInvitee time: ${range}\nHost time: ${range}\nDuration: 60 minutes\nLocation: ${f.locationLabel}: ${location}\nCalendar setup: pending.\n\nAnswers:\nAgenda <five>: Review & "six"`;
    return role === "invitee" ? `${summary}\n\nJoin session: ${location}\n\n${actions}` : `${summary}\n\n${invitee}\n\nJoin session: ${location}`;
  }
  if (kind === "reschedule") return `${f.eventTitle} with ${f.hostName} was rescheduled by the invitee.\nPrevious invitee time: ${f.previousInviteeTime}\nPrevious host time: ${f.previousHostTime}\nNew invitee time: ${range}\nNew host time: ${range}\nReason: deleted_in_google_calendar\nCalendar state: pending.\nDuration: 60 minutes\n${f.locationLabel}: ${location}\nJoin session: ${location}\n${role === "invitee" ? actions : invitee}`;
  if (kind === "reminder") return `${f.eventTitle}\nTuesday, 20 October 2026 at 09:00:00 UTC – Tuesday, 20 October 2026 at 10:00:00 UTC (UTC)\n${f.locationLabel}: ${location}${role === "invitee" ? `\nManage this booking: ${f.manageUrl}` : ""}\n\nHost: ${f.hostName}\nDuration: 60 minutes\nCalendar setup: pending.\nJoin session: ${location}${role === "invitee" ? `\nAdd to calendar: ${calendarUrl}` : ""}`;
  if (kind === "cancellation") return `Booking cancelled by the invitee.\nEvent: ${f.eventTitle}\nHost: ${f.hostName}\nPrevious invitee time: ${range}\nPrevious host time: ${range}\nDuration: 60 minutes\nLocation: ${f.locationLabel}: ${location}\nReason: deleted_in_google_calendar.\nCalendar state: pending.${role === "operator" ? `\n${invitee}` : ""}`;
  if (kind === "link-ready") return `Your meeting link is ready: ${location}\n\nEvent: ${f.eventTitle}\nHost: ${f.hostName}\nInvitee time: ${range}\nHost time: ${range}\nDuration: 60 minutes\nLocation: ${f.locationLabel}: ${location}\nCalendar setup: pending.\nJoin session: ${location}\n${actions}`;
  throw new Error("Unknown expected mail kind");
}
