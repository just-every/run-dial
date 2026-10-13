import { evidencePath } from "../scripts/evidence-path.mjs";
import { localMagicLink, confirmAuthLink } from "./auth-client.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

async function moduleAt(path) {
  const compiled = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript,${encodeURIComponent(compiled.outputFiles[0].text)}`);
}
function parse(file) {
  assert.ok(file.endsWith("\r\n"));
  assert.doesNotMatch(file.replaceAll("\r\n", ""), /[\r\n]/, "all line endings are CRLF");
  for (const line of file.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, "physical content lines fit 75 octets");
  const lines = file.replace(/\r\n[ \t]/g, "").trimEnd().split("\r\n");
  assert.deepEqual(lines.filter((line) => /^(BEGIN|END):/.test(line)), ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "END:VEVENT", "END:VCALENDAR"], "escaped text cannot inject a component");
  const values = Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)]));
  for (const field of ["DTSTAMP", "DTSTART", "DTEND"]) assert.match(values[field], /^\d{8}T\d{6}Z$/, `${field} is a second-precision UTC date`);
  return values;
}
const decodedText = (text) => text.replace(/\\([\\;,n])/g, (_, character) => character === "n" ? "\n" : character);

contract("CAL-009", "calendar files preserve UTC instants, escaped UTF8 text and one stable cancellation sequence through the mail adapter", async () => {
  const { bookingIcs, initialBookingIcs } = await moduleAt("../src/core/features/bookings/calendar-file.ts");
  const title = "工程🌏".repeat(22) + ", plan; \\path\r\nBEGIN:VEVENT\rEND:VEVENT\nNext";
  const location = "Room, B; \\building\r\nSecond floor";
  const booking = { id: "fixture-one", icalUid: "dial-fixture-one@dial", state: "confirmed", updatedAt: "2030-03-10T12:34:56.789Z", eventTitle: title, locationType: "in_person", locationValue: location,
    occurrence: { sequence: 0, startAt: "2030-03-10T01:30:00-05:00", endAt: "2030-03-10T03:30:00-04:00" } };
  const file = bookingIcs(booking);
  const fields = parse(file);
  assert.equal(fields.DTSTAMP, "20300310T123456Z");
  assert.equal(fields.DTSTART, "20300310T063000Z");
  assert.equal(fields.DTEND, "20300310T073000Z");
  assert.equal(decodedText(fields.SUMMARY), title.replace(/\r\n|\r|\n/g, "\n"));
  assert.equal(decodedText(fields.LOCATION), location.replace(/\r\n|\r|\n/g, "\n"));
  assert.equal(bookingIcs({ ...booking, occurrence: { ...booking.occurrence, startAt: "2030-03-10T06:30:00.000Z", endAt: "2030-03-10T07:30:00.000Z" } }), file, "equivalent source offsets have identical UTC calendar bytes");
  const moved = { ...booking, state: "rescheduled", occurrence: { sequence: 1, startAt: "2030-03-11T09:30:00+10:00", endAt: "2030-03-11T10:00:00+10:00" } };
  const movedFields = parse(bookingIcs(moved));
  const cancelledFile = bookingIcs({ ...moved, state: "cancelled" });
  const cancelled = parse(cancelledFile);
  assert.equal(movedFields.UID, fields.UID); assert.equal(movedFields.SEQUENCE, "1");
  assert.equal(cancelled.UID, fields.UID); assert.equal(cancelled.SEQUENCE, "2");
  assert.equal(cancelled.METHOD, "CANCEL"); assert.equal(cancelled.STATUS, "CANCELLED");
  assert.equal(bookingIcs({ ...moved, state: "cancelled" }), cancelledFile, "repeated download does not increment again");
  const initial = initialBookingIcs({ bookingId: booking.id, eventTitle: title, startAt: booking.occurrence.startAt, endAt: booking.occurrence.endAt, location, createdAt: booking.updatedAt });
  assert.equal(initial, file);
  const { ResendMailSender } = await moduleAt("../src/core/platform/mail/resend.ts");
  let envelope;
  const sender = new ResendMailSender({ apiKey: "synthetic", fromEmail: "no-reply@dial.test" }, async (_url, init) => { envelope = JSON.parse(init.body); return Response.json({ id: "synthetic" }); });
  await sender.send({ to: "synthetic@dial.test", subject: "Synthetic", text: "Synthetic", idempotencyKey: "ics-fixture", attachments: [{ filename: "booking.ics", contentType: "text/calendar", contentBase64: Buffer.from(file, "utf8").toString("base64") }] });
  assert.equal(Buffer.from(envelope.attachments[0].content, "base64").toString("utf8"), file);
  assert.equal(envelope.attachments[0].content_type, "text/calendar");
});

contract("CAL-009", "real local capability downloads and synthetic confirmation attachment track the current occurrence and cancellation", async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), "dial-calendar-file-"));
  const cwd = new URL("../", import.meta.url), config = "tests/calendar-file-worker.wrangler.toml", origin = "http://127.0.0.1:15719";
  let worker, output = "";
  context.after(async () => { if (worker?.exitCode === null) { const stopped = new Promise((done) => worker.once("exit", done)); try { process.kill(-worker.pid, "SIGTERM"); } catch { worker.kill("SIGTERM"); } await stopped; } await writeFile(evidencePath("calendar-file-worker.log"), output); await rm(persist, { recursive: true, force: true }); });
  await new Promise((done, reject) => { const child = spawn("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-calendar-file-test", "--local", "--persist-to", persist, "--config", config], { cwd, stdio: "pipe", env: { ...process.env, CI: "1" } }); let log = ""; child.stdout.on("data", (chunk) => { log += chunk; }); child.stderr.on("data", (chunk) => { log += chunk; }); child.once("error", reject); child.once("exit", (code) => code === 0 ? done() : reject(new Error(log))); });
  worker = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", persist, "--config", config, "--ip", "127.0.0.1", "--port", "15719", "--inspector-port", "15729"], { cwd, stdio: "pipe", detached: true, env: { ...process.env, CI: "1" } });
  worker.stdout.on("data", (chunk) => { output += chunk; }); worker.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; ; attempt++) { if (worker.exitCode !== null || attempt >= 480) throw new Error(output.slice(-10000)); try { if ((await fetch(origin + "/health")).ok) break; } catch { /* isolated runtime starts */ } await new Promise((done) => setTimeout(done, 125)); }
  let cookie;
  async function call(path, body, expected = 200, authenticated = false, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(origin + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(authenticated ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`); return response;
  }
  const data = async (...args) => (await call(...args)).json();
  const fixture = await data("/__fixtures/setup", {});
  await call("/api/auth/magic-links", { email: fixture.operatorEmail }, 202);
  const link = await localMagicLink(origin);
  const signedIn = await confirmAuthLink(link.developmentLink); cookie = signedIn.headers.get("set-cookie").split(";")[0];
  const event = await data(`/api/app/event-types/${fixture.eventId}`, undefined, 200, true);
  const title = "工程🌏".repeat(12) + ", plan; \\path\r\nBEGIN:VEVENT\rEND:VEVENT";
  const location = "Room, B; \\building\r\nSecond floor";
  await data(`/api/app/event-types/${fixture.eventId}`, { ...event, title, locationType: "in_person", locationLabel: "Meeting room", locationValue: location }, 200, true, "PATCH");
  const week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const availability = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=America%2FNew_York`);
  const slots = availability.slots.filter((slot) => Date.parse(slot.startAt) > Date.now() + 2 * 86400000);
  const selection = await data("/api/public/book/dial-host/intro/selection", { startAt: slots[0].startAt, inviteeTimezone: "America/New_York" }, 201);
  const receipt = await data("/api/public/book/dial-host/intro/confirm", { nonce: selection.nonce, startAt: slots[0].startAt, inviteeTimezone: "America/New_York", name: "ICS fixture", email: "ics-fixture@dial.test", answers: { [event.questions[0].key]: "Synthetic answer excluded from calendar file" } }, 201);
  const token = new URL(receipt.manageUrl).pathname.split("/").at(-1);
  const response = await call(`/api/public/manage/${token}/calendar.ics`);
  assert.match(response.headers.get("content-type"), /^text\/calendar/);
  const initial = parse(await response.text());
  assert.equal(decodedText(initial.SUMMARY), title.replace(/\r\n|\r|\n/g, "\n"));
  assert.equal(decodedText(initial.LOCATION), location.replace(/\r\n|\r|\n/g, "\n"));
  await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {});
  let state = await data("/__fixtures/status");
  const booking = state.bookings.find((row) => row.invitee_email === "ics-fixture@dial.test");
  const email = state.fixture_mail.map((row) => JSON.parse(row.message_json)).find((message) => message.to === "ics-fixture@dial.test" && message.attachments?.length);
  const attachedFile = Buffer.from(email.attachments[0].contentBase64, "base64").toString("utf8");
  const attachment = parse(attachedFile);
  for (const field of ["UID", "SEQUENCE", "DTSTART", "DTEND", "SUMMARY", "LOCATION"]) assert.equal(attachment[field], initial[field]);
  assert.doesNotMatch(attachedFile, /Synthetic answer|mailto:|manage\//);
  const selected = await data(`/api/public/manage/${token}/reschedule/selection`, { startAt: slots[8].startAt, inviteeTimezone: "Australia/Brisbane" }, 201);
  await data(`/api/public/manage/${token}/reschedule`, { nonce: selected.nonce, startAt: slots[8].startAt, inviteeTimezone: "Australia/Brisbane" });
  const moved = parse(await (await call(`/api/public/manage/${token}/calendar.ics`)).text());
  assert.equal(moved.UID, initial.UID); assert.equal(moved.SEQUENCE, "1"); assert.notEqual(moved.DTSTART, initial.DTSTART);
  await data(`/api/public/manage/${token}/cancel`, { reason: "Synthetic fixture" });
  const cancelledFile = await (await call(`/api/public/manage/${token}/calendar.ics`)).text();
  const cancelled = parse(cancelledFile);
  assert.equal(cancelled.UID, initial.UID); assert.equal(cancelled.SEQUENCE, "2"); assert.equal(cancelled.STATUS, "CANCELLED"); assert.equal(cancelled.METHOD, "CANCEL");
  assert.equal(await (await call(`/api/public/manage/${token}/calendar.ics`)).text(), cancelledFile);
  await call(`/api/public/manage/${"a".repeat(43)}/calendar.ics`, undefined, 404);
  await call(`/api/app/bookings/${booking.id}`, undefined, 202, true, "DELETE");
  await call(`/api/public/manage/${token}/calendar.ics`, undefined, 404);
  assert.doesNotMatch(output, /Can.t read from request stream|Error inside ProxyWorker|Uncaught TypeError/);
  await writeFile(evidencePath("calendar-file.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), origin, providers: "task-owned synthetic calendar/mail", proofs: ["UTF8/CRLF escaping and 75-octet folding", "second-precision UTC instants across DST and equivalent offsets", "stable UID across initial mail/download/reschedule/cancel", "monotonic reschedule/cancel sequence and repeatable cancellation bytes", "native manage-capability validation and erasure denial", "existing Resend adapter preserves calendar attachment bytes"], limits: ["Full iTIP organizer and attendee semantics are not certified", "Google provider UID and local ICS UID interoperability requires live acceptance"] }, null, 2) + "\n");
});
