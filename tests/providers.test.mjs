import assert from "node:assert/strict";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

async function loadModule(path) {
  const result = await build({
    entryPoints: [new URL(path, import.meta.url).pathname],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
}

contract("AVAIL-004", "a slow free/busy response body fails closed at the five-second provider boundary", async () => {
  const { GoogleCalendarAdapter } = await loadModule("../src/core/platform/calendar/google.ts");
  const delayedResponse = new Response(new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ calendars: { primary: { busy: [] } } })));
        controller.close();
      }, 80);
    },
  }), { headers: { "content-type": "application/json" } });
  const adapter = new GoogleCalendarAdapter({ clientId: "client", clientSecret: "secret" }, async () => delayedResponse, 20);
  await assert.rejects(
    adapter.readBusy("access", { calendarIds: ["primary"], startsAt: "2026-09-08T00:00:00.000Z", endsAt: "2026-09-08T01:00:00.000Z", timeZone: "UTC" }),
    (error) => error?.code === "provider_timeout",
  );
});

contract("CAL-004", "an ambiguous managed-event lookup does not create another calendar event", async () => {
  const { GoogleCalendarAdapter } = await loadModule("../src/core/platform/calendar/google.ts");
  let writes = 0;
  const adapter = new GoogleCalendarAdapter({ clientId: "client", clientSecret: "secret" }, async (input) => {
    if (String(input).includes("privateExtendedProperty")) {
      return Response.json({ items: [{ id: "provider-one" }, { id: "provider-two" }] });
    }
    writes += 1;
    return Response.json({ id: "should-not-write" });
  });
  await assert.rejects(
    adapter.upsertManagedEvent("access", "primary", {
      idempotencyKey: "booking:one:occurrence:one:calendar",
      bookingId: "booking-one",
      occurrenceId: "occurrence-one",
      icalUid: "dial-booking-one@dial",
      title: "Strategy call",
      description: "Dial booking",
      location: "https://meet.example/private",
      startAt: "2026-09-08T00:00:00.000Z",
      endAt: "2026-09-08T01:00:00.000Z",
      timeZone: "Australia/Brisbane",
      inviteeEmail: "invitee@example.test",
      requestGoogleMeet: false,
    }),
    (error) => error?.code === "invalid_provider_response",
  );
  assert.equal(writes, 0, "the ambiguous lookup is visible and no second event is created");
});

contract("CAL-008", "a destination sync retains a cancelled managed event when Google provides only its provider id and normalises equivalent instants", async () => {
  const { GoogleCalendarAdapter } = await loadModule("../src/core/platform/calendar/google.ts");
  let requested;
  const adapter = new GoogleCalendarAdapter({ clientId: "client", clientSecret: "secret" }, async (input) => {
    requested = new URL(String(input));
    return Response.json({
      items: [
        { id: "google-event-deleted", status: "cancelled" },
        {
          id: "google-event-changed",
          status: "confirmed",
          updated: "2030-06-03T20:20:00+10:00",
          start: { dateTime: "2030-06-03T20:00:00+10:00" },
          end: { dateTime: "2030-06-03T20:30:00+10:00" },
          extendedProperties: { private: { "dial-booking-id": "booking-one", "dial-occurrence-id": "occurrence-one" } },
        },
      ],
      nextSyncToken: "next-sync-token",
    });
  });
  const result = await adapter.syncManagedEvents("access", "destination", "prior-sync-token");
  assert.equal(requested.searchParams.get("syncToken"), "prior-sync-token");
  assert.equal(requested.searchParams.has("privateExtendedProperty"), false, "Google forbids that filter with an incremental cursor");
  assert.deepEqual(result, {
    syncCursor: "next-sync-token",
    changes: [
      { kind: "deleted", providerEventId: "google-event-deleted", bookingId: undefined, occurrenceId: undefined },
      { kind: "changed", providerEventId: "google-event-changed", bookingId: "booking-one", occurrenceId: "occurrence-one", updatedAt: "2030-06-03T10:20:00.000Z", startAt: "2030-06-03T10:00:00.000Z", endAt: "2030-06-03T10:30:00.000Z", location: "" },
    ],
  });
});

contract("AUTH-005", "malformed Resend Svix material is rejected without throwing", async () => {
  const { verifyResendWebhook } = await loadModule("../src/core/platform/mail/resend.ts");
  const accepted = await verifyResendWebhook("{}", new Headers({
    "svix-id": "message-id",
    "svix-timestamp": String(Math.floor(Date.now() / 1_000)),
    "svix-signature": "v1,not-valid-base64!",
  }), "whsec_not-valid-base64!");
  assert.equal(accepted, false);
});

contract("NOTIFY-006", "the Resend probe rejects a configured sender that is not a verified no-reply domain", async () => {
  const { ResendMailSender } = await loadModule("../src/core/platform/mail/resend.ts");
  const sender = new ResendMailSender({ apiKey: "re_test", fromEmail: "no-reply@dial.example" }, async () => Response.json({ data: [{ name: "dial.example", status: "pending" }] }));
  await assert.rejects(sender.checkConnection(), /forbidden/);
});

