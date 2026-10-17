import { evidencePath as outputPath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { authenticate, call, data, origin, productRecords, snapshot } from "../tests/availability-diagnostics/helpers.mjs";

const evidencePath = outputPath("question-defaults-native.json"), checks = [];
const mark = (message) => { checks.push(message); console.log(`PASS ${message}`); };
const fields = ["slug", "title", "description", "durationMinutes", "color", "locationType", "locationLabel", "locationValue", "listed", "slotIncrementMinutes", "minimumNoticeMinutes", "bookingHorizonDays", "beforeBufferMinutes", "afterBufferMinutes", "hostDayBookingLimit", "questions"];
const details = (event, changes = {}) => ({ ...Object.fromEntries(fields.map((key) => [key, event[key]])), ...changes });
const full = (event, changes = {}) => ({ ...details(event), alternativeRequestsEnabled: event.alternativeRequestsEnabled, availability: event.availability, ...changes });
const omitted = (input, key) => Object.fromEntries(Object.entries(input).filter(([field]) => field !== key));
const futureDate = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
const at = (hour) => `${futureDate}T${String(hour).padStart(2, "0")}:00:00.000Z`;
async function unchanged(action) { const before = productRecords(await snapshot()); const result = await action(); assert.deepEqual(productRecords(await snapshot()), before, "invalid input must leave product records and nonce consumption unchanged"); return result; }
async function select(event, hour, email, answers = {}) {
  const selected = await data(`/api/public/book/dial-host/${event.slug}/selection`, { startAt: at(hour), inviteeTimezone: "UTC" }, 201);
  return { nonce: selected.nonce, startAt: at(hour), inviteeTimezone: "UTC", name: "Synthetic question invitee", email, answers };
}
const confirm = (event, body, status) => data(`/api/public/book/dial-host/${event.slug}/confirm`, body, status);
async function invalid(event, body) {
  const response = await unchanged(() => confirm(event, body, 400)); assert.equal(response.error.code, "invalid_answers");
  const pending = (await snapshot()).booking_nonces.filter((row) => row.event_type_id === event.id && row.selection_start_at === body.startAt);
  assert.ok(pending.some((row) => row.consumed_at === null && row.result_booking_id === null));
}
async function bookingFor(email) {
  const rows = (await snapshot()).bookings.filter((row) => row.invitee_email === email); assert.equal(rows.length, 1);
  return data(`/api/app/bookings/${rows[0].id}`, undefined, 200, true);
}

try {
  const fixture = await data("/__fixtures/setup", {}); await authenticate(fixture.operatorEmail);
  const template = await data(`/api/app/event-types/${fixture.eventId}`, undefined, 200, true);
  const omittedInput = omitted(full(template, { slug: "default-agenda", title: "Default agenda event" }), "questions");
  const choice = { key: "q_native_custom_choice", kind: "single_choice", label: "Original choice label", required: true, options: [{ value: "first", label: "First label" }, { value: "second", label: "Second label" }] };
  await unchanged(async () => {
    await call("/api/app/event-types", omittedInput, 401);
    await call("/api/app/event-types", omittedInput, 403, true, "POST", { origin: "https://forged.example.test" });
    for (const changes of [{ locationType: "fixed_link", locationValue: " " }, { questions: [choice, choice] }, { questions: [{ ...choice, options: [] }] }, { questions: [{ ...choice, options: [{ value: "same", label: "One" }, { value: "same", label: "Two" }] }] }, { questions: [{ ...choice, key: "invalid" }] }]) await call("/api/app/event-types", { ...omittedInput, ...changes }, 400, true);
  });
  let defaultEvent = await data("/api/app/event-types", omittedInput, 201, true);
  assert.equal(defaultEvent.questions.length, 1);
  const agenda = defaultEvent.questions[0]; assert.deepEqual(agenda, { key: "q_default_agenda", kind: "text", label: "Agenda", required: false, options: [] });
  assert.deepEqual((await data(`/api/app/event-types/${defaultEvent.id}`, undefined, 200, true)).questions, [agenda]);
  const emptyEvent = await data("/api/app/event-types", full(template, { slug: "explicit-empty", questions: [] }), 201, true);
  const customEvent = await data("/api/app/event-types", full(template, { slug: "custom-choice", questions: [choice] }), 201, true);
  assert.deepEqual(emptyEvent.questions, []); assert.deepEqual(customEvent.questions, [choice]);
  assert.deepEqual((await data(`/api/app/event-types/${template.id}`, undefined, 200, true)).questions, template.questions);
  await unchanged(async () => {
    await call(`/api/app/event-types/${defaultEvent.id}`, omitted(full(defaultEvent), "questions"), 400, true, "PATCH");
    await call(`/api/app/event-types/${defaultEvent.id}/details`, omitted(details(defaultEvent), "questions"), 400, true, "PATCH");
  });
  defaultEvent = await data(`/api/app/event-types/${defaultEvent.id}/details`, details(defaultEvent, { questions: [{ ...agenda, label: "Original booked agenda" }] }), 200, true, "PATCH");
  assert.equal(defaultEvent.questions[0].key, agenda.key);
  for (const event of [defaultEvent, emptyEvent, customEvent]) await data(`/api/app/event-types/${event.id}/publish`, {}, 200, true);
  const publicDefault = (await data("/api/public/events/dial-host/default-agenda")).eventType;
  assert.deepEqual(publicDefault.questions, defaultEvent.questions);
  assert.deepEqual((await data("/api/public/events/dial-host/explicit-empty")).eventType.questions, []);
  assert.deepEqual((await data("/api/public/events/dial-host/custom-choice")).eventType.questions, [choice]);
  mark("native creation defaults omitted questions to one stable optional Agenda only; explicit empty/custom lists and existing events remain unchanged, edits require questions, and auth/origin/configuration refusals store nothing");

  const longBody = await select(defaultEvent, 9, "agenda-boundary@dial.test", { [agenda.key]: "A".repeat(501) });
  await invalid(defaultEvent, longBody);
  const operatorBody = { idempotencyKey: randomUUID(), eventTypeId: defaultEvent.id, startAt: at(13), inviteeTimezone: "UTC", name: "Synthetic operator invitee", email: "operator-agenda@dial.test", answers: { [agenda.key]: "A".repeat(501) }, overrideNoticeAndHorizon: false };
  const operatorRefusal = await unchanged(() => data("/api/app/bookings", operatorBody, 400, true)); assert.equal(operatorRefusal.error.code, "invalid_booking");
  const validBody = { ...longBody, answers: { [agenda.key]: "A".repeat(500) } };
  await confirm(defaultEvent, validBody, 201);
  await unchanged(() => confirm(defaultEvent, validBody, 200));
  const booked = await bookingFor(validBody.email); assert.deepEqual(booked.answers, [{ key: agenda.key, label: "Original booked agenda", kind: "text", value: "A".repeat(500) }]);
  assert.equal((await snapshot()).booking_history.filter((row) => row.booking_id === booked.id).length, 1);
  mark("public/operator final validation rejects501 text characters before claim; unchanged public nonce retries500 successfully once and matching capability replay commits no additional booking/history");

  const optionalBody = await select(defaultEvent, 10, "optional-agenda@dial.test");
  await confirm(defaultEvent, optionalBody, 201); assert.deepEqual((await bookingFor(optionalBody.email)).answers, []);
  const emptyBody = await select(emptyEvent, 11, "empty-questions@dial.test");
  await invalid(emptyEvent, { ...emptyBody, answers: { [agenda.key]: "Unconfigured answer" } });
  await invalid(emptyEvent, { ...emptyBody, name: " " });
  await invalid(emptyEvent, { ...emptyBody, email: "invalid-email" });
  await confirm(emptyEvent, emptyBody, 201); assert.deepEqual((await bookingFor(emptyBody.email)).answers, []);
  mark("default Agenda is optional; explicit empty questions accepts name/email only, refuses unknown answer keys or invalid identity without consuming its nonce, then permits one valid exact-capability retry");

  const customBody = await select(customEvent, 12, "choice-question@dial.test", { [choice.key]: "unconfigured" });
  await invalid(customEvent, customBody); await invalid(customEvent, { ...customBody, answers: {} });
  const customValid = { ...customBody, answers: { [choice.key]: "first" } }; await confirm(customEvent, customValid, 201);
  const customBooking = await bookingFor(customValid.email), beforeEdit = await snapshot();
  const editedChoice = { ...choice, label: "Edited future choice", options: [{ value: "first", label: "Updated first label" }, choice.options[1]] };
  const updatedCustom = await data(`/api/app/event-types/${customEvent.id}/details`, details(customEvent, { questions: [editedChoice] }), 200, true, "PATCH");
  assert.deepEqual(updatedCustom.questions, [editedChoice]);
  defaultEvent = await data(`/api/app/event-types/${defaultEvent.id}`, full(defaultEvent, { questions: [{ ...agenda, label: "Edited future agenda" }] }), 200, true, "PATCH");
  assert.equal(defaultEvent.questions[0].key, agenda.key);
  const afterEdit = await snapshot();
  for (const table of ["bookings", "booking_occurrences", "booking_history", "booking_answers", "booking_nonces", "delivery_outbox"]) assert.deepEqual(afterEdit[table], beforeEdit[table]);
  assert.deepEqual((await data(`/api/app/bookings/${booked.id}`, undefined, 200, true)).answers, booked.answers);
  assert.deepEqual((await data(`/api/app/bookings/${customBooking.id}`, undefined, 200, true)).answers, [{ key: choice.key, label: choice.label, kind: choice.kind, value: "first" }]);
  assert.equal(afterEdit.bookings.length, 4); assert.equal(afterEdit.fixture_mail.length, 0); assert.equal(afterEdit.fixture_events.length, 0);
  mark("required custom choice rejects unknown/missing values before claim and reuses the nonce for its configured value; later question/option label edits preserve stable keys and immutable committed answer snapshots with provider sends queued");

  const phone = { key: "q_native_phone_number", kind: "phone", label: "Your phone number", required: true, options: [] };
  const dropdown = { ...choice, key: "q_native_dropdown_choice", kind: "dropdown", label: "Meeting topic" };
  await unchanged(async () => {
    await call("/api/app/event-types", full(template, { slug: "invalid-phone", questions: [{ ...phone, options: choice.options }] }), 400, true);
    await call("/api/app/event-types", full(template, { slug: "invalid-dropdown", questions: [{ ...dropdown, options: [] }] }), 400, true);
  });
  let typedEvent = await data("/api/app/event-types", full(template, { slug: "phone-dropdown", questions: [phone, dropdown] }), 201, true);
  await data(`/api/app/event-types/${typedEvent.id}/publish`, {}, 200, true);
  assert.deepEqual((await data(`/api/public/events/dial-host/${typedEvent.slug}`)).eventType.questions, [phone, dropdown]);
  const typedBody = await select(typedEvent, 13, "phone-question@dial.test", { [phone.key]: "555-12", [dropdown.key]: "first" });
  await invalid(typedEvent, typedBody);
  await invalid(typedEvent, { ...typedBody, answers: { [phone.key]: "", [dropdown.key]: "first" } });
  await invalid(typedEvent, { ...typedBody, answers: { [phone.key]: "(415) 555-0100", [dropdown.key]: "unconfigured" } });
  await invalid(typedEvent, { ...typedBody, answers: { [phone.key]: "(415) 555-0100", [dropdown.key]: ["first"] } });
  const typedValid = { ...typedBody, answers: { [phone.key]: "(415) 555-0100", [dropdown.key]: "first" } };
  await confirm(typedEvent, typedValid, 201);
  await unchanged(() => confirm(typedEvent, typedValid, 200));
  const typedBooking = await bookingFor(typedValid.email);
  assert.deepEqual(typedBooking.answers, [{ key: dropdown.key, label: dropdown.label, kind: dropdown.kind, value: "first" }, { key: phone.key, label: phone.label, kind: phone.kind, value: "+14155550100" }]);
  const operatorTyped = { ...operatorBody, idempotencyKey: randomUUID(), eventTypeId: typedEvent.id, startAt: at(14), email: "operator-phone@dial.test", answers: { [phone.key]: "555-12", [dropdown.key]: "second" } };
  const invalidOperatorTyped = await unchanged(() => data("/api/app/bookings", operatorTyped, 400, true));
  assert.equal(invalidOperatorTyped.error.code, "invalid_booking");
  await data("/api/app/bookings", { ...operatorTyped, answers: { [phone.key]: "+44 20 7946 0018", [dropdown.key]: "second" } }, 201, true);
  assert.deepEqual((await bookingFor(operatorTyped.email)).answers, [{ key: dropdown.key, label: dropdown.label, kind: dropdown.kind, value: "second" }, { key: phone.key, label: phone.label, kind: phone.kind, value: "+442079460018" }]);
  typedEvent = await data(`/api/app/event-types/${typedEvent.id}/details`, details(typedEvent, { questions: [{ ...phone, required: false }, { ...dropdown, required: false }] }), 200, true, "PATCH");
  const optionalTyped = await select(typedEvent, 15, "optional-phone@dial.test", { [phone.key]: "", [dropdown.key]: "" });
  await confirm(typedEvent, optionalTyped, 201);
  assert.ok((await bookingFor(optionalTyped.email)).answers.every(answer => answer.value === ""));
  assert.deepEqual((await bookingFor(typedValid.email)).answers, typedBooking.answers);
  mark("phone/dropdown questions round-trip through native event and public doors; malformed or missing required phones and foreign/array dropdown values leave the nonce untouched; US and international phones persist as E.164 through public/operator booking; optional blanks and exact replay work without changing older answer snapshots");
  const final = await snapshot();
  assert.equal(final.bookings.length, 7); assert.equal(final.fixture_mail.length, 0); assert.equal(final.fixture_events.length, 0);
  await writeFile(evidencePath, JSON.stringify({ status: "verified", verifiedAt: new Date().toISOString(), origin, checks, proofs: { defaultQuestionKey: agenda.key, defaultQuestionOptional: true, textBoundary: { refused: 501, accepted: 500 }, phoneNormalization: { us: "+14155550100", international: "+442079460018" }, bookings: final.bookings.length, providerSendEffects: 0 }, limits: ["Actual native Hono/Start/D1/DO with fresh task-owned state and synthetic providers only.", "This native test covers HTTP behaviour; rendering is exercised separately through rer dev at desktop and mobile widths.", "Question defaults apply to omitted create input only; existing event and answer identities are preserved."] }, null, 2) + "\n");
} catch (error) {
  await writeFile(evidencePath, JSON.stringify({ status: "failed", observedAt: new Date().toISOString(), origin, checks, failure: error.message, stack: error.stack }, null, 2) + "\n"); throw error;
}
