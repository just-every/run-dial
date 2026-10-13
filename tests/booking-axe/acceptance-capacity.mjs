import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function capacityAudit(owner, origin, fixture, checks) {
  const headers = { Origin: origin };
  const request = async (method, path, data, expected = 200) => {
    const response = await owner.request[method](origin + path, { headers, data });
    assert.equal(response.status(), expected, `${method} ${path}: ${await response.text()}`);
    return response.json();
  };
  const event = await request("get", `/api/app/event-types/${fixture.eventId}`);
  const input = { ...event, questions: event.questions, availability: event.availability };
  // Seed through the owner routes: every stored entity is ordinary application data.
  const existing = await request("get", "/api/app/event-types");
  for (let index = existing.length; index < 100; index++) {
    await request("post", "/api/app/event-types", { ...input, slug: `capacity-${index}`, title: `Capacity event ${index}` }, 201);
  }
  assert.equal((await request("get", "/api/app/event-types")).length, 100);
  const day = new Date(Date.now() + 10 * 86400000);
  for (let index = 0; index < 1000; index++) {
    const date = new Date(day.valueOf() + index * 86400000).toISOString().slice(0, 10);
    await request("put", `/api/app/event-types/${event.id}/availability-overrides/${date}`, { mode: "open", windows: [{ startMinute: 0, endMinute: 1440 }] });
  }
  assert.equal((await request("get", `/api/app/event-types/${event.id}/availability-overrides`)).length, 1000);
  const availabilityPath = `/api/public/book/dial-host/intro/availability?week=${day.toISOString().slice(0, 10)}&inviteeTimezone=UTC`;
  const durations = [];
  let available;
  for (let run = 0; run < 20; run++) {
    const start = performance.now(); available = await request("get", availabilityPath); durations.push(performance.now() - start);
  }
  assert.ok(available.slots.length > 0, "capacity fixture offers actual bookable slots");
  const ordered = [...durations].sort((a, b) => a - b);
  checks.push({ check: "AVAIL-008: 100 event types; 1000 overrides; 20 one-week requests", passed: Math.max(...durations) < 2000, p50Ms: ordered[9], p95Ms: ordered[18], maxMs: ordered[19], durations });
  assert.ok(Math.max(...durations) < 2000, "each one-week availability request finishes below 2 seconds");
  const slot = available.slots[0];
  const start = performance.now();
  const claims = await Promise.all(Array.from({ length: 50 }, (_, index) => owner.request.post(origin + "/api/app/bookings", { headers, data: {
    idempotencyKey: randomUUID(), eventTypeId: event.id, startAt: slot.startAt, inviteeTimezone: "UTC", name: `Concurrent invitee ${index}`, email: `capacity-${index}@dial.test`, answers: Object.fromEntries(event.questions.map(question => [question.key, "Capacity proof"])), overrideNoticeAndHorizon: false,
  } })));
  const results = await Promise.all(claims.map(async response => ({ status: response.status(), body: await response.json() })));
  const wins = results.filter(result => result.status === 201);
  const refusals = results.filter(result => result.status === 409);
  checks.push({ check: "50 simultaneous authenticated claims for the same slot", passed: wins.length === 1 && refusals.length === 49, winners: wins.length, refusals: refusals.length, durationMs: performance.now() - start, statuses: results.map(result => result.status), refusalCodes: [...new Set(refusals.map(result => result.body.error?.code ?? result.body.code))] });
  assert.equal(wins.length, 1); assert.equal(refusals.length, 49);
  assert.ok(refusals.every(result => ["slot_taken", "slot_unavailable"].includes(result.body.error?.code)), "every loser has a clean native slot refusal");
  // Independently read the list: a response tally alone does not prove uniqueness.
  const records = await request("get", `/api/app/bookings?eventTypeId=${event.id}`);
  assert.equal(records.filter(record => record.occurrence.startAt === slot.startAt && record.state !== "cancelled").length, 1);
  const cancelledAt = performance.now();
  await request("post", `/api/app/bookings/${wins[0].body.id}/cancel`, {});
  const after = await request("get", availabilityPath);
  const releaseMs = performance.now() - cancelledAt;
  const released = after.slots.some(candidate => candidate.startAt === slot.startAt);
  checks.push({ check: "BOOK-008: cancelled slot is offered again", passed: released && releaseMs < 5000, durationMs: releaseMs });
  assert.ok(released && releaseMs < 5000);
}
