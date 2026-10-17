import { evidencePath } from "./evidence-path.mjs";
import { localMagicLink, confirmAuthLink } from "../tests/auth-client.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const origin = process.env.DIAL_OPERATOR_TEMPORAL_ORIGIN ?? "http://127.0.0.1:15703";
assert.equal(new URL(origin).hostname, "127.0.0.1");
assert.equal(new URL(origin).port, "15703");
let cookie;
const checks = [], errors = [], failedRequests = [], expectedConsoleErrors = [];
const injectedRequests = new Set();
const mark = (check) => { checks.push(check); console.log(`PASS ${check}`); };
async function call(path, body, expected = 200, authenticated = false, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(authenticated ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const snapshot = () => data("/__fixtures/status");
const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
const localTime = (value, timeZone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
const calendarFields = (file) => Object.fromEntries(file.replace(/\r\n[ \t]/g, "").trim().split("\r\n").map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)]));
const minutes = (occurrence) => (Date.parse(occurrence.endAt ?? occurrence.end_at) - Date.parse(occurrence.startAt ?? occurrence.start_at)) / 60000;
const fixture = await data("/__fixtures/setup", {});
await call("/api/auth/magic-links", { email: fixture.operatorEmail }, 202);
const link = await localMagicLink(origin);
const signedIn = await confirmAuthLink(link.developmentLink);
assert.equal(signedIn.status, 303); cookie = signedIn.headers.get("set-cookie").split(";")[0];
const event = await data("/api/public/events/dial-host/intro");
const questionKey = event.eventType.questions[0].key;
const week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const availability = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=America%2FNew_York`);
const slots = availability.slots.filter((slot) => Date.parse(slot.startAt) > Date.now() + 2 * 86400000);
assert.ok(slots.length > 80);
async function create(index, name) {
  const slot = slots[index];
  const selection = await data("/api/public/book/dial-host/intro/selection", { startAt: slot.startAt, inviteeTimezone: "America/New_York" }, 201);
  const receipt = await data("/api/public/book/dial-host/intro/confirm", { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "America/New_York", name, email: `${name.toLowerCase().replaceAll(" ", "-")}@dial.test`, answers: { [questionKey]: "Synthetic temporal fixture" } }, 201);
  await deliver();
  return { ...(await snapshot()).bookings.find((booking) => booking.invitee_name === name), token: new URL(receipt.manageUrl).pathname.split("/").at(-1) };
}
const operatorOriginal = await create(0, "Operator duration invitee");
const inviteeOriginal = await create(8, "Public duration invitee");
const initialIcs = new Map();
for (const booking of [operatorOriginal, inviteeOriginal]) initialIcs.set(booking.id, calendarFields(await (await call(`/api/public/manage/${booking.token}/calendar.ics`)).text()));
const requestBody = { inviteeName: "Linked temporal invitee", inviteeEmail: "linked-temporal@dial.test", inviteeTimezone: "America/New_York", note: "Synthetic agreed time", windows: [{ date: week, startMinute: 780, endMinute: 840 }] };
const review = await data("/api/public/events/dial-host/intro/request/review", requestBody, 201);
await call(`/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(review.nonce)}`, requestBody, 201);
const request = (await data("/api/app/availability-requests?state=submitted", undefined, 200, true)).find((row) => row.inviteeEmail === requestBody.inviteeEmail);
assert.ok(request); await deliver();
const nativeBody = { eventTypeId: fixture.eventId, startAt: slots[16].startAt, inviteeTimezone: "America/New_York", name: "Native auth fixture", email: "native-auth@dial.test", answers: { [questionKey]: "Synthetic answer" }, overrideNoticeAndHorizon: false };
await call("/api/app/bookings", nativeBody, 401);
mark("native operator creation requires a session");

const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, timezoneId: "Australia/Brisbane" });
  await context.addCookies([{ name: cookie.slice(0, cookie.indexOf("=")), value: cookie.slice(cookie.indexOf("=") + 1), url: origin }]);
  page = await context.newPage(); page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const entry = { text: message.text(), url: message.location().url };
    if (entry.url === `${origin}/api/app/bookings` && /Failed to load resource.*(?:409|ERR_FAILED)/.test(entry.text)) expectedConsoleErrors.push(entry);
    else errors.push(entry);
  });
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText, injected: injectedRequests.has(request) }));
  const posts = [];
  page.on("request", (request) => { if (request.url() === `${origin}/api/app/bookings` && request.method() === "POST") posts.push(request.postDataJSON()); });
  await page.goto(origin + "/app/bookings/new");
  const editing = page.getByLabel("Editing time zone", { exact: true });
  const inviteeZone = page.getByLabel("Invitee time zone", { exact: true });
  const start = page.getByLabel("Start time", { exact: true });
  const name = page.getByLabel("Invitee name", { exact: true });
  const email = page.getByLabel("Invitee email", { exact: true });
  const answer = page.getByLabel(/What would you like to discuss/);
  const submit = page.getByRole("button", { name: "Create booking", exact: true });
  await page.getByLabel(/^Event type/).selectOption(fixture.eventId);
  await answer.waitFor();
  await editing.selectOption("Europe/London"); await inviteeZone.selectOption("America/New_York");
  await start.fill(localTime(slots[16].startAt, "Europe/London"));
  assert.equal(await submit.getAttribute("type"), "submit");
  await submit.click(); assert.equal(posts.length, 0); assert.equal(await name.evaluate((node) => node.checkValidity()), false);
  await name.fill("Operator temporal invitee"); await email.fill("invalid");
  await submit.click(); assert.equal(posts.length, 0); assert.equal(await email.evaluate((node) => node.checkValidity()), false);
  await email.fill("operator-temporal@dial.test"); await submit.click();
  assert.equal(posts.length, 0); assert.equal(await answer.evaluate((node) => node.checkValidity()), false);
  await answer.fill("Synthetic native validation answer");
  mark("actual form submission enforces required name, valid email and required answers before any booking POST");

  const retainedStart = await start.inputValue();
  const abortOnce = async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    injectedRequests.add(route.request()); await route.abort("failed");
  };
  await page.route(`${origin}/api/app/bookings`, abortOnce);
  await submit.click();
  await page.getByRole("alert").filter({ hasText: "Creation could not be checked." }).waitFor();
  await page.unroute(`${origin}/api/app/bookings`, abortOnce);
  assert.ok(await submit.isEnabled()); assert.equal(await start.inputValue(), retainedStart);
  assert.equal(await name.inputValue(), "Operator temporal invitee"); assert.equal(await email.inputValue(), "operator-temporal@dial.test");
  assert.equal(await editing.inputValue(), "Europe/London"); assert.equal(await inviteeZone.inputValue(), "America/New_York");
  assert.equal(await answer.inputValue(), "Synthetic native validation answer");
  assert.ok(!(await snapshot()).bookings.some((row) => row.invitee_email === "operator-temporal@dial.test"));
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  let response = page.waitForResponse((result) => result.url() === `${origin}/api/app/bookings` && result.request().method() === "POST");
  await submit.click(); assert.equal((await response).status(), 201);
  await page.waitForURL(origin + "/app/bookings");
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, "success uses client navigation without replacing the document");
  let state = await snapshot();
  const plain = state.bookings.find((row) => row.invitee_email === "operator-temporal@dial.test");
  assert.equal(state.booking_occurrences.find((row) => row.id === plain.current_occurrence_id).start_at, slots[16].startAt);
  assert.equal(plain.invitee_timezone, "America/New_York"); await deliver();
  mark("a controlled transport failure preserves all creation inputs and resets saving; retry uses London UTC conversion and client navigation");

  await page.goto(origin + `/app/bookings/new?requestId=${request.id}`);
  const agreed = page.getByRole("button", { name: "Create agreed booking", exact: true });
  await name.waitFor(); await agreed.waitFor();
  await editing.selectOption("Europe/London");
  assert.equal(await name.inputValue(), requestBody.inviteeName); assert.equal(await email.inputValue(), requestBody.inviteeEmail);
  assert.equal(await inviteeZone.inputValue(), "America/New_York");
  await start.fill("2026-10-25T01:30");
  const repeated = page.getByLabel("Repeated time", { exact: true }); await repeated.waitFor();
  assert.ok(await agreed.isDisabled());
  const choices = await repeated.locator("option").evaluateAll((options) => options.filter((option) => option.value).map((option) => ({ value: option.value, label: option.textContent })));
  assert.equal(choices.length, 2); assert.equal(Math.abs(Date.parse(choices[0].value) - Date.parse(choices[1].value)), 3600000);
  assert.ok(choices.every((choice) => /UTC/.test(choice.label)));
  await repeated.selectOption(choices[1].value); assert.ok(await agreed.isEnabled());
  await start.fill("2027-03-28T01:30");
  await page.getByRole("alert").filter({ hasText: "does not exist in Europe/London" }).waitFor(); assert.ok(await agreed.isDisabled());
  mark("linked-request form preserves its New York invitee zone and requires explicit fold offsets while blocking gaps");

  await start.fill(localTime(slots[0].startAt, "Europe/London")); await answer.fill("Synthetic linked request answer");
  await page.getByRole("checkbox").check();
  response = page.waitForResponse((result) => result.url() === `${origin}/api/app/bookings` && result.request().method() === "POST");
  await agreed.click(); assert.equal((await response).status(), 409);
  await page.getByRole("alert").filter({ hasText: /no longer available|cannot be created/ }).waitFor();
  assert.equal(await name.inputValue(), requestBody.inviteeName); assert.equal(await start.inputValue(), localTime(slots[0].startAt, "Europe/London"));
  assert.equal((await data(`/api/app/availability-requests/${request.id}`, undefined, 200, true)).state, "submitted");
  await start.fill(localTime(slots[24].startAt, "Europe/London")); assert.equal(await page.getByRole("alert").count(), 0);
  response = page.waitForResponse((result) => result.url() === `${origin}/api/app/bookings` && result.request().method() === "POST");
  await agreed.click(); assert.equal((await response).status(), 201); await page.waitForURL(origin + "/app/bookings");
  state = await snapshot();
  const linked = state.bookings.find((row) => row.invitee_email === requestBody.inviteeEmail);
  assert.equal(linked.invitee_timezone, "America/New_York");
  assert.equal(state.booking_occurrences.find((row) => row.id === linked.current_occurrence_id).start_at, slots[24].startAt);
  const handled = await data(`/api/app/availability-requests/${request.id}`, undefined, 200, true);
  assert.equal(handled.state, "handled"); assert.equal(handled.bookingId, linked.id);
  assert.equal(state.booking_occurrences.filter((row) => row.booking_id === operatorOriginal.id).length, 1);
  await deliver();
  state = await snapshot();
  assert.equal(state.fixture_mail.filter((row) => row.key.startsWith(`booking:${linked.id}:`) && row.key.includes(":mail:")).length, 2);
  mark("occupied agreed time stays rejected despite override, preserves request and inputs, then valid retry links one booking and sends ordinary notices once");

  const configuration = await data(`/api/app/event-types/${fixture.eventId}`, undefined, 200, true);
  await data(`/api/app/event-types/${fixture.eventId}`, { ...configuration, durationMinutes: 60, durationOptionsMinutes: [30, 60] }, 200, true, "PATCH");
  for (const original of [operatorOriginal, inviteeOriginal]) {
    const receipt = await data(`/api/public/manage/${original.token}`);
    assert.equal(receipt.event.durationMinutes, 30); assert.equal(minutes(receipt.occurrence), 30);
  }
  mark("changing event duration alone preserves each existing thirty-minute occurrence and receipt");
  const oldThirtyMinuteTail = slots.find((slot) => localTime(slot.startAt, "Australia/Brisbane").endsWith("T23:30") && localTime(slot.endAt, "Australia/Brisbane").endsWith("T00:00"));
  assert.ok(oldThirtyMinuteTail, "original availability offers a thirty-minute host-day tail");
  assert.equal(minutes(oldThirtyMinuteTail), 30);
  assert.equal(localTime(oldThirtyMinuteTail.startAt, "Australia/Brisbane"), `${oldThirtyMinuteTail.hostDate}T23:30`);
  const nextHostDate = new Date(Date.parse(`${oldThirtyMinuteTail.hostDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  assert.equal(localTime(oldThirtyMinuteTail.endAt, "Australia/Brisbane"), `${nextHostDate}T00:00`);
  const { createHash } = await import("node:crypto");
  // Busy activity records validation reads; every persisted delivery effect is compared.
  const safeEffects = (state) => Object.fromEntries(Object.entries(state).map(([table, rows]) => {
    const effects = table === "fixture_activity" ? rows.filter((row) => row.kind !== "busy") : rows;
    const values = effects.map((row) => JSON.stringify(row)).sort();
    return [table, { count: values.length, sha256: createHash("sha256").update(JSON.stringify(values)).digest("hex") }];
  }));
  const beforeTailRejection = safeEffects(await snapshot());
  const operatorTailRefusal = await data(`/api/app/bookings/${operatorOriginal.id}/reschedule`, { startAt: oldThirtyMinuteTail.startAt, durationMinutes: 60, inviteeTimezone: "America/New_York", overridePublishedAvailability: false }, 409, true);
  assert.equal(operatorTailRefusal.error.code, "slot_unavailable");
  assert.deepEqual(operatorTailRefusal.error.details, ["schedule"]);
  assert.deepEqual(safeEffects(await snapshot()), beforeTailRejection, "operator refusal preserves both original occurrences and every booking, history, outbox, calendar and mail effect");
  const publicTailRefusal = await data(`/api/public/manage/${inviteeOriginal.token}/reschedule/selection`, { startAt: oldThirtyMinuteTail.startAt, durationMinutes: 60, inviteeTimezone: "America/New_York" }, 409);
  assert.equal(publicTailRefusal.error.code, "slot_unavailable");
  assert.equal(Object.hasOwn(publicTailRefusal, "nonce"), false);
  assert.deepEqual(safeEffects(await snapshot()), beforeTailRejection, "public refusal issues no nonce and preserves every persisted booking and delivery effect");
  mark("an originally offered thirty-minute host-day tail is refused after the sixty-minute edit without changing occurrences, history, delivery effects or nonces");

  const operatorOriginalOccurrence = state.booking_occurrences.find((row) => row.id === operatorOriginal.current_occurrence_id);
  const retainedAvailability = await data(`/api/public/manage/${operatorOriginal.token}/reschedule/availability?week=${week}`);
  assert.ok(retainedAvailability.slots.every(slot => minutes(slot) === 30), "rescheduling defaults to the booking's retained duration");
  const operatorAvailability = await data(`/api/public/manage/${operatorOriginal.token}/reschedule/availability?week=${week}&inviteeTimezone=America%2FNew_York&durationMinutes=60`);
  assert.equal(operatorAvailability.state, "available"); assert.ok(operatorAvailability.slots.length > 0);
  const operatorSlot = operatorAvailability.slots.find((slot) => slot.startAt !== operatorOriginalOccurrence.start_at);
  assert.ok(operatorSlot); assert.equal(minutes(operatorSlot), 60);
  assert.notEqual(operatorSlot.startAt, operatorOriginalOccurrence.start_at);
  await data(`/api/app/bookings/${operatorOriginal.id}/reschedule`, { startAt: operatorSlot.startAt, durationMinutes: 60, inviteeTimezone: "America/New_York", overridePublishedAvailability: false }, 200, true);
  const inviteeAvailability = await data(`/api/public/manage/${inviteeOriginal.token}/reschedule/availability?week=${week}&inviteeTimezone=America%2FNew_York&durationMinutes=60`);
  assert.equal(inviteeAvailability.state, "available"); assert.ok(inviteeAvailability.slots.length > 0);
  assert.ok(inviteeAvailability.slots.every((slot) => Date.parse(slot.endAt) <= Date.parse(operatorSlot.startAt) || Date.parse(slot.startAt) >= Date.parse(operatorSlot.endAt)), "fresh invitee availability excludes the operator's new occurrence");
  const inviteeOriginalOccurrence = state.booking_occurrences.find((row) => row.id === inviteeOriginal.current_occurrence_id);
  const inviteeSlot = inviteeAvailability.slots.find((slot) => slot.startAt !== inviteeOriginalOccurrence.start_at && slot.startAt !== operatorSlot.startAt);
  assert.ok(inviteeSlot); assert.equal(minutes(inviteeSlot), 60);
  const selection = await data(`/api/public/manage/${inviteeOriginal.token}/reschedule/selection`, { startAt: inviteeSlot.startAt, durationMinutes: 60, inviteeTimezone: "America/New_York" }, 201);
  await data(`/api/public/manage/${inviteeOriginal.token}/reschedule`, { nonce: selection.nonce, startAt: inviteeSlot.startAt, inviteeTimezone: "America/New_York" });
  mark("both successful reschedules use freshly offered sixty-minute slots, including the operator's new occupancy in the invitee read");
  await deliver(); state = await snapshot();
  for (const original of [operatorOriginal, inviteeOriginal]) {
    const current = state.bookings.find((row) => row.id === original.id);
    const receipt = await data(`/api/public/manage/${original.token}`);
    const occurrence = state.booking_occurrences.find((row) => row.id === current.current_occurrence_id);
    assert.notEqual(current.current_occurrence_id, original.current_occurrence_id);
    assert.equal(current.duration_minutes, 30, "original stored duration is immutable");
    assert.equal(minutes(occurrence), 60); assert.equal(receipt.event.durationMinutes, 60); assert.equal(minutes(receipt.occurrence), 60);
    assert.equal(current.ical_uid, original.ical_uid);
    const ics = calendarFields(await (await call(`/api/public/manage/${original.token}/calendar.ics`)).text());
    assert.equal(ics.UID, initialIcs.get(original.id).UID); assert.equal(ics.SEQUENCE, "1");
    const mail = state.fixture_mail.filter((row) => row.key.includes(`occurrence:${current.current_occurrence_id}:mail:`)); assert.equal(mail.length, 2);
    const provider = JSON.parse(state.fixture_events.find((row) => row.booking_id === original.id).event_json); assert.equal(minutes(provider), 60);
  }
  mark("operator and invitee reschedules expose the actual sixty-minute occurrence while retaining original duration, booking identity, UID and one notice per recipient");
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests.filter((request) => !request.injected), []);
  await writeFile(evidencePath("operator-temporal.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), origin, providers: "task-owned synthetic calendar and mail", checks, errors, failedRequests, expectedConsoleErrors, submittedInstants: posts.map(({ startAt, inviteeTimezone, requestId }) => ({ startAt, inviteeTimezone, linkedRequest: Boolean(requestId) })), limits: ["The transport failure was injected before the owned POST reached the Worker; this does not certify recovery after an accepted but lost response."] }, null, 2) + "\n");
} catch (error) {
  await page?.screenshot({ path: evidencePath("operator-temporal-failure.png"), fullPage: true });
  await writeFile(evidencePath("operator-temporal-failure.json"), JSON.stringify({ observedAt: new Date().toISOString(), origin, checks, errors, failedRequests, failure: error.message, body: page ? await page.locator("body").innerText() : undefined }, null, 2) + "\n");
  throw error;
} finally { await browser.close(); }
