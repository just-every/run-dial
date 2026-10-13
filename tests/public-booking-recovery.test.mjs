import assert from "node:assert/strict";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

const bundled = await build({ stdin: { contents: 'export * from "./src/core/features/public-booking/ui/request-order"; export * from "./src/core/features/public-booking/ui/confirmation-attempt"; export * from "./src/core/features/public-booking/ui/answer-retention"; export * from "./src/core/features/public-booking/ui/document-seeds";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { RequestOrder, ConfirmationAttempt, retainConfiguredAnswers, seedSelection, seedEvent, seedProfile } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
contract("BOOK-001", "reversed reads and delayed response bodies cannot replace newer availability or selection state", async () => {
  const order = new RequestOrder(), state = [];
  const first = deferred(), second = deferred(), body = deferred();
  async function read(response) { const current = order.begin(); const payload = await response; const data = await payload.json(); if (current()) state.push(data); }
  const older = read(first.promise); first.resolve({ json: () => body.promise });
  await Promise.resolve();
  const newer = read(second.promise); second.resolve({ json: async () => "new week / current questions" }); await newer;
  body.resolve("old week / removed questions"); await older;
  assert.deepEqual(state, ["new week / current questions"]);
  const departed = deferred(), pending = read(departed.promise); order.invalidate();
  departed.resolve({ json: async () => "departed capability" }); await pending;
  assert.deepEqual(state, ["new week / current questions"]);
  const failure = order.begin(), recovery = order.begin(); assert.equal(failure(), false); assert.equal(recovery(), true);
});
const question = (key, kind, options = []) => ({ key, kind, label: key, required: true, options: options.map(value => ({ value, label: value })) });
contract("BOOK-001", "current questions retain compatible answers and remove hidden or invalid choices", () => {
  const answers = { retained: "My notes", removed: "Hidden old answer", single: "gone", multi: ["gone", "stay", "stay"], changedKind: "old text", incompatibleText: ["old choice"] };
  const current = [question("retained", "textarea"), question("single", "single_choice", ["stay"]), question("multi", "multiple_choice", ["stay"]), question("changedKind", "checkbox", ["stay"]), question("incompatibleText", "text"), question("new", "text")];
  assert.deepEqual(retainConfiguredAnswers(current, answers), { retained: "My notes", multi: ["stay"] });
  assert.equal(answers.removed, "Hidden old answer");
});
const input = { nonce: "original-nonce", startAt: "2030-06-03T09:00:00.000Z", inviteeTimezone: "UTC", name: "Original name", email: "original@dial.test", answers: { single: "gone", multi: ["stay"] } };
contract("BOOK-003", "uncertain confirmation freezes exact capability and payload through question edits, refusal and receipt retries", () => {
  const attempt = new ConfirmationAttempt(), first = attempt.begin(input); attempt.unknown();
  first.answers.multi.push("mutated transport copy");
  const changed = { ...input, nonce: "other-nonce", name: "Edited name", answers: { single: "stay" } };
  for (const [status, code] of [[400, "invalid_answers"], [429, "rate_limited"], [410, "booking_nonce_expired"], [409, "booking_replay_mismatch"], [503, undefined]]) {
    assert.equal(attempt.refuse(status, code), false); assert.deepEqual(attempt.begin(changed), input); assert.equal(attempt.pending, true);
  }
});
contract("BOOK-003", "only definite first refusal permits corrected details with the original nonce", () => {
  const attempt = new ConfirmationAttempt(); attempt.begin(input);
  assert.equal(attempt.refuse(400, "invalid_answers"), true); assert.equal(attempt.pending, false);
  const corrected = { ...input, answers: { single: "stay" } }; assert.deepEqual(attempt.begin(corrected), corrected);
  const failure = new ConfirmationAttempt(); failure.begin(input); assert.equal(failure.refuse(500, "internal"), false); assert.deepEqual(failure.begin(corrected), input);
  const unknown = new ConfirmationAttempt(); unknown.begin(input); assert.equal(unknown.refuse(409, "new_unrecognized_error"), false); assert.deepEqual(unknown.begin(corrected), input);
  const mismatch = new ConfirmationAttempt(); mismatch.begin(input); assert.equal(mismatch.refuse(409, "booking_replay_mismatch"), false);
});
const host = { handle: "host", name: "Host", title: "Role", biography: "About", timezone: "UTC", focusAreas: [], socialProof: [] };
const event = { slug: "session", title: "Session", description: "Description", bookingHorizonDays: 90, durationMinutes: 30, color: "green", locationLabel: "Online", alternativeRequestsEnabled: false, questions: [] };
const capability = { nonce: input.nonce, startAt: input.startAt, inviteeTimezone: "UTC" };
const selection = { ...capability, expiresAt: "2030-06-03T09:30:00.000Z", selection: { startAt: input.startAt, endAt: "2030-06-03T09:30:00.000Z", inviteeTimezone: "UTC", hostTimezone: "UTC" }, host, event };
contract("AUTH-002", "document seeds reject other routes and capabilities and strip unrelated private fields", () => {
  assert.ok(seedSelection(selection, "host", "session", capability));
  for (const changed of [{ nonce: "wrong" }, { startAt: "2030-06-03T10:00:00.000Z" }, { inviteeTimezone: "Europe/London" }]) assert.equal(seedSelection(selection, "host", "session", { ...capability, ...changed }), undefined);
  assert.equal(seedSelection({ ...selection, selection: { ...selection.selection, hostTimezone: "Europe/London" } }, "host", "session", capability), undefined);
  assert.equal(seedEvent({ profile: host, eventType: event }, "other", "session"), undefined);
  assert.equal(seedProfile({ profile: host, eventTypes: [event] }, "other"), undefined);
  const clean = seedSelection({ ...selection, privateField: "secret", host: { ...host, id: "private-id" }, event: { ...event, locationValue: "private-address" } }, "host", "session", capability);
  assert.doesNotMatch(JSON.stringify(clean), /private-id|private-address|secret/);
});
