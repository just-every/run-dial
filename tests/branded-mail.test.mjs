import assert from "node:assert/strict";
import { contract } from "./contract.mjs";
import { decodeAttribute } from "./html-text.mjs";
import { brandedMailSamples } from "./branded-mail-samples.mjs";

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/giu).map((channel) => parseInt(channel, 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function assertMailLayout(html, kind) {
  assert.match(html, /<table\b/i, `${kind} uses a table layout`);
  assert.match(html, /style="/i, `${kind} uses inline styles`);
  assert.doesNotMatch(html, /<\/?(?:img|script|iframe|style|link|svg|form)\b/i, `${kind} has no external resource or executable element`);
  assert.doesNotMatch(html, /@import|url\s*\(/i, `${kind} has no external CSS resource`);
  assert.doesNotMatch(html, /<meta[^>]+http-equiv\s*=\s*["']refresh/i, `${kind} has no refresh tracker`);
}

function assertActionLinksMatchText(html, text, kind, layout) {
  const htmlLinks = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/giu)].map((match) => decodeAttribute(match[1]));
  for (const href of htmlLinks) assert.ok(text.includes(href), `${kind} text includes HTML action URL ${href}`);
  const textActions = [...text.matchAll(/^(?:Join session|Manage this booking|Add to calendar): (https?:\/\/\S+)$/gmu)].map((match) => match[1]);
  for (const href of textActions) assert.ok(html.includes(`href="${layout.escapeHtml(href)}"`), `${kind} HTML includes text action URL ${href}`);
}

contract("NOTIFY-001", "booking confirmations escape hostile invitee and operator copy and keep private actions invitee-only", async () => {
  const { samples, fixture, source, layout } = await brandedMailSamples();
  const texts = new Map([
    ["confirmation invitee", source.booking.bookingConfirmationMail({ hostName: fixture.hostName, eventTitle: fixture.eventTitle, startAt: fixture.startAt, endAt: fixture.endAt, durationMinutes: fixture.durationMinutes, inviteeTimezone: fixture.inviteeTimezone, hostTimezone: fixture.hostTimezone, locationType: fixture.locationType, locationLabel: fixture.locationLabel, locationValue: fixture.locationValue, meetingUrl: fixture.meetingUrl, calendarState: "pending", recipientRole: "invitee", inviteeName: fixture.inviteeName, inviteeEmail: fixture.inviteeEmail, answers: [{ label: fixture.answerLabel, value: fixture.answerValue }], manageUrl: fixture.manageUrl }).text],
    ["confirmation operator", source.booking.bookingConfirmationMail({ hostName: fixture.hostName, eventTitle: fixture.eventTitle, startAt: fixture.startAt, endAt: fixture.endAt, durationMinutes: fixture.durationMinutes, inviteeTimezone: fixture.inviteeTimezone, hostTimezone: fixture.hostTimezone, locationType: fixture.locationType, locationLabel: fixture.locationLabel, locationValue: fixture.locationValue, meetingUrl: fixture.meetingUrl, calendarState: "pending", recipientRole: "operator", inviteeName: fixture.inviteeName, inviteeEmail: fixture.inviteeEmail, answers: [{ label: fixture.answerLabel, value: fixture.answerValue }] }).text],
  ]);
  for (const sample of samples) {
    assertMailLayout(sample.html, sample.kind);
    for (const hostileValue of [fixture.hostName, fixture.eventTitle, fixture.inviteeName, fixture.locationLabel, fixture.answerLabel, fixture.answerValue, fixture.note]) {
      assert.ok(!sample.html.includes(hostileValue), `${sample.kind} escapes ${hostileValue.slice(0, 24)}`);
    }
    if (texts.has(sample.kind)) assertActionLinksMatchText(sample.html, texts.get(sample.kind), sample.kind, layout);
  }
  const invitee = samples.find((sample) => sample.kind === "confirmation invitee");
  const operator = samples.find((sample) => sample.kind === "confirmation operator");
  assert.ok(invitee && operator);
  for (const sample of [invitee, operator]) {
    assertMailLayout(sample.html, sample.kind);
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.hostName)));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.eventTitle)));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.answerValue)));
    assert.ok(!sample.html.includes(fixture.hostName));
    assert.ok(!sample.html.includes(fixture.eventTitle));
  }
  assert.ok(invitee.html.includes(layout.escapeHtml(source.booking.formatTimeRange(fixture.startAt, fixture.endAt, fixture.inviteeTimezone))));
  assert.ok(invitee.html.includes(layout.escapeHtml(source.booking.formatTimeRange(fixture.startAt, fixture.endAt, fixture.hostTimezone))));
  assert.ok(invitee.html.includes("60 minutes"));
  assert.ok(invitee.html.includes(layout.escapeHtml(fixture.locationLabel)));
  assert.ok(invitee.html.includes(layout.escapeHtml(fixture.locationValue)));
  assert.ok(invitee.html.includes("Calendar setup"));
  assert.ok(invitee.html.includes("pending"));
  assert.ok(invitee.html.includes(layout.escapeHtml(fixture.answerLabel)));
  assert.ok(invitee.html.includes(layout.escapeHtml(fixture.answerValue)));
  assert.ok(invitee.html.includes(`href="${fixture.manageUrl}"`));
  assert.ok(invitee.html.includes("/api/public/manage/capability-fixture/calendar.ics"));
  assert.ok(operator.html.includes(layout.escapeHtml(source.booking.formatTimeRange(fixture.startAt, fixture.endAt, fixture.inviteeTimezone))));
  assert.ok(operator.html.includes(layout.escapeHtml(source.booking.formatTimeRange(fixture.startAt, fixture.endAt, fixture.hostTimezone))));
  assert.ok(operator.html.includes(layout.escapeHtml(fixture.inviteeName)));
  assert.ok(operator.html.includes(layout.escapeHtml(`${fixture.inviteeName} <${fixture.inviteeEmail}>`)));
  assert.ok(!operator.html.includes("capability-fixture"));
  assert.ok(!operator.html.includes("calendar.ics"));
});