contract("NOTIFY-001", "the Resend adapter carries a validated base64 calendar attachment without changing the direct message boundary", async () => {
  const { ResendMailSender } = await loadModule("../src/core/platform/mail/resend.ts");
  let body;
  const sender = new ResendMailSender({ apiKey: "re_test", fromEmail: "no-reply@dial.example" }, async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ id: "resend-message" });
  });
  await sender.send({
    to: "invitee@example.test", subject: "Booking confirmed", text: "See attached calendar file.", idempotencyKey: "mail:attachment",
    attachments: [{ filename: "booking.ics", contentBase64: btoa("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"), contentType: "text/calendar" }],
  });
  assert.deepEqual(body.attachments, [{ filename: "booking.ics", content: btoa("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"), content_type: "text/calendar" }]);
});

contract("CAL-004", "lost creation responses reuse a stable Google event ID and subsequent writes require the observed ETag", async () => {
  const { GoogleCalendarAdapter } = await loadModule("../src/core/platform/calendar/google.ts");
  const event = { idempotencyKey: "booking:one:occurrence:one:calendar", bookingId: "booking-one", occurrenceId: "occurrence-one", icalUid: "dial-booking-one@dial", title: "Synthetic call", description: "Dial booking", location: "https://example.test/call", startAt: "2030-06-03T10:00:00.000Z", endAt: "2030-06-03T10:30:00.000Z", timeZone: "UTC", inviteeEmail: "invitee@example.test", requestGoogleMeet: false };
  const inserts = [];
  let visible = false;
  let patched = false;
  const adapter = new GoogleCalendarAdapter({ clientId: "fixture", clientSecret: "fixture" }, async (input, init) => {
    if (String(input).includes("privateExtendedProperty")) return Response.json({ items: visible ? [{ id: inserts[0].id, etag: '"current-etag"' }] : [] });
    const payload = JSON.parse(init.body);
    if (init.method === "POST") { inserts.push(payload); return new Response(null, { status: inserts.length === 1 ? 503 : 409 }); }
    assert.equal(init.method, "PATCH"); assert.equal(init.headers["if-match"], '"current-etag"'); assert.equal(payload.iCalUID, undefined); patched = true;
    return Response.json({ id: inserts[0].id, updated: "2030-06-03T09:00:00.000Z" });
  });
  await assert.rejects(adapter.upsertManagedEvent("synthetic", "primary", event), (error) => error.code === "provider_unavailable" && error.retryable);
  await assert.rejects(adapter.upsertManagedEvent("synthetic", "primary", event), (error) => error.code === "provider_write_conflict" && error.retryable);
  assert.equal(inserts[0].id, inserts[1].id); assert.match(inserts[0].id, /^[0-9a-v]{64}$/); assert.equal(inserts[0].iCalUID, undefined, "Google insert accepts only one identifier");
  assert.equal(inserts[0].extendedProperties.private["dial-ical-uid"], event.icalUid);
  visible = true;
  await adapter.upsertManagedEvent("synthetic", "primary", { ...event, occurrenceId: "occurrence-two" });
  assert.ok(patched);
});

contract("NOTIFY-005", "a stalled successful mail response body becomes a bounded retryable timeout", async () => {
  const { ResendMailSender } = await loadModule("../src/core/platform/mail/resend.ts");
  const sender = new ResendMailSender({ apiKey: "re_test", fromEmail: "no-reply@dial.example" }, async () => new Response(new ReadableStream({ start() {} })), 20);
  await assert.rejects(sender.send({ to: "invitee@dial.test", subject: "Synthetic", text: "Synthetic", idempotencyKey: "bounded-body" }), (error) => error?.code === "provider_timeout" && error?.retryable === true);
});

contract("CAL-005", "an explicit Google conference failure stays failed and a retry requests a new conference identity", async () => {
  const { GoogleCalendarAdapter } = await loadModule("../src/core/platform/calendar/google.ts");
  let written;
  const failedConference = { createRequest: { status: { statusCode: "failure" } } };
  const adapter = new GoogleCalendarAdapter({ clientId: "client", clientSecret: "secret" }, async (input, init) => {
    if (String(input).includes("privateExtendedProperty")) return Response.json({ items: [{ id: "managed", etag: '"v1"', conferenceData: failedConference }] });
    written = JSON.parse(init.body);
    return Response.json({ id: "managed", updated: "2030-01-01T00:00:00.000Z", conferenceData: failedConference });
  });
  const result = await adapter.upsertManagedEvent("access", "primary", { bookingId: "one", occurrenceId: "current", idempotencyKey: "retry:new-command", icalUid: "stable@dial", title: "Synthetic", description: "Synthetic", location: "Google Meet", startAt: "2030-01-01T01:00:00.000Z", endAt: "2030-01-01T01:30:00.000Z", timeZone: "UTC", inviteeEmail: "invitee@dial.test", requestGoogleMeet: true });
  assert.equal(result.conferenceState, "failed");
  assert.equal(written.conferenceData.createRequest.requestId, "retry:new-command");
});
