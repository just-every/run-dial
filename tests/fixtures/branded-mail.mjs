const repeatedTitle = "Appointment " + "very-long-title-".repeat(220);

export const hostileMailFixture = {
  hostName: `مريم's "<img src=x onerror=alert(1)> & Co`,
  eventTitle: `${repeatedTitle}<svg onload=alert(1)> "quoted" & سلام`,
  inviteeName: `שלום " onmouseover="alert(1) <script>alert(1)</script>`,
  inviteeEmail: "invitee@dial.test",
  inviteeTimezone: "America/New_York",
  hostTimezone: "Australia/Brisbane",
  startAt: "2026-10-12T23:00:00.000Z",
  endAt: "2026-10-13T00:00:00.000Z",
  durationMinutes: 60,
  locationType: "fixed_link",
  locationLabel: `Room " onfocus="alert(1)`,
  locationValue: "https://meet.example.test/join?next=%22%20onmouseover%3Dalert(1)",
  meetingUrl: null,
  manageUrl: "https://dial.example.test/manage/capability-fixture",
  answerLabel: `Agenda " onmouseover="alert(1)`,
  answerValue: `</td><script>alert(1)</script> & <b>not markup</b>`,
  note: `</td><img src=x onerror=alert(1)> "RTL שלום`,
  reason: "deleted_in_google_calendar",
  windows: [{ date: "2026-10-20", startMinute: 570, endMinute: 630 }],
};
