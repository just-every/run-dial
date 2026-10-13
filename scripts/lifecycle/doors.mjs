import assert from "node:assert/strict";
import { origin } from "./runtime.mjs";

// The doors the lifecycle journey uses: operator and public HTTP routes, the synthetic provider's controls and the
// provider-side record of what reached Google and SendGrid. Nothing here runs a delivery or a scheduled pass.
export function lifecycleDoors(runtime) {
  let cookie;
  const raw = async (path, body, expected, method = body === undefined ? "GET" : "POST", session = true) => {
    const response = await fetch(origin + path, { method, redirect: "manual", headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(session && cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (expected !== undefined) assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
    return response;
  };
  const op = async (path, body, expected = 200, method) => (await raw(path, body, expected, method)).json();
  const pub = async (path, body, expected = 200, method) => (await raw(path, body, expected, method, false)).json();
  const attempt = async (path, body) => { const response = await raw(path, body, undefined, "POST", false); return { status: response.status, body: await response.json() }; };
  const state = async () => (await fetch(`${origin}/wire/state`)).json();
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  async function until(description, check, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (!runtime.alive()) throw new Error(`the runtime exited while waiting for ${description}\n${runtime.output()}`);
      const value = await check();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${description}`);
      await sleep(500);
    }
  }
  const nextPass = () => { const after = Date.now(); return until("the next scheduled pass", async () => runtime.passes.some(run => Date.parse(run.at) > after), 75_000); };
  // The scheduler fires at the start of each minute, so a step that must fall between two passes waits for a second of the minute.
  const atSecond = second => sleep(((second * 1000 - Date.now() % 60_000) + 60_000) % 60_000);
  const passStart = run => Date.parse(run.at) - (run.ms ?? 0);
  const passAfter = after => until("a scheduled pass that started after the failure", async () => runtime.passes.find(run => run.ok && passStart(run) > after), 75_000);
  const day = days => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const slots = async days => {
    const week = await pub(`/api/public/book/lifecycle-host/lifecycle/availability?week=${day(days)}&inviteeTimezone=UTC`);
    assert.equal(week.state, "available");
    return week.slots;
  };
  const selectRaw = slot => attempt("/api/public/book/lifecycle-host/lifecycle/selection", { startAt: slot.startAt, inviteeTimezone: "UTC" });
  async function select(slot, email, name = email.split("@")[0]) {
    const selection = await selectRaw(slot);
    assert.equal(selection.status, 201, JSON.stringify(selection.body));
    return { nonce: selection.body.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", name, email, answers: {} };
  }
  const confirm = payload => attempt("/api/public/book/lifecycle-host/lifecycle/confirm", payload);
  const token = receipt => new URL(receipt.manageUrl).pathname.split("/").at(-1);
  const bookingIdFor = async email => (await state()).bookings.find(row => row.invitee_email === email).id;
  async function book(slot, name, email) {
    const payload = await select(slot, email, name), outcome = await confirm(payload);
    assert.equal(outcome.status, 201, JSON.stringify(outcome.body));
    return { id: await bookingIdFor(email), token: token(outcome.body), receipt: outcome.body, payload, email };
  }
  async function reschedule(manage, slot, reason) {
    const selection = await pub(`/api/public/manage/${manage}/reschedule/selection`, { startAt: slot.startAt, inviteeTimezone: "UTC" }, 201);
    return pub(`/api/public/manage/${manage}/reschedule`, { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", reason });
  }
  const cancel = (manage, reason) => pub(`/api/public/manage/${manage}/cancel`, { reason });
  const ics = async manage => (await (await raw(`/api/public/manage/${manage}/calendar.ics`, undefined, 200, "GET", false)).text()).replaceAll("\r\n ", "");
  const record = id => op(`/api/app/bookings/${id}`);
  // Every call to SendGrid's send endpoint, and the mail SendGrid accepted: the last call of each delivery whose Base
  // dispatch record is accepted, so a throttled attempt that was retried counts once.
  const sends = snapshot => snapshot.wire_calls.filter(row => new URL(row.url).pathname === "/v3/mail/send").map(row => ({ ...JSON.parse(row.body), at: row.at }));
  const delivered = snapshot => {
    const accepted = new Set(snapshot.base_mail_dispatch.filter(row => row.state === "accepted").map(row => row.delivery_id));
    return [...new Map(sends(snapshot).map(mail => [mail.custom_args.rer_delivery_id, mail])).values()].filter(mail => accepted.has(mail.custom_args.rer_delivery_id));
  };
  const recipients = mail => mail.personalizations.flatMap(item => item.to.map(to => to.email));
  const mailTo = (snapshot, email, subject = /./) => delivered(snapshot).filter(mail => recipients(mail).includes(email) && subject.test(mail.subject));
  const text = mail => mail.content.find(part => part.type === "text/plain").value;
  const deliveryKey = row => JSON.parse(row.payload_json).providerIdempotencyKey ?? row.idempotency_key;
  const callsFor = (snapshot, row) => sends(snapshot).filter(mail => mail.custom_args.rer_delivery_id === deliveryKey(row));
  const reminderRows = (snapshot, bookingId) => snapshot.delivery_outbox.filter(row => row.booking_id === bookingId && row.kind === "reminder");
  const calendarEvents = (snapshot, bookingId) => snapshot.wire_events.map(row => JSON.parse(row.payload)).filter(event => event.extendedProperties?.private?.["dial-booking-id"] === bookingId);
  const calendarEvent = (snapshot, bookingId) => { const events = calendarEvents(snapshot, bookingId); assert.equal(events.length, 1); return events[0]; };
  const wire = (name, value) => fetch(`${origin}/wire/control`, { method: "POST", body: JSON.stringify({ name, value }) });
  const wireEvent = (id, payload) => fetch(`${origin}/wire/event`, { method: "POST", body: JSON.stringify({ id, payload }) });
  async function signIn() {
    const boot = await raw("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Lifecycle owner", returnTo: "/app" }, 303);
    cookie = boot.headers.get("set-cookie").split(";")[0];
  }
  // The operator connects the synthetic Google calendar through OAuth, selects it for bookings and conflicts, and checks mail.
  async function connectCalendar() {
    const consent = new URL((await raw("/api/app/calendar/oauth/start", undefined, 302)).headers.get("location"));
    assert.equal(consent.origin, "https://accounts.google.com");
    const connected = await raw(`/api/calendar/oauth/callback?code=wire-consent&state=${encodeURIComponent(consent.searchParams.get("state"))}`, undefined, 302);
    assert.match(connected.headers.get("location"), /calendar=connected/);
    assert.deepEqual((await op("/api/app/calendar/calendars")).calendars.map(calendar => calendar.id), ["synthetic-calendar"]);
    await op("/api/app/calendar/selection", { destinationCalendarId: "synthetic-calendar", conflictCalendarIds: ["synthetic-calendar"] }, 200, "PUT");
    await op("/api/app/calendar/check", {});
    await op("/api/app/mail/check", {});
  }
  return { signIn, connectCalendar, raw, op, pub, state, until, sleep, atSecond, passStart, passAfter, nextPass, day, slots, select, selectRaw, confirm, token, bookingIdFor, book, reschedule, cancel, ics, record, sends, delivered, mailTo, text, callsFor, reminderRows, calendarEvents, calendarEvent, wire, wireEvent };
}
