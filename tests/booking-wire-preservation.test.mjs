import assert from "node:assert/strict";
import { contract } from "./contract.mjs";
import { assertChange, timeRange } from "./booking-wire/mail-contracts.mjs";

const email = "wire0@dial.test", operator = "operator@dial.test", bookingId = "booking-primary";
const reason = "Preserved change", actor = "the invitee", title = "A focused introduction";
const first = {
  event: { eventTitle: title }, inviteeTimezone: "UTC", manageUrl: "https://dial.test/manage/test-only-capability",
  occurrence: { startAt: "2030-01-07T00:00:00.000Z", endAt: "2030-01-07T00:30:00.000Z" },
};
const changed = { inviteeTimezone: "America/New_York", occurrence: { startAt: "2030-01-08T00:00:00.000Z", endAt: "2030-01-08T00:30:00.000Z" } };
const subject = kind => `${kind === "reschedule" ? "Rescheduled" : "Booking cancelled"}: ${title}`;

function fixture(kind) {
  const snapshot = { wire_calls: [], delivery_outbox: [] };
  for (const [to, role] of [[email, "invitee"], [operator, "operator"]]) {
    const id = `booking:${bookingId}:occurrence:changed:mail:${kind === "cancel" ? "cancel:" : ""}${role}:${to}`;
    const ranges = kind === "reschedule"
      ? [["Previous", first.occurrence, first.inviteeTimezone], ["New", changed.occurrence, changed.inviteeTimezone]]
      : [["Previous", changed.occurrence, changed.inviteeTimezone]];
    const facts = ranges.flatMap(([prefix, occurrence, zone]) => [
      `${prefix} invitee time: ${timeRange(occurrence.startAt, occurrence.endAt, zone)}`,
      `${prefix} host time: ${timeRange(occurrence.startAt, occurrence.endAt, "Australia/Brisbane")}`,
    ]);
    const action = kind === "reschedule" && role === "invitee" ? `Manage this booking: ${first.manageUrl}` : "";
    const body = [title, `Changed by ${actor}.`, ...facts, `Reason: ${reason}.`, "Calendar state: pending.", action].filter(Boolean).join("\n");
    const html = `<table style="color:black"><tr><td>${body.replace(action, "")}${action ? `<a href="${first.manageUrl}">Manage booking</a>` : ""}</td></tr></table>`;
    const mail = { subject: subject(kind), personalizations: [{ to: [{ email: to }] }], custom_args: { rer_delivery_id: id }, content: [{ type: "text/plain", value: body }, { type: "text/html", value: html }] };
    snapshot.wire_calls.push({ url: "https://api.sendgrid.com/v3/mail/send", body: JSON.stringify(mail) });
    snapshot.delivery_outbox.push({ booking_id: bookingId, kind: "mail_send", idempotency_key: id, payload_json: JSON.stringify({ to, recipientRole: role, manageUrl: role === "invitee" ? first.manageUrl : undefined }) });
  }
  return snapshot;
}
const check = (snapshot, kind) => assertChange(snapshot, first, changed, email, kind, reason, actor, bookingId);

for (const kind of ["reschedule", "cancel"]) {
  contract("NOTIFY-004", `${kind} retains both correlated copies and all change facts`, () => {
    assert.doesNotThrow(() => check(fixture(kind), kind));
  });
  for (const role of ["invitee", "operator"]) for (const corruption of ["wrong reason", "missing reason"]) {
    contract("NOTIFY-004", `${kind} counts an extra ${role} send with ${corruption}`, () => {
      const snapshot = fixture(kind), source = snapshot.wire_calls[role === "invitee" ? 0 : 1];
      const duplicate = JSON.parse(source.body);
      for (const part of duplicate.content) part.value = part.value.replace(`Reason: ${reason}.`, corruption === "wrong reason" ? "Reason: A different change." : "");
      snapshot.wire_calls.push({ ...source, body: JSON.stringify(duplicate) });
      assert.throws(() => check(snapshot, kind), error => error.code === "ERR_ASSERTION" && error.actual === 3 && error.expected === 2);
    });
  }
  contract("NOTIFY-004", `${kind} excludes the same-title operator copy for another booking by delivery identity`, () => {
    const snapshot = fixture(kind), unrelated = JSON.parse(snapshot.wire_calls[1].body);
    const id = unrelated.custom_args.rer_delivery_id.replace(bookingId, "booking-other");
    unrelated.custom_args.rer_delivery_id = id;
    snapshot.delivery_outbox.push({ ...snapshot.delivery_outbox[1], booking_id: "booking-other", idempotency_key: id });
    snapshot.wire_calls.push({ ...snapshot.wire_calls[1], body: JSON.stringify(unrelated) });
    assert.doesNotThrow(() => check(snapshot, kind));
  });
  contract("NOTIFY-004", `${kind} follows a stored provider delivery identity after manual retry`, () => {
    const snapshot = fixture(kind), row = snapshot.delivery_outbox[0], mail = JSON.parse(snapshot.wire_calls[0].body);
    const payload = JSON.parse(row.payload_json);
    payload.providerIdempotencyKey = `${row.idempotency_key}:retry:1`;
    row.payload_json = JSON.stringify(payload);
    mail.custom_args.rer_delivery_id = payload.providerIdempotencyKey;
    snapshot.wire_calls[0].body = JSON.stringify(mail);
    assert.doesNotThrow(() => check(snapshot, kind));
  });
}

for (const kind of ["reschedule", "cancel"]) for (const role of ["invitee", "operator"]) {
  contract("NOTIFY-004", `${kind} counts an extra ${role} send with the same change-kind prefix and wrong title`, () => {
    const snapshot = fixture(kind), source = snapshot.wire_calls[role === "invitee" ? 0 : 1];
    const duplicate = JSON.parse(source.body);
    duplicate.subject = `${kind === "reschedule" ? "Rescheduled" : "Booking cancelled"}: Wrong title`;
    snapshot.wire_calls.push({ ...source, body: JSON.stringify(duplicate) });
    assert.throws(() => check(snapshot, kind), error => error.code === "ERR_ASSERTION" && error.actual === 3 && error.expected === 2);
  });
}