contract("NOTIFY-002", "link-ready mail presents matching verified join, manage and calendar facts and actions", async () => {
  const { samples, fixture, texts, layout } = await brandedMailSamples();
  const sample = samples.find((value) => value.kind === "link ready");
  assert.ok(sample);
  assertMailLayout(sample.html, sample.kind);
  assert.ok(sample.html.includes(layout.escapeHtml(fixture.eventTitle)));
  assert.ok(sample.html.includes("href=\"https://meet.google.com/aaa-bbbb-ccc\""));
  assert.ok(sample.html.includes(`href="${fixture.manageUrl}"`));
  assert.ok(sample.html.includes("/api/public/manage/capability-fixture/calendar.ics"));
  assert.ok(sample.html.includes(layout.escapeHtml("Australia/Brisbane")));
  assert.ok(sample.html.includes(layout.escapeHtml("America/New_York")));
  assert.ok(texts.linkReady.startsWith(`Your meeting link is ready: https://meet.google.com/aaa-bbbb-ccc\n`));
  for (const value of [fixture.hostName, fixture.eventTitle, fixture.inviteeTimezone, fixture.hostTimezone, `${fixture.durationMinutes} minutes`, "Google Meet", "succeeded", fixture.manageUrl, "/api/public/manage/capability-fixture/calendar.ics"]) {
    assert.ok(texts.linkReady.includes(value), `link-ready text includes ${value}`);
  }
  assertActionLinksMatchText(sample.html, texts.linkReady, sample.kind, layout);
});

