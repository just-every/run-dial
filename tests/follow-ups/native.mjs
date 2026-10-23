import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export async function followUpProof(t) {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-follow-ups-")), config = "tests/follow-ups/worker.wrangler.toml", origin = "http://127.0.0.1:15917";
  let server, output = "", cookie;
  t.after(async () => { if (server?.exitCode === null) { const stopped = new Promise(done => server.once("exit", done)); process.kill(-server.pid, "SIGTERM"); await stopped; } await rm(persist, { recursive: true, force: true }); });
  await new Promise((done, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-follow-ups-test", "--local", "--persist-to", persist, "--config", config], { stdio: "pipe", env: { ...process.env, CI: "1" } });
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; }); child.once("error", reject); child.once("exit", code => code === 0 ? done() : reject(new Error(output)));
  });
  server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", config, "--ip", "127.0.0.1", "--port", "15917", "--inspector-port", "15927"], { stdio: "pipe", detached: true, env: { ...process.env, CI: "1" } });
  server.stdout.on("data", chunk => { output += chunk; }); server.stderr.on("data", chunk => { output += chunk; });
  for (let attempt = 0; ; attempt++) { if (server.exitCode !== null || attempt > 80) throw new Error(output); try { if ((await fetch(origin + "/api/calendar/oauth/callback?state=forged")).status === 400) break; } catch { /* native readiness */ } await new Promise(done => setTimeout(done, 125)); }
  async function call(path, body, status = 200, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(origin + path, { method, redirect: "manual", headers: { Origin: origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `${path}: ${await response.clone().text()}`); return response;
  }
  const data = async (...args) => { const response = await call(...args); return response.status === 204 ? null : response.json(); };
  const owner = await call("/auth/bootstrap", { token: "synthetic-dial-1704-at-least-thirty-two-characters", displayName: "Synthetic Dial 1702", returnTo: "/setup" }, 303); cookie = owner.headers.get("set-cookie").split(";")[0];
  await data("/api/app/profile", { handle: "synthetic-dial-1705", name: "Synthetic Dial 1705", title: "Host", biography: "Synthetic follow-up proof", timezone: "UTC", focusAreas: [], socialProof: [] }, 200, "PATCH"); await data("/api/app/mail/check", {});
  const event = await data("/api/app/event-types", { slug: "synthetic-dial-1706", title: "Synthetic Dial 1706", description: "A synthetic follow-up event", durationMinutes: 30, color: "#176b5a", locationType: "phone", locationLabel: "Call the host", locationValue: "+12025550170", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 201);
  await data(`/api/app/event-types/${event.id}/publish`, {});
  const settings = { enabled: true, kind: "thank_you", text: "Synthetic resource 1707 for {invitee full name}: {event name}.", offsetMinutes: 5, attendedOnly: false, targetEventTypeId: null }, settingPath = `/api/app/event-types/${event.id}/follow-up`;
  assert.equal((await data(settingPath)).enabled, false);
  for (const [text, reason] of [["{unknown}", "unknown"], ["{manage link}", "manage link"], ["https://example.test/manage/synthetic-dial-1708", "private manage link"]]) { const refused = await data(settingPath, { ...settings, text }, 400, "PUT"); assert.ok(refused.error.message.includes(reason)); }
  await data(settingPath, settings, 200, "PUT");
  const firstStart = new Date(Date.now() + 10 * 86400000); firstStart.setUTCHours(11, 0, 0, 0);
  const makeFor = async (eventTypeId, days, suffix) => data("/api/app/bookings", { idempotencyKey: randomUUID(), eventTypeId, startAt: new Date(firstStart.valueOf() + days * 86400000).toISOString(), inviteeTimezone: "UTC", name: `Synthetic Dial ${suffix}`, email: `synthetic-dial-${suffix}@example.test`, answers: {}, overrideNoticeAndHorizon: false }, 201);
  const make = (days, suffix) => makeFor(event.id, days, suffix);
  const facts = () => data("/__fixtures/follow-ups/facts"), history = id => data(`/api/app/bookings/${id}/follow-ups`), tick = now => data("/__fixtures/follow-ups/tick", { now }), deliver = now => data("/__fixtures/follow-ups/deliver", { now }), end = bookingId => data("/__fixtures/follow-ups/end", { bookingId }, 204);
  const messagesFor = (facts, suffix) => facts.messages.filter(mail => String(mail.text).includes(`Synthetic resource 1707 for Synthetic Dial ${suffix}`));
  const attended = await make(0, 1709); let runs = (await facts()).runs.filter(run => run.bookingId === attended.id); assert.equal(runs.length, 1);
  assert.equal(runs[0].dueAt, new Date(Date.parse(attended.occurrence.endAt) + settings.offsetMinutes * 60000).toISOString());
  await end(attended.id); await data(`/api/app/bookings/${attended.id}/attendance`, { status: "attended", note: "" });
  const due = runs[0].dueAt; await tick(new Date(Date.parse(due) - 1).toISOString()); await deliver(new Date(Date.parse(due) - 1).toISOString()); assert.equal(messagesFor(await facts(), 1709).length, 0);
  await tick(due); await tick(due); await deliver(due); await deliver(due); let sent = messagesFor(await facts(), 1709); assert.equal(sent.length, 1); assert.deepEqual(sent[0].to, ["synthetic-dial-1709@example.test"]); assert.doesNotMatch(JSON.stringify(sent), /\/manage\//); assert.equal((await history(attended.id))[0].outcome, "sent");
  const cancelled = await make(1, 1710); await data(`/api/app/bookings/${cancelled.id}/cancel`, {}); const cancelledRun = (await facts()).runs.find(run => run.bookingId === cancelled.id); await tick(cancelledRun.dueAt); await deliver(cancelledRun.dueAt); assert.equal(messagesFor(await facts(), 1710).length, 0); assert.equal((await history(cancelled.id))[0].reason, "booking_cancelled");
  await data(settingPath, { ...settings, attendedOnly: true }, 200, "PUT");
  const late = await make(2, 1711); await end(late.id); const lateRun = (await facts()).runs.find(run => run.bookingId === late.id); await tick(lateRun.dueAt); await deliver(lateRun.dueAt); assert.equal(messagesFor(await facts(), 1711).length, 0); assert.deepEqual((await history(late.id)).map(run => [run.outcome, run.reason]), [["skipped", "attendance_required"]]);
  await data(`/api/app/bookings/${late.id}/attendance`, { status: "attended", note: "" }); const afterMark = new Date(Date.parse(lateRun.dueAt) + 60000).toISOString(); await tick(afterMark); await tick(afterMark); await deliver(afterMark); assert.equal(messagesFor(await facts(), 1711).length, 1);
  const noShow = await make(3, 1712); await end(noShow.id); await data(`/api/app/bookings/${noShow.id}/attendance`, { status: "no_show", note: "" }); const noShowRun = (await facts()).runs.find(run => run.bookingId === noShow.id); await tick(noShowRun.dueAt); await deliver(noShowRun.dueAt); assert.equal(messagesFor(await facts(), 1712).length, 0); assert.equal((await history(noShow.id))[0].reason, "no_show");
  const moved = await make(4, 1713), originalRun = (await facts()).runs.find(run => run.bookingId === moved.id); const newStart = new Date(firstStart.valueOf() + 5 * 86400000).toISOString(); await data(`/api/app/bookings/${moved.id}/reschedule`, { startAt: newStart, inviteeTimezone: "UTC", overridePublishedAvailability: false }); runs = (await facts()).runs.filter(run => run.bookingId === moved.id); assert.equal(runs.length, 2); assert.equal(runs.find(run => run.id === originalRun.id).reason, "superseded_occurrence"); assert.equal(runs.find(run => run.state === "pending").dueAt, new Date(Date.parse(newStart) + (30 + settings.offsetMinutes) * 60000).toISOString());
  const erased = await make(6, 1714); await data(`/api/app/bookings/${erased.id}`, undefined, 202, "DELETE"); assert.ok(!(await facts()).runs.some(run => run.bookingId === erased.id), "the native fenced erasure deletes the run with the booking"); await tick(new Date(firstStart.valueOf() + 20 * 86400000).toISOString()); await deliver(new Date(firstStart.valueOf() + 20 * 86400000).toISOString()); assert.equal(messagesFor(await facts(), 1714).length, 0);
  for (const [kind, day, suffix] of [["rebooking",8,1715],["feedback",9,1716]]) {
    const other = await data("/api/app/event-types", { ...event, slug: `synthetic-dial-${suffix}` }, 201); await data(`/api/app/event-types/${other.id}/publish`, {});
    await data(`/api/app/event-types/${other.id}/follow-up`, { ...settings, kind, targetEventTypeId: kind === "rebooking" ? event.id : null }, 200, "PUT");
    const booking = await makeFor(other.id, day, suffix); await end(booking.id); const run = (await facts()).runs.find(run => run.bookingId === booking.id); await tick(run.dueAt); await deliver(run.dueAt);
    const messages = messagesFor(await facts(), suffix); assert.equal(messages.length, 1); assert.deepEqual(messages[0].to, [`synthetic-dial-${suffix}@example.test`]); assert.doesNotMatch(JSON.stringify(messages), /\/manage\//);
    if (kind === "rebooking") assert.ok(messages[0].text.includes(`/book/synthetic-dial-1705/${event.slug}`), "rebooking uses the published event URL, never a capability");
  }

}
