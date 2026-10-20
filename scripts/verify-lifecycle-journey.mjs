import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { evidencePath, externalEvidencePath } from "./evidence-path.mjs";
import { origin, startLifecycleRuntime } from "./lifecycle/runtime.mjs";
import { verifyConnectionResync } from "./lifecycle/connection-health.mjs";
import { lifecycleDoors } from "./lifecycle/doors.mjs";

// One booking lifecycle, in order, through Dial's public and operator doors. Each step checks what the invitee sees,
// what the operator sees and what reached the mail provider. Reminders, retries, connection alerts and calendar sync
// happen only on the scheduled passes rer runs from the declared Cron schedule (scripts/lifecycle/runtime.mjs).
const runtime = await startLifecycleRuntime();
const steps = [];
const pass = (name, facts = {}) => { steps.push({ name, at: new Date().toISOString(), ...facts }); console.log(`PASS ${name}`); };
let failure;
try {
  const d = lifecycleDoors(runtime);
  const { op, pub, raw, state, until, nextPass, book, record, sends, mailTo, reminderRows } = d;

  // 1. The operator connects the (synthetic) Google calendar through OAuth, checks mail and publishes.
  await d.signIn();
  await op("/api/app/profile", { handle: "lifecycle-host", name: "Lifecycle Host", title: "Advisor", biography: "A synthetic lifecycle workspace.", timezone: "UTC", focusAreas: [], socialProof: [] }, 200, "PATCH");
  await d.connectCalendar();
  const everyDay = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startMinute: 0, endMinute: 1440 }));
  const created = await op("/api/app/event-types", { slug: "lifecycle", title: "Lifecycle session", description: "Thirty minutes, booked through every step of its lifecycle.", durationMinutes: 30, color: "#176b5a", locationType: "google_meet", locationLabel: "Google Meet", locationValue: "", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 5, minimumNoticeMinutes: 0, bookingHorizonDays: 30, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: everyDay }, 201);
  assert.equal((await op(`/api/app/event-types/${created.id}/publish`, {})).status, "published");
  assert.equal((await op("/api/app/calendar/connection")).state, "healthy");
  assert.equal((await pub("/api/public/events/lifecycle-host/lifecycle")).eventType.title, "Lifecycle session");
  assert.equal(sends(await state()).length, 0);
  pass("operator connects the synthetic Google calendar through OAuth, checks mail and publishes; the public page lists the event", { scheduledCrons: runtime.crons });

  // The reminder-timing booking: about 62 minutes ahead, so its 1-hour reminder falls due within minutes.
  const soon = (await d.slots(0)).find(slot => Date.parse(slot.startAt) >= Date.now() + 61.5 * 60_000);
  const early = await book(soon, "Ellis Early", "early@dial.test");
  const earlyDueAt = Date.parse(soon.startAt) - 60 * 60_000;
  const earlyReminders = reminderRows(await state(), early.id);
  assert.deepEqual(earlyReminders.map(row => (Date.parse(soon.startAt) - Date.parse(row.next_attempt_at)) / 60_000), [60, 60], "only the 1-hour offset is still in the future, for invitee and operator");
  assert.ok((await record(early.id)).deliveries.filter(delivery => delivery.kind === "reminder").every(delivery => delivery.state === "pending"));
  pass("a public booking about 62 minutes ahead schedules only its 1-hour reminders", { startAt: soon.startAt, reminderDueAt: new Date(earlyDueAt).toISOString() });

  // 2. Two invitees race for one slot: exactly one confirmation, the other is returned to choose a time.
  const later = await d.slots(3);
  const contested = later[0];
  const [first, second] = await Promise.all(["avery@dial.test", "blake@dial.test"].map(email => d.select(contested, email)));
  const outcomes = await Promise.all([first, second].map(payload => d.confirm(payload)));
  const winnerIndex = outcomes.findIndex(outcome => outcome.status === 201);
  assert.equal(outcomes.filter(outcome => outcome.status === 201).length, 1);
  const loserOutcome = outcomes[1 - winnerIndex];
  assert.equal(loserOutcome.status, 409); assert.equal(loserOutcome.body.error.code, "slot_taken");
  const winner = { payload: [first, second][winnerIndex], email: [first, second][winnerIndex].email, receipt: outcomes[winnerIndex].body };
  const loser = { payload: [first, second][1 - winnerIndex], email: [first, second][1 - winnerIndex].email };
  assert.ok(!(await d.slots(3)).some(slot => slot.startAt === contested.startAt), "the choose-time step no longer offers the taken slot");
  winner.token = d.token(winner.receipt); winner.id = await d.bookingIdFor(winner.email);
  assert.equal((await state()).bookings.filter(row => row.invitee_email === loser.email).length, 0);
  await until("the winner's confirmations", async () => mailTo(await state(), winner.email, /^Confirmed:/).length === 1 && mailTo(await state(), "operator@dial.test", /^New booking:/).length === 2);
  assert.equal(mailTo(await state(), loser.email).length, 0, "the losing invitee is sent nothing");
  assert.equal((await record(winner.id)).state, "confirmed");
  pass("two invitees race for one slot: one confirmation and its mail, the other gets slot_taken and the slot leaves the choose-time list");

  // 3. The winner reschedules; the other invitee books a different time.
  await until("the winner's calendar event", async () => (await record(winner.id)).calendarState === "succeeded");
  const icsBefore = await d.ics(winner.token);
  assert.match(icsBefore, /\r\nSEQUENCE:0\r\n/);
  const firstOccurrence = (await record(winner.id)).occurrence.id;
  // Fifteen minutes later: the new time overlaps the booking's own current time and its own managed event.
  const target = later.find(slot => Date.parse(slot.startAt) === Date.parse(contested.startAt) + 15 * 60_000);
  const moved = await d.reschedule(winner.token, target, "Lifecycle reschedule");
  assert.equal(moved.state, "rescheduled");
  const winnerView = await pub(`/api/public/manage/${winner.token}`);
  assert.equal(winnerView.occurrence.startAt, target.startAt);
  const icsAfter = await d.ics(winner.token);
  assert.match(icsAfter, /\r\nSEQUENCE:1\r\n/);
  assert.equal(/UID:(.+)\r\n/.exec(icsAfter)[1], /UID:(.+)\r\n/.exec(icsBefore)[1], "the iCalendar UID is stable across the reschedule");
  let operatorView = await record(winner.id);
  assert.equal(operatorView.occurrence.sequence, 1); assert.notEqual(operatorView.occurrence.id, firstOccurrence);
  assert.ok(operatorView.history.some(entry => entry.action === "rescheduled"));
  let snapshot = await state();
  assert.equal(snapshot.booking_occurrences.filter(row => row.booking_id === winner.id && row.is_current).length, 1);
  assert.ok(snapshot.booking_occurrences.some(row => row.id === firstOccurrence && !row.is_current), "the original occurrence is closed");
  const replaced = snapshot.delivery_outbox.filter(row => row.booking_id === winner.id && row.kind === "reminder");
  assert.ok(replaced.filter(row => row.occurrence_id === firstOccurrence).every(row => row.state === "failed" && row.last_error_code === "superseded_occurrence"));
  assert.deepEqual(replaced.filter(row => row.occurrence_id === operatorView.occurrence.id).map(row => (Date.parse(target.startAt) - Date.parse(row.next_attempt_at)) / 3_600_000).sort((a, b) => a - b), [1, 1, 24, 24]);
  await until("the reschedule notices", async () => mailTo(await state(), winner.email, /^Rescheduled:/).length === 1 && mailTo(await state(), "operator@dial.test", /^Rescheduled:/).length === 1);
  await until("the moved calendar event", async () => (await record(winner.id)).calendarState === "succeeded");
  snapshot = await state();
  const winnerEvent = d.calendarEvent(snapshot, winner.id);
  assert.equal(winnerEvent.start.dateTime, target.startAt); assert.equal(d.calendarEvents(snapshot, winner.id).length, 1, "the same managed event moved");
  const other = later.find(slot => Date.parse(slot.startAt) >= Date.parse(target.startAt) + 2 * 3_600_000);
  const loserBooking = await book(other, "Blake Other", loser.email);
  await until("the other invitee's confirmations", async () => mailTo(await state(), loser.email, /^Confirmed:/).length === 1);
  pass("the winner reschedules onto a time overlapping its own: original occurrence closed, reminders replaced, .ics SEQUENCE 0 to 1 with the same UID, one moved event; the other invitee books a different time");

  // 4. The winner cancels: the slot is released and pending reminders are removed, once.
  await d.cancel(winner.token, "Lifecycle cancellation");
  assert.equal((await pub(`/api/public/manage/${winner.token}`)).state, "cancelled");
  assert.ok((await d.slots(3)).some(slot => slot.startAt === target.startAt), "the cancelled time is offered again");
  operatorView = await record(winner.id);
  assert.equal(operatorView.state, "cancelled");
  assert.ok(operatorView.deliveries.filter(delivery => delivery.kind === "reminder").every(delivery => delivery.state !== "pending" && delivery.state !== "processing"), "no reminder remains scheduled");
  await until("the cancellation notices", async () => mailTo(await state(), winner.email, /^Booking cancelled:/).length === 1 && mailTo(await state(), "operator@dial.test", /^Booking cancelled:/).length === 1);
  await d.cancel(winner.token, "Lifecycle cancellation");
  await nextPass();
  snapshot = await state();
  assert.equal(mailTo(snapshot, winner.email, /^Booking cancelled:/).length, 1, "a repeated cancellation sends nothing more");
  await until("the cancelled calendar event", async () => d.calendarEvent(await state(), winner.id).status === "cancelled");
  pass("the winner cancels: slot offered again, reminders tombstoned, one cancellation notice each, repeat cancel changes nothing");

  // 5. A replayed confirmation creates nothing new.
  const before = await state();
  const replay = await d.confirm(loserBooking.payload);
  assert.equal(replay.status, 200); assert.equal(replay.body.manageUrl, loserBooking.receipt.manageUrl);
  assert.equal((await d.confirm({ ...loserBooking.payload, name: "Someone else" })).status, 409);
  const winnerReplay = await d.confirm(winner.payload);
  assert.equal(winnerReplay.status, 200); assert.equal(winnerReplay.body.manageUrl, winner.receipt.manageUrl);
  await nextPass();
  const after = await state();
  assert.equal(after.bookings.length, before.bookings.length); assert.equal(after.wire_events.length, before.wire_events.length);
  assert.equal(sends(after).length, sends(before).length);
  pass("replayed confirmation nonces return the stored receipts; a changed payload is refused; no booking, event or mail is added");

  // 6. NOTIFY-007, timed from the failure's onset. The scheduler's pass runs at the start of each minute, the connection
  // watch probes 30 s after each healthy health check (so at about the half minute), and a request, pass or probe that sees
  // a healthy connection fail starts an incident, re-checked 10 s and confirmed 20 s later, so each failure below starts
  // at a chosen second to fall on one side of the pass or the other.
  const alertCount = async () => mailTo(await state(), "operator@dial.test", /^Calendar connection needs attention$/).length;
  const recoveredCount = async () => mailTo(await state(), "operator@dial.test", /^Calendar connection recovered$/).length;
  const week = async () => (await pub(`/api/public/book/lifecycle-host/lifecycle/availability?week=${d.day(5)}&inviteeTimezone=UTC`)).state;

  // 6a. A brief read error that spans a scheduled pass sends nothing: the pass sees the failure, hands it to the confirmation
  // check and does not alert; the error clears before that check, which finds the calendar healthy.
  const blipSlot = (await d.slots(6))[0];
  await d.atSecond(48);
  await d.wire("google-read-status", 503);
  const blipAt = Date.now();
  assert.equal((await d.selectRaw(blipSlot)).status, 503);
  assert.equal((await op("/api/app/calendar/connection")).state, "unhealthy");
  const spanned = await d.passAfter(blipAt);
  await d.sleep(3_000);
  assert.equal(await alertCount(), 0, "the scheduled pass that sees the failure does not alert");
  await d.wire("google-read-status", 0);
  await until("the confirmation check to find the calendar healthy", async () => (await op("/api/app/calendar/connection")).state === "healthy", 45_000);
  const blipMs = Date.now() - blipAt;
  await nextPass(); await d.sleep(3_000);
  assert.equal(await alertCount(), 0, "a brief error that spans the pass sends no alert");
  assert.equal(await recoveredCount(), 0, "and no recovery notice");
  pass("a brief calendar read error spanning a scheduled pass sends no alert and no recovery notice", { failedAt: new Date(blipAt).toISOString(), passStartedAt: new Date(d.passStart(spanned)).toISOString(), confirmedHealthyAfterMs: blipMs });

  // 6b. A persistent error seen by a request first: the pass in between sends nothing, the confirmation check alerts once
  // inside NOTIFY-007's 60 seconds, a second failure in the same incident sends nothing more, and recovery is announced once.
  const probe = (await d.slots(5))[0];
  await d.atSecond(48);
  await d.wire("google-read-status", 503);
  const failedAt = Date.now();
  const refused = await d.selectRaw(probe);
  assert.equal(refused.status, 503); assert.deepEqual(refused.body, { state: "temporarily_unavailable", provider: "calendar_provider_unavailable", slots: [] });
  assert.equal(await week(), "temporarily_unavailable");
  assert.equal((await op("/api/app/calendar/connection")).state, "unhealthy");
  await d.passAfter(failedAt); await d.sleep(3_000);
  assert.equal(await alertCount(), 0, "the pass between the failing request and its confirmation alerts nothing");
  const alert = await until("the connection alert", async () => mailTo(await state(), "operator@dial.test", /^Calendar connection needs attention$/)[0], 90_000);
  const alertLatency = Date.parse(alert.at) - failedAt;
  assert.ok(alertLatency < 60_000, `the alert reaches the mail provider within 60 s of the failing request (${alertLatency}ms)`);
  assert.match(d.text(alert), /Reconnect or correct the provider configuration in Settings/);
  assert.equal((await d.selectRaw(probe)).status, 503, "a second failure in the same incident");
  await nextPass(); await d.sleep(3_000);
  assert.equal(await alertCount(), 1, "a second failure in the same incident sends nothing more");
  await d.wire("google-read-status", 0);
  await until("the recovery announcement", async () => await recoveredCount() === 1, 90_000);
  assert.equal((await op("/api/app/calendar/connection")).state, "healthy");
  assert.equal(await week(), "available");
  await nextPass(); await d.sleep(3_000);
  assert.equal(await recoveredCount(), 1);
  pass("a persistent calendar read failure alerts once within 60 s of the failing request, not at the pass in between; a second failure sends nothing more; one recovery", { alertLatencyMs: alertLatency });

  // 6b continued. A new incident that no request sees, starting just after a scheduled pass: the worst phase, with the next probe
  // 30 s away and the next pass a minute. Only free/busy over the conflict calendar fails (unshared or deleted), so only a
  // probe that reads what the health check reads sees it; the confirmation alerts once, within 60 s of the onset.
  await nextPass(); await d.atSecond(2);
  const unseenAt = Date.now();
  await d.wire("google-busy-error", 1);
  const again = await until("the alert for the incident no request saw", async () => mailTo(await state(), "operator@dial.test", /^Calendar connection needs attention$/)[1], 90_000);
  const onsetLatency = Date.parse(again.at) - unseenAt;
  assert.ok(onsetLatency < 60_000, `a failure no request sees alerts within 60 s of its onset (${onsetLatency}ms)`);
  const firstSeen = (await state()).wire_calls.find(row => new URL(row.url).pathname.endsWith("/freeBusy") && Date.parse(row.at) >= unseenAt);
  await nextPass(); await d.sleep(3_000);
  assert.equal(await alertCount(), 2, "one alert for the incident");
  await d.wire("google-busy-error", 0);
  await until("the second recovery announcement", async () => await recoveredCount() === 2, 90_000);
  await nextPass(); await d.sleep(3_000);
  assert.equal(await recoveredCount(), 2);
  pass("a new incident that no request sees, only free/busy over the conflict calendar failing, starting just after a scheduled pass, alerts once within 60 s of its onset", { failedAt: new Date(unseenAt).toISOString(), firstSeenAfterMs: Date.parse(firstSeen.at) - unseenAt, onsetLatencyMs: onsetLatency });

  // 6c. CAL-006: Google refuses the token refresh, as after the owner revokes access: only a new consent can restore the connection.
  const tokenCalls = snap => snap.wire_calls.filter(row => new URL(row.url).hostname === "oauth2.googleapis.com").length;
  const healthBeforeRevocation = new Set((await state()).calendar_connection_health_changes.map(row => row.id));
  await d.wire("google-refresh-refused", 1);
  const revoked = await until("reauthorization required", async () => { const connection = await op("/api/app/calendar/connection"); return connection.state === "unhealthy" && connection.reason === "reauthorization_required" ? connection : undefined; }, 180_000);
  assert.equal((await pub(`/api/public/book/lifecycle-host/lifecycle/availability?week=${d.day(5)}&inviteeTimezone=UTC`)).state, "temporarily_unavailable");
  const named = await until("the reauthorization alert", async () => mailTo(await state(), "operator@dial.test", /^Calendar connection needs attention$/)[2], 150_000);
  assert.match(d.text(named), /reauthorization_required/);
  const refreshes = tokenCalls(await state());
  await nextPass();
  assert.equal(tokenCalls(await state()), refreshes, "no refresh is attempted again until the owner reconnects");
  assert.equal(mailTo(await state(), "operator@dial.test", /^Calendar connection needs attention$/).length, 3);
  await d.wire("google-refresh-refused", 0);
  const reconsent = new URL((await raw("/api/app/calendar/oauth/start", undefined, 302)).headers.get("location"));
  await raw(`/api/calendar/oauth/callback?code=wire-consent&state=${encodeURIComponent(reconsent.searchParams.get("state"))}`, undefined, 302);
  await op("/api/app/calendar/check", {});
  assert.equal((await op("/api/app/calendar/connection")).destinationCalendarId, "synthetic-calendar", "reconnecting keeps the destination selection");
  await until("the third recovery announcement", async () => mailTo(await state(), "operator@dial.test", /^Calendar connection recovered$/).length === 3, 90_000);
  assert.equal(await week(), "available");
  pass("Google refuses the token refresh: Settings names reauthorization_required, one alert names it, booking fails closed and no refresh is retried; a new consent keeps the selection and announces recovery once", { reason: revoked.reason });
  const transitions = (await state()).calendar_connection_health_changes.filter(row => !healthBeforeRevocation.has(row.id));
  assert.deepEqual(transitions.map(row => [row.from_state, row.to_state, row.reason]), [
    ["healthy", "unhealthy", "reauthorization_required"], ["unhealthy", "healthy", "connection_restored"],
  ]);
  assert.ok(transitions.every(row => row.event_type === "calendar.connection-health-changed.v1" && Number.isFinite(Date.parse(row.occurred_at))));
  const recent = (await op("/api/app/calendar/connection")).recentChanges;
  assert.ok(transitions.every(row => recent.some(change => change.id === row.id && change.reason === row.reason)));
  await verifyConnectionResync(d, pass);


  // 7. Mail delivery is throttled once and retried on a scheduled pass, without a duplicate.
  await d.wire("mail-rate-limited:casey@dial.test", 1);
  const casey = await book((await d.slots(6))[0], "Casey Retry", "casey@dial.test");
  const throttled = await until("the throttled delivery", async () => (await state()).delivery_outbox.find(row => row.booking_id === casey.id && row.kind === "mail_send" && row.last_error_code === "quota_exhausted"));
  assert.equal(throttled.state, "pending"); assert.equal(throttled.attempts, 1);
  const throttledView = (await record(casey.id)).deliveries.find(delivery => delivery.id === throttled.id);
  assert.equal(throttledView.state, "pending"); assert.equal(throttledView.lastErrorCode, "quota_exhausted");
  assert.equal((await pub(`/api/public/manage/${casey.token}`)).state, "confirmed");
  const retried = await until("the retried delivery", async () => (await state()).delivery_outbox.find(row => row.id === throttled.id && row.state === "succeeded"), 150_000);
  assert.equal(retried.attempts, 2);
  assert.ok(Date.parse(retried.succeeded_at) >= Date.parse(throttled.next_attempt_at), "the retry waited for its backoff");
  assert.ok(runtime.passes.some(run => run.ok && Date.parse(run.at) >= Date.parse(throttled.next_attempt_at) && Date.parse(run.at) <= Date.parse(retried.succeeded_at) + 5_000), "a scheduled pass made the retry");
  snapshot = await state();
  const throttledCalls = d.callsFor(snapshot, throttled);
  assert.equal(throttledCalls.length, 2, "one throttled call and one accepted call");
  assert.equal(snapshot.base_mail_dispatch.find(row => row.delivery_id === throttledCalls[0].custom_args.rer_delivery_id).state, "accepted");
  assert.equal(mailTo(snapshot, "casey@dial.test", /^Confirmed:/).length, 1, "the invitee has exactly one confirmation");
  pass("a throttled confirmation retries on the next scheduled pass after its backoff and is delivered once", { throttledAttemptAt: throttled.updated_at, retriedAt: retried.succeeded_at });

  // 8. The managed event is deleted in Google: the booking cancels once, found by the scheduled calendar sync.
  await until("Casey's calendar event", async () => (await record(casey.id)).calendarState === "succeeded");
  const deleted = d.calendarEvent(await state(), casey.id);
  // Google's tombstone: the cancelled status without the event's last update time.
  const tombstone = { ...deleted, status: "cancelled" };
  delete tombstone.updated;
  await d.wireEvent(deleted.id, tombstone);
  await until("the external cancellation", async () => (await pub(`/api/public/manage/${casey.token}`)).state === "cancelled", 180_000);
  operatorView = await record(casey.id);
  assert.equal(operatorView.state, "cancelled");
  assert.equal(operatorView.history.filter(entry => entry.action === "cancelled").length, 1);
  await until("the provider cancellation notices", async () => mailTo(await state(), "casey@dial.test", /^Booking cancelled:/).length === 1 && mailTo(await state(), "operator@dial.test", /^Booking cancelled:/).length === 2);
  assert.match(d.text(mailTo(await state(), "casey@dial.test", /^Booking cancelled:/)[0]), /by the connected calendar/);
  await nextPass();
  snapshot = await state();
  assert.equal(mailTo(snapshot, "casey@dial.test", /^Booking cancelled:/).length, 1, "a later sync pass cancels nothing twice");
  assert.equal(snapshot.booking_history.filter(row => row.booking_id === casey.id && row.action === "cancelled").length, 1);
  pass("deleting the managed event in Google cancels the booking once on a scheduled sync pass, with one notice each");

  // Reminder timing: the 1-hour reminders reach the provider within 5 minutes of their offset, never before; the
  // 24-hour reminder of a later booking stays scheduled and unsent.
  const reminders = await until("the 1-hour reminders", async () => {
    const found = ["early@dial.test", "operator@dial.test"].map(async email => mailTo(await state(), email, /^Reminder: Lifecycle session$/));
    const [invitee, host] = await Promise.all(found);
    return invitee.length === 1 && host.length >= 1 ? [invitee[0], ...host] : undefined;
  }, Math.max(0, earlyDueAt + 5 * 60_000 - Date.now()) + 10_000);
  const lateness = reminders.map(mail => Date.parse(mail.at) - earlyDueAt);
  assert.ok(lateness.every(ms => ms >= 0 && ms <= 5 * 60_000), `reminders reached the provider ${lateness.join(", ")}ms after their offset`);
  snapshot = await state();
  const laterReminders = reminderRows(snapshot, loserBooking.id).filter(row => Date.parse(other.startAt) - Date.parse(row.next_attempt_at) === 24 * 3_600_000);
  assert.equal(laterReminders.length, 2);
  assert.ok(laterReminders.every(row => row.state === "pending" && Date.parse(row.next_attempt_at) > Date.now()));
  assert.equal(mailTo(snapshot, loser.email, /^Reminder:/).length, 0, "nothing is sent early");
  assert.ok((await record(loserBooking.id)).deliveries.filter(delivery => delivery.kind === "reminder").every(delivery => delivery.state === "pending"));
  pass("the 1-hour reminders reach the provider within 5 minutes of their offset with no manual trigger; a later booking's 24-hour reminders stay scheduled", { reminderDueAt: new Date(earlyDueAt).toISOString(), latenessMs: lateness });

  // No mail reached the provider twice: each delivery has one call, the throttled one a refused call and an accepted one.
  snapshot = await state();
  const calls = new Map();
  for (const mail of sends(snapshot)) calls.set(mail.custom_args.rer_delivery_id, (calls.get(mail.custom_args.rer_delivery_id) ?? 0) + 1);
  assert.deepEqual([...calls.entries()].filter(([, count]) => count > 1).map(([id, count]) => [id, count]), [[throttledCalls[0].custom_args.rer_delivery_id, 2]]);
  assert.equal(d.delivered(snapshot).length, calls.size, "SendGrid accepted every mail Dial sent");
  assert.ok(runtime.passes.length > 0 && runtime.passes.every(run => run.ok), "every scheduled pass succeeded");
  pass("every mail reached the provider once", { mails: calls.size, scheduledPasses: runtime.passes.length });
} catch (error) { failure = error; }
const output = runtime.output();
await runtime.stop();
const result = { verifiedAt: new Date().toISOString(), origin, ok: !failure, providers: "production Google adapter and Base SendGrid sender over synthetic provider HTTP", scheduler: "rer's runScheduled over the Cron schedule declared in wrangler.jsonc", steps, scheduledPasses: runtime.passes, ...(failure ? { failure: String(failure.stack ?? failure), workerOutput: output.slice(-6000) } : {}) };
await writeFile(process.env.DIAL_EVIDENCE_FILE ? externalEvidencePath(process.env.DIAL_EVIDENCE_FILE) : evidencePath("lifecycle-journey.json"), JSON.stringify(result, null, 2) + "\n");
if (failure) { console.error(output.slice(-6000)); throw failure; }
console.log(`Lifecycle journey passed: ${steps.length} steps, ${runtime.passes.length} scheduled passes.`);