contract("NOTIFY-003", "reminders carry recipient-zone event facts and keep private actions invitee-only", async () => {
  const { samples, fixture, texts, layout } = await brandedMailSamples();
  const invitee = samples.find((sample) => sample.kind === "reminder invitee");
  const operator = samples.find((sample) => sample.kind === "reminder operator");
  assert.ok(invitee && operator);
  assertMailLayout(invitee.html, invitee.kind);
  assertMailLayout(operator.html, operator.kind);
  assert.ok(invitee.html.includes(layout.escapeHtml(fixture.inviteeTimezone)));
  assert.ok(operator.html.includes(layout.escapeHtml(fixture.hostTimezone)));
  assert.ok(invitee.html.includes(layout.escapeHtml(texts.reminderInvitee.split("\n")[1])));
  assert.ok(invitee.html.includes(layout.escapeHtml(fixture.locationLabel)));
  assert.ok(invitee.html.includes(layout.escapeHtml(fixture.locationValue)));
  assert.ok(invitee.html.includes("60 minutes"));
  assert.ok(invitee.html.includes(`href="${fixture.manageUrl}"`));
  assert.ok(!operator.html.includes("capability-fixture"));
  assert.ok(texts.reminderInvitee.includes(`Host: ${fixture.hostName}`));
  assert.ok(texts.reminderInvitee.includes(`Duration: ${fixture.durationMinutes} minutes`));
  assert.ok(texts.reminderInvitee.includes("Calendar setup: succeeded."));
  assert.ok(texts.reminderInvitee.includes("Join session: https://meet.example.test/join?next=%22%20onmouseover%3Dalert(1)"));
  assert.ok(texts.reminderInvitee.includes(`Add to calendar: https://dial.example.test/api/public/manage/capability-fixture/calendar.ics`));
  assert.ok(texts.reminderOperator.includes(`Host: ${fixture.hostName}`));
  assert.ok(texts.reminderOperator.includes(`Duration: ${fixture.durationMinutes} minutes`));
  assert.ok(texts.reminderOperator.includes("Calendar setup: succeeded."));
  assertActionLinksMatchText(invitee.html, texts.reminderInvitee, invitee.kind, layout);
  assertActionLinksMatchText(operator.html, texts.reminderOperator, operator.kind, layout);
  assert.ok(texts.reminderInvitee.startsWith(`${fixture.eventTitle}\n`));
  assert.ok(texts.reminderInvitee.includes(`(${fixture.inviteeTimezone})`));
  assert.ok(texts.reminderInvitee.includes(`${fixture.locationLabel}: ${fixture.locationValue}`));
  assert.ok(texts.reminderInvitee.includes(`Manage this booking: ${fixture.manageUrl}`));
  assert.ok(texts.reminderInvitee.endsWith("Add to calendar: https://dial.example.test/api/public/manage/capability-fixture/calendar.ics"));
  assert.ok(texts.reminderOperator.includes(`(${fixture.hostTimezone})`));
});

