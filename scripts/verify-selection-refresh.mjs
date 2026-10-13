import { evidencePath as outputPath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { authenticate, call, data, origin, productRecords, snapshot } from "../tests/availability-diagnostics/helpers.mjs";

const evidencePath = outputPath("selection-refresh-native.json"), checks = [];
const mark = (message) => { checks.push(message); console.log(`PASS ${message}`); };
const fields = ["slug", "title", "description", "durationMinutes", "color", "locationType", "locationLabel", "locationValue", "listed", "slotIncrementMinutes", "minimumNoticeMinutes", "bookingHorizonDays", "beforeBufferMinutes", "afterBufferMinutes", "hostDayBookingLimit", "questions"];
const details = (event, changes = {}) => ({ ...Object.fromEntries(fields.map((key) => [key, event[key]])), ...changes });
const full = (event, changes = {}) => ({ ...details(event), alternativeRequestsEnabled: event.alternativeRequestsEnabled, availability: event.availability, ...changes });
const futureDate = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
const at = (hour) => `${futureDate}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const query = (body, changes = {}) => new URLSearchParams({ nonce: body.nonce, startAt: body.startAt, inviteeTimezone: body.inviteeTimezone, ...changes });
const selectionPath = (event, body, changes) => `/api/public/book/dial-host/${event.slug}/selection?${query(body, changes)}`;
const detailsPath = (event, body, changes) => `/book/dial-host/${event.slug}/details?${query(body, changes)}`;
const confirm = (event, body, status) => data(`/api/public/book/dial-host/${event.slug}/confirm`, body, status);
const visible = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
async function unchanged(action) { const before = productRecords(await snapshot()); const result = await action(); assert.deepEqual(productRecords(await snapshot()), before, "refresh/refusal must not mutate product data or consume the selection nonce"); return result; }
function publicOnly(result, eventId, privateLocation) {
  const bytes = JSON.stringify(result); assert.ok(!bytes.includes(eventId)); assert.ok(!bytes.includes(privateLocation));
  for (const value of [result.host, result.event]) for (const key of ["id", "createdAt", "updatedAt", "locationValue", "locationType", "availability"]) assert.ok(!Object.hasOwn(value, key));
}
async function select(event, hour) { return data(`/api/public/book/dial-host/${event.slug}/selection`, { startAt: at(hour), inviteeTimezone: "UTC" }, 201); }
async function invalid(event, body) { const response = await unchanged(() => confirm(event, body, 400)); assert.equal(response.error.code, "invalid_answers"); }

try {
  const fixture = await data("/__fixtures/setup", {}); await authenticate(fixture.operatorEmail);
  const base = `/api/app/event-types/${fixture.eventId}`;
  let event = await data(base, undefined, 200, true);
  const retained = { key: "q_retained_text_key", kind: "text", label: "Original retained question", required: true, options: [] };
  const removed = { key: "q_removed_text_key", kind: "text", label: "Old hidden question", required: false, options: [] };
  const choice = { key: "q_current_choice_key", kind: "single_choice", label: "Original choice question", required: true, options: [{ value: "removed", label: "Removed choice label" }, { value: "stay", label: "Staying choice label" }] };
  const added = { key: "q_new_required_key", kind: "text", label: "New required question", required: true, options: [] };
  const privateLocation = "Private author-only location for refresh";
  event = await data(`${base}/details`, details(event, { questions: [retained, removed, choice], locationType: "in_person", locationLabel: "Private office", locationValue: privateLocation }), 200, true, "PATCH");
  const selected = await select(event, 9);
  const staleBody = { nonce: selected.nonce, startAt: selected.selection.startAt, inviteeTimezone: "UTC", name: "Retained synthetic name", email: "selection-refresh@dial.test", answers: { [retained.key]: "Retained text answer", [removed.key]: "Old hidden answer", [choice.key]: "removed" } };
  const originalLookup = await unchanged(() => data(selectionPath(event, staleBody))); assert.deepEqual(originalLookup.event.questions, [retained, removed, choice]);
  const revisedRetained = { ...retained, label: "Current retained question" }, revisedChoice = { ...choice, label: "Current choice question", options: [choice.options[1]] };
  event = await data(`${base}/details`, details(event, { questions: [revisedRetained, revisedChoice, added] }), 200, true, "PATCH");
  const refreshed = await unchanged(() => data(selectionPath(event, staleBody)));
  assert.deepEqual(refreshed.event.questions, [revisedRetained, revisedChoice, added]); assert.equal(refreshed.nonce, originalLookup.nonce); assert.equal(refreshed.expiresAt, originalLookup.expiresAt); assert.deepEqual(refreshed.selection, originalLookup.selection);
  publicOnly(refreshed, event.id, privateLocation);
  await unchanged(async () => {
    for (const changes of [{ nonce: "wrong-native-capability" }, { startAt: at(10) }, { inviteeTimezone: "America/New_York" }]) {
      await call(selectionPath(event, staleBody, changes), undefined, 404);
      await call(detailsPath(event, staleBody, changes), undefined, 404);
    }
    await call(selectionPath({ ...event, slug: "different-event" }, staleBody), undefined, 404);
    await call(detailsPath({ ...event, slug: "different-event" }, staleBody), undefined, 404);
  });
  mark("actual selection GET refreshes current public questions after owner edits while preserving the original nonce, expiry and times; wrong nonce/time/zone/event remain404 and IDs/private location stay hidden without product writes");

  const rawHtml = await unchanged(async () => (await call(detailsPath(event, staleBody))).text()), html = visible(rawHtml);
  assert.match(html, /Current retained question/); assert.match(html, /Current choice question/); assert.match(html, /New required question/); assert.match(html, /Staying choice label/);
  assert.doesNotMatch(html, /Old hidden question|Removed choice label|Original retained question/);
  assert.match(html, /maxlength="500"/i); assert.match(html.match(/<span[^>]*aria-current="step"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "", /Your details/);
  assert.ok(rawHtml.includes(selected.nonce)); assert.ok(!rawHtml.includes(privateLocation)); assert.ok(!rawHtml.includes(event.id));
  await invalid(event, { ...staleBody, answers: { ...staleBody.answers, [added.key]: "Current required answer" } });
  await invalid(event, { ...staleBody, answers: { [retained.key]: staleBody.answers[retained.key], [choice.key]: "removed", [added.key]: "Current required answer" } });
  await invalid(event, { ...staleBody, answers: { [retained.key]: staleBody.answers[retained.key], [choice.key]: "stay" } });
  mark("actual details SSR renders only current question controls and text bounds under the canonical capability; removed hidden keys, removed choice values and missing new required answers each refuse400 without consuming the nonce");

  const corrected = { ...staleBody, answers: { [retained.key]: staleBody.answers[retained.key], [choice.key]: "stay", [added.key]: "Current required answer" } };
  assert.equal(corrected.name, staleBody.name); assert.equal(corrected.email, staleBody.email); assert.equal(corrected.answers[retained.key], staleBody.answers[retained.key]);
  await confirm(event, corrected, 201); await unchanged(() => confirm(event, corrected, 200));
  await unchanged(async () => { await call(selectionPath(event, corrected), undefined, 410); await call(detailsPath(event, corrected), undefined, 410); });
  let state = await snapshot(); const bookingRow = state.bookings.find((row) => row.invitee_email === corrected.email); assert.ok(bookingRow);
  assert.equal(state.bookings.length, 1); assert.equal(state.booking_history.filter((row) => row.booking_id === bookingRow.id).length, 1);
  const booked = await data(`/api/app/bookings/${bookingRow.id}`, undefined, 200, true);
  assert.equal(booked.inviteeName, corrected.name); assert.equal(booked.inviteeEmail, corrected.email);
  assert.deepEqual([...booked.answers].sort((left, right) => left.key.localeCompare(right.key)), [{ key: retained.key, label: revisedRetained.label, kind: "text", value: corrected.answers[retained.key] }, { key: choice.key, label: revisedChoice.label, kind: "single_choice", value: "stay" }, { key: added.key, label: added.label, kind: "text", value: corrected.answers[added.key] }].sort((left, right) => left.key.localeCompare(right.key)));
  const beforeLaterEdit = await snapshot();
  event = await data(`${base}/details`, details(event, { questions: event.questions.map((question) => ({ ...question, label: `Later ${question.label}` })) }), 200, true, "PATCH");
  assert.deepEqual((await data(`/api/app/bookings/${bookingRow.id}`, undefined, 200, true)).answers, booked.answers);
  state = await snapshot(); for (const table of ["bookings", "booking_occurrences", "booking_answers", "booking_history", "booking_nonces", "delivery_outbox"]) assert.deepEqual(state[table], beforeLaterEdit[table]);
  await unchanged(() => confirm(event, corrected, 200));
  mark("corrected current answers preserve name/email/retained text and confirm the exact original capability once; consumed selection GET is410 while matching confirmation replay200 survives later edits with original booked answer labels intact");

  const disabledSelection = await select(event, 10), disabledBody = { ...corrected, nonce: disabledSelection.nonce, startAt: disabledSelection.selection.startAt };
  await data(`${base}/disable`, {}, 200, true);
  await unchanged(async () => {
    await call(selectionPath(event, disabledBody), undefined, 404); await call(detailsPath(event, disabledBody), undefined, 404);
    const refusal = await confirm(event, disabledBody, 409); assert.equal(refusal.error.code, "slot_unavailable"); assert.ok(!Object.hasOwn(refusal.error, "details")); assert.ok(!JSON.stringify(refusal).includes(privateLocation));
  });
  const deletedEvent = await data("/api/app/event-types", full(event, { slug: "deleted-selection", questions: [] }), 201, true); await data(`/api/app/event-types/${deletedEvent.id}/publish`, {}, 200, true);
  const deletedSelection = await select(deletedEvent, 11), deletedBody = { ...corrected, nonce: deletedSelection.nonce, startAt: deletedSelection.selection.startAt, answers: {} };
  await call(`/api/app/event-types/${deletedEvent.id}`, undefined, 204, true, "DELETE");
  await unchanged(async () => {
    await call(selectionPath(deletedEvent, deletedBody), undefined, 404); await call(detailsPath(deletedEvent, deletedBody), undefined, 404);
    const refusal = await confirm(deletedEvent, deletedBody, 404); assert.equal(refusal.error.code, "booking_nonce_not_found"); assert.ok(!Object.hasOwn(refusal.error, "details")); assert.ok(!JSON.stringify(refusal).includes(privateLocation));
  });
  const final = await snapshot(); assert.equal(final.bookings.length, 1); assert.equal(final.fixture_mail.length, 0); assert.equal(final.fixture_events.length, 0);
  mark("disabling or deleting an event invalidates its old selection GET/SSR and neutrally refuses final creation without nonce consumption or booking/provider effects");
  await writeFile(evidencePath, JSON.stringify({ status: "verified", verifiedAt: new Date().toISOString(), origin, checks, proofs: { selectionCapabilityRetained: true, correctedAnswersConfirmed: 1, providerSendEffects: 0 }, limits: ["Actual native Hono/Start/D1/DO and public details SSR with fresh task-owned state and synthetic providers only.", "The fixture manually supplies corrected current answers. Client pruning/refresh race handling is covered by root's separate pure tests and source review; browser input retention, epochs, focus and navigation remain unverified under the launch hold.", "No server authority or schema changes were assumed; native final validation continues to enforce current event questions independently of presentation."] }, null, 2) + "\n");
} catch (error) {
  await writeFile(evidencePath, JSON.stringify({ status: "failed", observedAt: new Date().toISOString(), origin, checks, failure: error.message, stack: error.stack }, null, 2) + "\n"); throw error;
}
