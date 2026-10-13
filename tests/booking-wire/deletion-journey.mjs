import assert from "node:assert/strict";
import { wireMail } from "./mail-contracts.mjs";

export async function deletionJourney({ data, state, book, deliver, checks }) {
  const variants = [
    { name: "missing-404", status: 404, code: "event_missing" },
    { name: "purged-410", status: 410, code: "event_missing" },
    { name: "forbidden-403", status: 403, code: "forbidden" },
    { name: "incomplete-list", list: "paginated", code: "ambiguous_events" },
    { name: "malformed-list", list: "malformed", code: "ambiguous_events" },
    { name: "multiple-live-replacements", replacements: 2, code: "ambiguous_events" },
    { name: "live-replacement", replacements: 1, resolution: "present" },
  ];
  for (const [index, variant] of variants.entries()) {
    const number = 44 + index;
    const booked = await book(number); await deliver();
    let snap = await state();
    const booking = snap.bookings.find(row => row.invitee_email === `wire${number}@dial.test`);
    const event = JSON.parse(snap.wire_events.find(row => row.id === booking.calendar_provider_event_id).payload);
    if (variant.status) await data("/wire/control", { name: `google-get-status:${event.id}`, value: variant.status });
    if (variant.list) await data("/wire/control", { name: `google-list-mode:${booking.id}`, value: variant.list });
    for (let copy = 0; copy < (variant.replacements || 0); copy++) {
      const id = `${copy ? "b" : "a"}${event.id}`;
      await data("/wire/event", { id, payload: { ...event, id, updated: new Date(Date.now() + 1000).toISOString() } });
    }
    const before = snap.wire_calls.length, mailsBefore = wireMail(snap).length;
    await data("/wire/delete", { id: event.id });
    snap = await state();
    assert.equal((await data(`/api/public/manage/${booked.token}`)).state, "confirmed", variant.name);
    assert.equal(wireMail(snap).length, mailsBefore, `${variant.name} cannot send a cancellation`);
    const probe = snap.calendar_deletion_probes.find(row => row.booking_id === booking.id);
    assert.ok(probe, variant.name);
    assert.equal(probe.state, variant.resolution ? "resolved" : "pending", variant.name);
    if (variant.code) assert.equal(probe.last_error_code, variant.code, variant.name);
    if (variant.resolution) {
      assert.equal(probe.resolution, "present");
      assert.ok(snap.delivery_outbox.some(row => row.booking_id === booking.id && row.idempotency_key.includes("repair")), "replacement is repaired, not silently adopted");
    }
    const calls = snap.wire_calls.slice(before);
    assert.ok(calls.some(row => row.method === "GET" && new URL(row.url).pathname.endsWith(`/events/${event.id}`)), `${variant.name} uses production Google inspection`);
    assert.equal(calls.some(row => new URL(row.url).searchParams.get("showDeleted") === "false"), !variant.status, `${variant.name} authoritative list only follows a positive tombstone`);
    // Restore the provider's canonical object, then resolve the pending wake-up.
    // These are provider fixtures only: production D1 booking state is never rewritten.
    await data("/wire/control", { name: `google-get-status:${event.id}`, value: 0 });
    await data("/wire/control", { name: `google-list-mode:${booking.id}`, value: 0 });
    for (let copy = 0; copy < (variant.replacements || 0); copy++) await data("/wire/event", { id: `${copy ? "b" : "a"}${event.id}`, remove: true });
    await data("/wire/event", { id: event.id, payload: event });
    await deliver();
    checks.push(`production Google deletion inspection preserves booking for ${variant.name}`);
  }
}