contract("NOTIFY-004", "reschedule and cancellation copies escape values and keep matching facts and recipient-specific actions", async () => {
  const { samples, fixture, texts, source, layout } = await brandedMailSamples();
  for (const kind of ["reschedule invitee", "reschedule operator", "cancellation invitee", "cancellation operator"]) {
    const sample = samples.find((value) => value.kind === kind);
    assert.ok(sample);
    assertMailLayout(sample.html, kind);
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.eventTitle)));
    assert.ok(sample.html.includes(layout.escapeHtml("Australia/Brisbane")));
    assert.ok(sample.html.includes(layout.escapeHtml("America/New_York")));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.reason)) || kind.startsWith("reschedule"));
  }
  const rescheduleInvitee = samples.find((sample) => sample.kind === "reschedule invitee");
  const rescheduleOperator = samples.find((sample) => sample.kind === "reschedule operator");
  const cancellationInvitee = samples.find((sample) => sample.kind === "cancellation invitee");
  const cancellationOperator = samples.find((sample) => sample.kind === "cancellation operator");
  assert.ok(rescheduleInvitee.html.includes(`href="${fixture.manageUrl}"`));
  assertActionLinksMatchText(rescheduleInvitee.html, source.booking.bookingChangeHtml({ hostName: fixture.hostName, eventTitle: fixture.eventTitle, startAt: fixture.startAt, endAt: fixture.endAt, durationMinutes: fixture.durationMinutes, inviteeTimezone: fixture.inviteeTimezone, hostTimezone: fixture.hostTimezone, locationType: fixture.locationType, locationLabel: fixture.locationLabel, locationValue: fixture.locationValue, meetingUrl: fixture.meetingUrl, calendarState: "pending", actor: fixture.inviteeName, previousInviteeTime: source.booking.formatTimeRange(fixture.startAt, fixture.endAt, fixture.inviteeTimezone), previousHostTime: source.booking.formatTimeRange(fixture.startAt, fixture.endAt, fixture.hostTimezone), reason: fixture.note, recipientRole: "invitee", inviteeName: fixture.inviteeName, inviteeEmail: fixture.inviteeEmail, manageUrl: fixture.manageUrl }).text, rescheduleInvitee.kind, layout);
  assertActionLinksMatchText(rescheduleOperator.html, source.booking.bookingChangeHtml({ hostName: fixture.hostName, eventTitle: fixture.eventTitle, startAt: fixture.startAt, endAt: fixture.endAt, durationMinutes: fixture.durationMinutes, inviteeTimezone: fixture.inviteeTimezone, hostTimezone: fixture.hostTimezone, locationType: fixture.locationType, locationLabel: fixture.locationLabel, locationValue: fixture.locationValue, meetingUrl: fixture.meetingUrl, calendarState: "pending", actor: fixture.inviteeName, previousInviteeTime: source.booking.formatTimeRange(fixture.startAt, fixture.endAt, fixture.inviteeTimezone), previousHostTime: source.booking.formatTimeRange(fixture.startAt, fixture.endAt, fixture.hostTimezone), reason: fixture.note, recipientRole: "operator", inviteeName: fixture.inviteeName, inviteeEmail: fixture.inviteeEmail }).text, rescheduleOperator.kind, layout);
  for (const text of [texts.cancellationInvitee, texts.cancellationOperator]) {
    assert.match(text, /^Reason: deleted_in_google_calendar\.$/mu);
    for (const value of [fixture.eventTitle, fixture.hostName, fixture.inviteeTimezone, fixture.hostTimezone, `${fixture.durationMinutes} minutes`, fixture.locationLabel, fixture.locationValue, "Calendar state: pending"]) assert.ok(text.includes(value), `cancellation text includes ${value}`);
  }
  for (const sample of [cancellationInvitee, cancellationOperator]) {
    assert.ok(sample.html.includes("Reason: deleted_in_google_calendar."));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.eventTitle)));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.hostName)));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.locationValue)));
    assertActionLinksMatchText(sample.html, sample.kind === "cancellation invitee" ? texts.cancellationInvitee : texts.cancellationOperator, sample.kind, layout);
  }
  const missingReason = source.booking.bookingCancellationMail({ hostName: fixture.hostName, eventTitle: fixture.eventTitle, startAt: fixture.startAt, endAt: fixture.endAt, durationMinutes: fixture.durationMinutes, inviteeTimezone: fixture.inviteeTimezone, hostTimezone: fixture.hostTimezone, locationType: fixture.locationType, locationLabel: fixture.locationLabel, locationValue: fixture.locationValue, meetingUrl: fixture.meetingUrl, calendarState: "pending", actor: "the invitee", recipientRole: "invitee", inviteeName: fixture.inviteeName, inviteeEmail: fixture.inviteeEmail });
  assert.match(missingReason.text, /^Reason: No reason provided\.$/mu);
  assert.ok(missingReason.html.includes("Reason: No reason provided."));
  assert.ok(samples.find((sample) => sample.kind === "reschedule operator").html.includes(layout.escapeHtml(source.booking.formatTimeRange(fixture.startAt, fixture.endAt, fixture.inviteeTimezone))));
  assert.ok(!samples.find((sample) => sample.kind === "reschedule operator").html.includes("capability-fixture"));
  assert.ok(!samples.find((sample) => sample.kind === "cancellation invitee").html.includes("capability-fixture"));
});

contract("REQUEST-002", "request acknowledgement and operator notification retain the requested windows, timezone and note", async () => {
  const { samples, fixture, texts, layout } = await brandedMailSamples();
  for (const kind of ["request acknowledgement invitee", "request acknowledgement operator"]) {
    const sample = samples.find((value) => value.kind === kind);
    assert.ok(sample);
    assertMailLayout(sample.html, kind);
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.hostName)));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.eventTitle)));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.inviteeTimezone)));
    assert.ok(sample.html.includes("2026-10-20 09:30–10:30"));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.note)));
  }
  const requestOperator = samples.find((sample) => sample.kind === "request acknowledgement operator");
  assert.ok(requestOperator.html.includes(layout.escapeHtml(fixture.inviteeName)));
  assert.ok(requestOperator.html.includes(layout.escapeHtml(fixture.inviteeEmail)));
  assert.equal(texts.requestInvitee, `We received your request for ${fixture.eventTitle}. The host will follow up by email.\n\nYour timezone: ${fixture.inviteeTimezone}\n2026-10-20 09:30–10:30\n\nYour note: ${fixture.note}\n\nHost: ${fixture.hostName}`);
  assert.equal(texts.requestOperator, `${fixture.inviteeName} (${fixture.inviteeEmail}) requested another time for ${fixture.eventTitle}.\n\nTimezone: ${fixture.inviteeTimezone}\n2026-10-20 09:30–10:30\n\nNote: ${fixture.note}\n\nHost: ${fixture.hostName}`);
});

