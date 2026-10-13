import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contract } from "./contract.mjs";

const directory = await mkdtemp(resolve(tmpdir(), "dial-event-defaults-"));
let core;
try {
  const output = resolve(directory, "core.mjs");
  await build({ stdin: { contents: 'export { defaultEventTypeInput, defaultEventQuestions } from "./src/core/features/event-types/defaults"; export { validateInvitee } from "./src/core/features/bookings/types";', resolveDir: new URL("..", import.meta.url).pathname }, bundle: true, platform: "node", format: "esm", outfile: output, logLevel: "silent" });
  core = await import(pathToFileURL(output).href);
} finally { await rm(directory, { recursive: true, force: true }); }

contract("EVENT-002", "fresh event drafts preserve accepted scheduling defaults and never share editable arrays", () => {
  const first = core.defaultEventTypeInput(), second = core.defaultEventTypeInput();
  assert.equal(second.durationMinutes, 30); assert.equal(second.slotIncrementMinutes, 15);
  assert.equal(second.minimumNoticeMinutes, 240); assert.equal(second.bookingHorizonDays, 60);
  assert.equal(second.beforeBufferMinutes, 0); assert.equal(second.afterBufferMinutes, 0); assert.equal(second.hostDayBookingLimit, null);
  first.questions[0].label = "Owner's edited agenda"; first.questions[0].options.push({ value: "local", label: "Local" }); first.availability.push({ weekday: 1, startMinute: 540, endMinute: 600 });
  assert.deepEqual(second.questions, core.defaultEventQuestions()); assert.equal(second.questions[0].label, "Agenda"); assert.deepEqual(second.questions[0].options, []); assert.deepEqual(second.availability, []);
});

contract("EVENT-003", "default optional agenda enforces actual answer boundaries and retains mandatory name/email", () => {
  const event = core.defaultEventTypeInput(), key = event.questions[0].key;
  const candidate = { name: "Synthetic invitee", email: "agenda@dial.test", answers: {} };
  assert.ok(core.validateInvitee(event, candidate));
  assert.ok(core.validateInvitee(event, { ...candidate, answers: { [key]: "A".repeat(500) } }));
  assert.equal(core.validateInvitee(event, { ...candidate, answers: { [key]: "A".repeat(501) } }), undefined);
  assert.equal(core.validateInvitee(event, { ...candidate, name: "" }), undefined);
  assert.equal(core.validateInvitee(event, { ...candidate, email: "invalid" }), undefined);
  assert.equal(core.validateInvitee(event, { ...candidate, answers: { unconfigured: "unexpected" } }), undefined);
  const explicitEmpty = { ...event, questions: [] };
  assert.ok(core.validateInvitee(explicitEmpty, candidate));
  assert.equal(core.validateInvitee(explicitEmpty, { ...candidate, answers: { [key]: "No hidden agenda" } }), undefined);
});
