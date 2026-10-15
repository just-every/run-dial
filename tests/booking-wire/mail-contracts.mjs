import assert from "node:assert/strict";

export const wireMail = snapshot => snapshot.wire_calls.filter(row => new URL(row.url).pathname === "/v3/mail/send").map(row => JSON.parse(row.body));
export function bookingMail(snapshot, bookingId) {
  assert.ok(bookingId, "wire mail selection requires the persisted booking identity");
  const deliveries = new Set(snapshot.delivery_outbox.filter(row => row.booking_id === bookingId && row.kind === "mail_send")
    .map(row => JSON.parse(row.payload_json).providerIdempotencyKey ?? row.idempotency_key));
  return wireMail(snapshot).filter(mail => deliveries.has(mail.custom_args?.rer_delivery_id));
}
export const recipient = mail => mail.personalizations.flatMap(item => item.to.map(to => to.email));
export const textBody = mail => mail.content.find(part => part.type === "text/plain").value;
export const htmlBody = mail => {
  const part = mail.content.find(item => item.type === "text/html");
  assert.ok(part, "Dial mail carries an HTML alternative beside its text part");
  return part.value;
};
export const instant = value => new Date(value).toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "") + "Z";
export function timeRange(startAt, endAt, zone) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "shortOffset" });
  return `${format.format(new Date(startAt))}–${format.format(new Date(endAt))} (${zone})`;
}
// ICU may spell a zero UTC offset GMT, GMT+0 or UTC. Only the offset
// token varies: the complete date, start/end, minutes and IANA zone stay exact.
export function assertTimeRange(body, html, range, prefix = "", atStart = false, suffix = "") {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const offsets = /\b(?:GMT(?:[+-]0+(?::00)?)?|UTC)(?=–| –| \()/gu;
  const pattern = range.split(offsets).map(escape).join("(?:GMT(?:[+-]0+(?::00)?)?|UTC)");
  const match = new RegExp(`${atStart ? "^" : ""}${escape(prefix)}(${pattern})${escape(suffix)}`, "u").exec(body);
  assert.ok(match, "plain-text mail contains the exact occurrence range and zone");
  assert.ok(html.includes(match[1]), "HTML mail contains the identical plain-text occurrence range");
}
export function assertActionParity(body, html) {
  const htmlLinks = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/giu)].map(match => match[1].replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'"));
  for (const href of htmlLinks) assert.ok(body.includes(href), "text/plain contains each HTML action URL");
  const actionLinks = [...body.matchAll(/^(?:Join session|Manage this booking|Add to calendar): (https?:\/\/\S+)$/gmu)].map(match => match[1]);
  for (const href of actionLinks) assert.ok(html.includes(`href="${href.replaceAll("&", "&amp;")}"`), "text/html contains each plain-text action URL");
}
export function assertConfirmation(snapshot, receipt, email) {
  const sends = wireMail(snapshot), matches = sends.filter(mail => /^(Confirmed|New booking):/.test(mail.subject) && (recipient(mail).includes(email) || textBody(mail).includes(`<${email}>`)));
  assert.equal(matches.length, 2, "one confirmation to invitee and one to owner");
  assert.deepEqual(matches.flatMap(recipient).sort(), [email, "operator@dial.test"].sort());
  for (const mail of matches) {
    const body = textBody(mail);
    const html = htmlBody(mail);
    assertActionParity(body, html);
    assert.equal(mail.from.email, "no-reply@dial.test");
    assert.equal(mail.subject, recipient(mail).includes(email) ? `Confirmed: ${receipt.event.eventTitle}` : `New booking: ${receipt.event.eventTitle}`);
    assert.match(body, /A focused introduction with Morgan Bell/);
    assertTimeRange(body, html, timeRange(receipt.occurrence.startAt, receipt.occurrence.endAt, "UTC"));
    assertTimeRange(body, html, timeRange(receipt.occurrence.startAt, receipt.occurrence.endAt, "Australia/Brisbane"));
    assert.match(body, /Duration: 30 minutes/); assert.match(body, /What would you like to discuss\?: Wire lifecycle/);
    assert.match(body, /Google Meet link pending/);
    assert.equal(/Calendar (?:setup|state):/.test(body), !recipient(mail).includes(email));
    if (!recipient(mail).includes(email)) assert.match(body, /Calendar setup: Update pending/);
    assert.match(html, /<table\b/); assert.match(html, /style="/);
    assert.ok(html.includes("A focused introduction")); assert.ok(html.includes("Morgan Bell"));
    assert.ok(html.includes("Australia/Brisbane"));
    assert.ok(html.includes("30 minutes")); assert.ok(html.includes("Wire lifecycle"));
    assert.ok(html.includes("Google Meet link pending")); assert.ok(html.includes("pending"));
    if (recipient(mail).includes(email)) {
      assert.ok(body.includes(receipt.manageUrl));
      const calendarUrl = new URL(receipt.manageUrl);
      calendarUrl.pathname = calendarUrl.pathname.replace(/^\/manage\//u, "/api/public/manage/") + "/calendar.ics";
      assert.ok(body.includes(`Add to calendar: ${calendarUrl.toString()}`));
      assert.ok(html.includes(`href="${receipt.manageUrl}"`));
      assert.ok(html.includes(`/api/public/manage/${new URL(receipt.manageUrl).pathname.split("/").at(-1)}/calendar.ics`));
      assert.match(html, /Add to calendar/);
      assert.equal(mail.attachments.length, 1);
      const attachment = mail.attachments[0];
      assert.equal(attachment.filename, "booking.ics"); assert.equal(attachment.type, "text/calendar");
      const ics = Buffer.from(attachment.content, "base64").toString().replaceAll("\r\n ", "");
      assert.match(ics, /BEGIN:VCALENDAR\r\nVERSION:2.0/); assert.match(ics, /METHOD:PUBLISH/);
      assert.ok(ics.includes(`UID:${snapshot.bookings.find(booking => booking.invitee_email === email).ical_uid}`));
      assert.ok(ics.includes(`DTSTART:${instant(receipt.occurrence.startAt)}`));
      assert.ok(ics.includes(`DTEND:${instant(receipt.occurrence.endAt)}`));
      assert.match(ics, /SUMMARY:A focused introduction/); assert.match(ics, /LOCATION:Google Meet link pending/);
      assert.ok(!ics.includes(receipt.manageUrl), "calendar file is not a manage capability");
    } else {
      assert.ok(!JSON.stringify(mail).includes(receipt.manageUrl));
      assert.ok(!JSON.stringify(mail).includes(new URL(receipt.manageUrl).pathname.split("/").at(-1)));
      assert.ok(!html.includes("Manage booking"));
      assert.equal(mail.attachments, undefined);
    }
  }
}
export function assertChange(snapshot, first, changed, email, kind, reason, actor = "the invitee", bookingId) {
  // Native outbox/provider identity isolates shared operator copies without hiding wrong or absent reasons.
  const matches = bookingMail(snapshot, bookingId).filter(mail => (kind === "reschedule" ? /^Rescheduled:/ : /^Booking cancelled:/).test(mail.subject) && (recipient(mail).includes(email) || recipient(mail).includes("operator@dial.test")));
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.flatMap(recipient).sort(), [email, "operator@dial.test"].sort());
  const previousInviteeTimezone = first.inviteeTimezone;
  const currentInviteeTimezone = changed.inviteeTimezone ?? previousInviteeTimezone;
  // C.1 rotation can change an invitee capability before first send, so parity follows the current outbox URL.
  // The public booking receipt intentionally omits its database ID; the journey supplies the persisted booking ID.
  const activeManageUrl = snapshot.delivery_outbox.filter(row => row.booking_id === bookingId && row.kind === "mail_send")
    .map(row => JSON.parse(row.payload_json)).find(payload => payload.to === email && payload.recipientRole === "invitee" && typeof payload.manageUrl === "string")?.manageUrl;
  for (const mail of matches) {
    const body = textBody(mail);
    const html = htmlBody(mail);
    assertActionParity(body, html);
    assert.equal(mail.subject, `${kind === "reschedule" ? "Rescheduled" : "Booking cancelled"}: ${first.event.eventTitle}`);
    assert.ok(body.includes(`by ${actor}`)); assert.ok(body.includes(`Reason: ${reason}`));
    assert.ok(html.includes(first.event.eventTitle));
    assert.ok(html.includes("Australia/Brisbane")); assert.ok(html.includes(kind === "reschedule" ? previousInviteeTimezone : currentInviteeTimezone));
    assert.equal(/Calendar state:/.test(body), recipient(mail).includes("operator@dial.test"));
    if (kind === "reschedule") {
      for (const [prefix, occurrence, inviteeTimezone] of [["Previous", first.occurrence, previousInviteeTimezone], ["New", changed.occurrence, currentInviteeTimezone]]) {
        const inviteeTime = timeRange(occurrence.startAt, occurrence.endAt, inviteeTimezone);
        const hostTime = timeRange(occurrence.startAt, occurrence.endAt, "Australia/Brisbane");
        assertTimeRange(body, html, inviteeTime, `${prefix} invitee time: `);
        assertTimeRange(body, html, hostTime, `${prefix} host time: `);
      }
    } else {
      assertTimeRange(body, html, timeRange(changed.occurrence.startAt, changed.occurrence.endAt, currentInviteeTimezone), "Previous invitee time: ");
      assertTimeRange(body, html, timeRange(changed.occurrence.startAt, changed.occurrence.endAt, "Australia/Brisbane"), "Previous host time: ");
    }
    if (recipient(mail).includes("operator@dial.test")) assert.ok(!JSON.stringify(mail).includes(new URL(first.manageUrl).pathname.split("/").at(-1)));
    else if (kind === "reschedule") {
      assert.ok(activeManageUrl, "rescheduled invitee mail retains its current active capability");
      assert.ok(html.includes(`href="${activeManageUrl}"`));
      assert.ok(body.includes(`Manage this booking: ${activeManageUrl}`));
    }
    if (kind === "cancel") {
      assert.ok(body.split("\n").includes(`Reason: ${reason}.`));
      assert.ok(html.includes(`Reason: ${reason}.`));
    }
  }
}
export function assertLinkReady(snapshot, email, expected = 1) {
  const sends = wireMail(snapshot).filter(mail => mail.subject === "Your meeting link is ready" && recipient(mail).includes(email));
  assert.equal(sends.length, expected);
  for (const mail of sends) {
    assert.deepEqual(recipient(mail), [email]); assert.match(textBody(mail), /https:\/\/meet\.google\.com\/aaa-bbbb-ccc/);
    const html = htmlBody(mail);
    const body = textBody(mail);
    assertActionParity(body, html);
    const booking = snapshot.bookings.find(row => row.invitee_email === email);
    const occurrence = snapshot.booking_occurrences.find(row => row.id === booking.current_occurrence_id);
    const manageUrl = snapshot.delivery_outbox.map(row => JSON.parse(row.payload_json)).find(payload => payload.to === email && payload.recipientRole === "invitee" && typeof payload.manageUrl === "string")?.manageUrl;
    assert.ok(manageUrl, "invitee confirmation persists its manage capability");
    assert.ok(body.startsWith("Your meeting link is ready: https://meet.google.com/aaa-bbbb-ccc\n"));
    assert.ok(body.includes(booking.event_title));
    assert.ok(body.includes(booking.host_timezone));
    assert.ok(body.includes(booking.invitee_timezone));
    assert.ok(body.includes(`${booking.duration_minutes} minutes`));
    assert.ok(body.includes("Google Meet: https://meet.google.com/aaa-bbbb-ccc"));
    assert.ok(body.includes(`Manage this booking: ${manageUrl}`));
    // C.1 derives ICS from the invitee manage URL, whose review origin is local HTTP.
    const calendarUrl = new URL(manageUrl);
    calendarUrl.pathname = calendarUrl.pathname.replace(/^\/manage\//u, "/api/public/manage/") + "/calendar.ics";
    assert.ok(body.includes(`Add to calendar: ${calendarUrl.toString()}`));
    assert.ok(html.includes("https://meet.google.com/aaa-bbbb-ccc"));
    assert.ok(html.includes("Join session")); assert.ok(html.includes("Manage booking"));
    assert.ok(html.includes("Add to calendar"));
    assertTimeRange(body, html, timeRange(occurrence.start_at, occurrence.end_at, booking.invitee_timezone));
    assertTimeRange(body, html, timeRange(occurrence.start_at, occurrence.end_at, booking.host_timezone));
    assert.ok(html.includes(`${booking.duration_minutes} minutes`));
  }
}

export function assertReminder(snapshot, email, hostName, expected = 2) {
  // C.1 checks operator reminder facts against their linked booking, since operators are not invitees.
  const reminderRow = snapshot.delivery_outbox.find(row => row.kind === "reminder" && JSON.parse(row.payload_json).to === email);
  assert.ok(reminderRow);
  const reminderPayload = JSON.parse(reminderRow.payload_json);
  const booking = snapshot.bookings.find(row => row.id === reminderRow.booking_id);
  assert.ok(booking);
  const occurrence = snapshot.booking_occurrences.find(row => row.id === booking.current_occurrence_id);
  const reminders = wireMail(snapshot).filter(mail => mail.subject === `Reminder: ${booking.event_title}` && recipient(mail).includes(email));
  assert.equal(reminders.length, expected);
  const operator = reminderPayload.recipientRole === "operator";
  const zone = operator ? booking.host_timezone : booking.invitee_timezone;
  const format = instant => new Intl.DateTimeFormat("en-GB", { timeZone: zone, dateStyle: "full", timeStyle: "long" }).format(new Date(instant));
  const range = `${format(occurrence.start_at)} – ${format(occurrence.end_at)} (${zone})`;
  const location = booking.meeting_url ?? (booking.meeting_state === "failed" || booking.calendar_state === "failed" ? "Meeting link unavailable — contact the host." : "Meeting link pending — contact the host if it is not ready.");
  const inviteePayload = snapshot.delivery_outbox.map(row => JSON.parse(row.payload_json)).find(payload => payload.to === booking.invitee_email && payload.recipientRole === "invitee" && typeof payload.manageUrl === "string");
  assert.ok(inviteePayload?.manageUrl);
  const icsUrl = new URL(inviteePayload.manageUrl);
  icsUrl.pathname = icsUrl.pathname.replace(/^\/manage\//u, "/api/public/manage/") + "/calendar.ics";
  for (const mail of reminders) {
    assert.deepEqual(recipient(mail), [email]);
    assert.deepEqual(mail.content.map(part => part.type), ["text/plain", "text/html"]);
    const body = textBody(mail), html = htmlBody(mail);
    assertActionParity(body, html);
    assertTimeRange(body, html, range, `${booking.event_title}\n`, true, "\n");
    assert.ok(body.includes(`Host: ${hostName}`));
    assert.ok(body.includes(`${booking.meeting_url ? booking.location_label.replace(/\s*\(link on confirmation\)/giu, "").trim() : booking.location_label}: ${location}`));
    assert.ok(body.includes(`Duration: ${booking.duration_minutes} minutes`));
    assert.equal(/Calendar (?:setup|state):/.test(body), operator);
    if (operator) assert.ok(body.includes(`Calendar setup: ${{ pending: "Update pending", succeeded: "Up to date", failed: "Update failed", not_required: "No connected calendar" }[booking.calendar_state]}.`));
    assert.ok(html.includes(hostName));
    assert.ok(html.includes(booking.event_title));

    assert.ok(html.includes(`${booking.duration_minutes} minutes`));
    assert.ok(html.includes(location));
    if (booking.meeting_url) {
      assert.ok(body.includes(`Join session: ${booking.meeting_url}`));
      assert.ok(html.includes(`href="${booking.meeting_url}"`));
    }
    if (operator) {
      assert.ok(!JSON.stringify(mail).includes(new URL(inviteePayload.manageUrl).pathname.split("/").at(-1)));
      assert.ok(!body.includes("Manage this booking:"));
      assert.ok(!body.includes("Add to calendar:"));
    } else {
      assert.ok(body.includes(`Manage this booking: ${inviteePayload.manageUrl}`));
      assert.ok(body.includes(`Add to calendar: ${icsUrl.toString()}`));
      assert.ok(html.includes(`href="${inviteePayload.manageUrl}"`));
      assert.ok(html.includes(`href="${icsUrl.toString()}"`));
    }
  }
}