contract("REQUEST-005", "handled and closed request updates use the shared layout while preserving exact text", async () => {
  const { samples, fixture, texts, layout } = await brandedMailSamples();
  for (const kind of ["request handled update", "request closed update"]) {
    const sample = samples.find((value) => value.kind === kind);
    assert.ok(sample);
    assertMailLayout(sample.html, kind);
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.hostName)));
    assert.ok(sample.html.includes(layout.escapeHtml(fixture.eventTitle)));
  }
  assert.ok(samples.find((sample) => sample.kind === "request handled update").html.includes(layout.escapeHtml(texts.requestHandled)));
  assert.ok(samples.find((sample) => sample.kind === "request closed update").html.includes(layout.escapeHtml(texts.requestClosed)));
  assert.equal(texts.requestHandled, `The host is handling your request for ${fixture.eventTitle} and will follow up by email.\n\nHost: ${fixture.hostName}`);
  assert.equal(texts.requestClosed, `The host cannot offer a time for your request for ${fixture.eventTitle}.\n\nHost: ${fixture.hostName}`);
});

contract("NOTIFY-007", "connection alerts and recovery notices carry matching text in the shared layout", async () => {
  const { samples, fixture, texts, layout } = await brandedMailSamples();
  const alert = samples.find((sample) => sample.kind === "connection alert");
  const recovery = samples.find((sample) => sample.kind === "connection recovery");
  assert.ok(alert && recovery);
  assertMailLayout(alert.html, alert.kind);
  assertMailLayout(recovery.html, recovery.kind);
  assert.ok(alert.html.includes(layout.escapeHtml(fixture.note)));
  assert.ok(alert.html.includes(layout.escapeHtml(texts.alert)));
  assert.ok(alert.html.includes("needs attention"));
  assert.ok(recovery.html.includes("recovered"));
});

contract("NOTIFY-001", "Dial action button text meets WCAG AA contrast and unsafe URL schemes are rejected", async () => {
  const { fixture, source, layout } = await brandedMailSamples();
  assert.equal(layout.dialAccent, "#1d1c1a");
  assert.equal(layout.dialButtonText, "#ffffff");
  assert.ok(contrast(layout.dialButtonText, layout.dialAccent) >= 4.5);
  assert.throws(() => layout.renderBrandedMail({ heading: "unsafe", actions: [{ label: "Join", href: "javascript:alert(1)" }] }), /HTTP or HTTPS/);
  assert.throws(() => layout.renderBrandedMail({ heading: "unsafe", actions: [{ label: "Join", href: "https://user:password@example.test/" }] }), /embedded credentials/);
  assert.throws(() => layout.renderBrandedMail({ heading: "unsafe", actions: [{ label: "Join", href: "https://example.test/\ninvalid" }] }), /control character/);
  const unsafeLocation = source.booking.bookingConfirmationMail({
    ...fixture,
    locationValue: "javascript:alert(1)",
    calendarState: "pending",
    recipientRole: "invitee",
    answers: [],
  });
  assert.ok(unsafeLocation.html.includes(layout.escapeHtml("javascript:alert(1)")));
  assert.ok(unsafeLocation.text.includes(`Location: ${fixture.locationLabel}: javascript:alert(1)`));
  assert.ok(unsafeLocation.text.includes("Join session: javascript:alert(1)"));
  assert.doesNotMatch(unsafeLocation.html, /<a\b[^>]*>Join session<\/a>/u);
});
