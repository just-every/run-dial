import { evidencePath as outputPath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { readTestMail } from "../tests/auth-client.mjs";
import { authenticateViaSyntheticMail, call, data, origin, productRecords, snapshot } from "../tests/availability-diagnostics/helpers.mjs";

const evidencePath = outputPath("profile-authoring-native.json"), checks = [];
const mark = (message) => { checks.push(message); console.log(`PASS ${message}`); };
const fields = ["handle", "name", "title", "biography", "timezone", "focusAreas", "socialProof"];
const inputOf = (record) => Object.fromEntries(fields.map((key) => [key, record[key]]));
const makeProfile = (index) => ({ handle: `author-${index}`, name: `Host ${index}`, title: `Title ${index}`, biography: `Biography ${index}`, timezone: "UTC", focusAreas: [{ label: `First ${index}` }, { label: `Second ${index}` }], socialProof: [{ quote: `Quote ${index}`, attribution: `Attribution ${index}` }] });
const rowsExceptProfile = (state) => Object.fromEntries(Object.entries(productRecords(state)).filter(([table]) => !["host_profiles", "profile_focus_areas", "social_proof_entries"].includes(table)));
async function unchanged(action) { const before = productRecords(await snapshot()); const result = await action(); assert.deepEqual(productRecords(await snapshot()), before); return result; }
async function assertPublic(profile) {
  const result = await data(`/api/public/profiles/${profile.handle}`);
  assert.equal(result.profile.avatarKey, null);
  assert.deepEqual(result.profile, { ...inputOf(profile), avatarKey: null });
  for (const key of ["id", "createdAt", "updatedAt", "singletonKey"]) assert.ok(!Object.hasOwn(result.profile, key));
  const html = await (await call(`/book/${profile.handle}`)).text();
  assert.ok(!html.includes(profile.id)); assert.ok(!html.includes(profile.createdAt));
  return html;
}

try {
  const fixture = await data("/__fixtures/profile-setup", {}); await authenticateViaSyntheticMail(fixture.operatorEmail);
  const initial = await snapshot();
  assert.equal(initial.host_profiles.length, 0); assert.equal(initial.profile_focus_areas.length, 0); assert.equal(initial.social_proof_entries.length, 0);
  await unchanged(async () => {
    await call("/api/app/profile", undefined, 401);
    const absentProfile = await call("/api/app/profile", undefined, 200, true);
    assert.match(absentProfile.headers.get("content-type"), /^application\/json\b/);
    assert.equal(await absentProfile.json(), null);
    await call("/api/public/profiles/author-0", undefined, 404);
    await call("/api/public/home/profile", undefined, 404);
    await call("/book/author-0", undefined, 404);
    await call("/api/app/profile", makeProfile(0), 401, false, "PATCH");
    await call("/api/app/profile", makeProfile(0), 403, true, "PATCH", { origin: "https://forged.example.test" });
    const invalid = [{ handle: "Invalid handle" }, { name: "" }, { name: "N".repeat(121) }, { title: "T".repeat(181) }, { biography: "B".repeat(2001) }, { timezone: "US/Eastern" }, { timezone: "Mars/Orbit" }, { focusAreas: Array.from({ length: 7 }, () => ({ label: "Extra" })) }, { focusAreas: [{ label: "L".repeat(41) }] }, { socialProof: Array.from({ length: 4 }, () => ({ quote: "Extra", attribution: "Extra" })) }, { socialProof: [{ quote: "Q".repeat(281), attribution: "Who" }] }, { socialProof: [{ quote: "Quote", attribution: "A".repeat(121) }] }];
    for (const changes of invalid) await call("/api/app/profile", { ...makeProfile(0), ...changes }, 400, true, "PATCH");
  });
  mark("fresh profile setup returns authenticated private200 JSON null and public404 before creation; auth/origin/input bounds and canonical timezone refusals leave product data unchanged");

  const submissions = Array.from({ length: 4 }, (_, index) => makeProfile(index));
  const saved = await Promise.all(submissions.map((profile) => data("/api/app/profile", profile, 200, true, "PATCH")));
  let profile = await data("/api/app/profile", undefined, 200, true), state = await snapshot();
  assert.equal(state.host_profiles.length, 1); assert.ok(saved.every((result) => result.id === profile.id));
  const coherent = (result) => assert.ok(submissions.some((input) => JSON.stringify(input) === JSON.stringify(inputOf(result))), "each parent and child read must be one coherent submitted profile");
  saved.forEach(coherent); coherent(profile);
  assert.equal(state.profile_focus_areas.length, 2); assert.equal(state.social_proof_entries.length, 1);
  assert.ok([...state.profile_focus_areas, ...state.social_proof_entries].every((row) => row.profile_id === profile.id));
  assert.deepEqual(rowsExceptProfile(state), rowsExceptProfile(initial));
  const stable = { id: profile.id, createdAt: profile.createdAt };
  const duringWrites = await Promise.all(submissions.flatMap((input) => [data("/api/app/profile", input, 200, true, "PATCH"), data("/api/app/profile", undefined, 200, true), data("/api/app/profile", undefined, 200, true)]));
  duringWrites.forEach((result) => { coherent(result); assert.equal(result.id, stable.id); assert.equal(result.createdAt, stable.createdAt); });
  profile = await data("/api/app/profile", undefined, 200, true); coherent(profile);
  mark("four concurrent native first saves commit one stable singleton identity; every save response and eight concurrent GET samples has a coherent complete parent/child set without collisions or unrelated product writes");

  const oldHandle = profile.handle;
  const revised = { ...inputOf(profile), handle: "renamed-host", name: "Host <script>profileProbe</script>", title: "Advisor & author", biography: "Biography <img src=x onerror=profileProbe()> & current", focusAreas: [{ label: "New <focus>" }], socialProof: [{ quote: "Quote <script>quoteProbe</script>", attribution: "Author & current" }] };
  for (let attempt = 0; attempt < 2; attempt++) {
    profile = await data("/api/app/profile", revised, 200, true, "PATCH");
    assert.equal(profile.id, stable.id); assert.equal(profile.createdAt, stable.createdAt); assert.deepEqual(inputOf(profile), revised);
  }
  state = await snapshot(); assert.equal(state.profile_focus_areas.length, 1); assert.equal(state.social_proof_entries.length, 1);
  await call(`/api/public/profiles/${oldHandle}`, undefined, 404); await call(`/book/${oldHandle}`, undefined, 404);
  const html = await assertPublic(profile);
  assert.match(html, /Host &lt;script&gt;profileProbe&lt;\/script&gt;/);
  assert.match(html, /Biography &lt;img/); assert.match(html, /Quote &lt;script&gt;quoteProbe/);
  assert.ok(!html.includes("<script>profileProbe</script>")); assert.ok(!html.includes("<img src=x onerror=profileProbe()>"));
  assert.ok(!html.includes("<script>quoteProbe</script>"));
  // PROFILE-001: the in-app preview renders the same content as the public page.
  const escaped = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
  const appHtml = await (await call("/app/profile", undefined, 200, true)).text(), preview = appHtml.slice(appHtml.indexOf("Public profile preview"));
  assert.ok(preview.length > 0 && appHtml.includes("Public profile preview"), "the authenticated profile page renders the preview");
  for (const text of [profile.name, profile.title, profile.biography, ...profile.focusAreas.map((area) => area.label), ...profile.socialProof.flatMap((entry) => [entry.quote, entry.attribution])]) {
    assert.ok(preview.includes(escaped(text)), "the preview shows each saved field");
    assert.ok(html.includes(escaped(text)), "the public page shows the same field");
  }
  mark("repeated profile edits retain identity/createdAt, replace children without duplicates, rename public routes and render current safely escaped SSR data without private IDs or timestamps; PROFILE-001 the in-app preview shows the same fields as the public page");

  const event = await data(`/api/app/event-types/${fixture.eventId}`, undefined, 200, true);
  const startAt = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10) + "T10:00:00.000Z";
  const body = { idempotencyKey: randomUUID(), eventTypeId: event.id, startAt, inviteeTimezone: "America/New_York", name: "Synthetic profile invitee", email: "profile-invitee@dial.test", answers: { [event.questions[0].key]: "Profile snapshot answer" }, overrideNoticeAndHorizon: false };
  const booking = await data("/api/app/bookings", body, 201, true), beforeZone = await snapshot();
  profile = await data("/api/app/profile", { ...inputOf(profile), timezone: "Asia/Katmandu" }, 200, true, "PATCH");
  assert.equal(profile.id, stable.id); assert.equal(profile.createdAt, stable.createdAt);
  assert.deepEqual(rowsExceptProfile(await snapshot()), rowsExceptProfile(beforeZone));
  const retained = await data(`/api/app/bookings/${booking.id}`, undefined, 200, true);
  assert.deepEqual(retained, { ...booking, customFields: [] }); assert.equal(retained.hostTimezone, "UTC"); assert.equal(retained.inviteeTimezone, "America/New_York"); assert.equal(retained.occurrence.startAt, startAt);
  const canonicalReplay = await data("/api/app/bookings", body, 200, true); assert.equal(canonicalReplay.id, booking.id);
  const denied = await data("/api/app/bookings", { ...body, idempotencyKey: randomUUID(), email: "occupied-profile-invitee@dial.test" }, 409, true);
  assert.equal(denied.error.code, "slot_unavailable"); assert.ok(denied.error.details.includes("dial_booking"));
  await assertPublic(profile);
  const final = await snapshot(); assert.equal(final.bookings.length, 1); assert.equal(final.booking_occurrences.length, 1); assert.equal(final.fixture_mail.length, 0); assert.equal(final.fixture_events.length, 0);
  const signInMail = await readTestMail(origin); assert.equal(signInMail.length, 1); assert.ok(signInMail[0].to.includes(fixture.operatorEmail));
  mark("host timezone edits preserve committed booking/answer/capability/claim snapshots and exact retry identity; the occupied UTC instant remains denied and booking provider sends stay queued");
  await writeFile(evidencePath, JSON.stringify({ status: "verified", verifiedAt: new Date().toISOString(), origin, checks, proofs: { concurrentFirstSaves: 4, retainedSingletonId: stable.id, syntheticSignInMail: 1, bookingProviderSendEffects: 0, committedBookings: 1 }, limits: ["Actual native Hono/Start/D1/DO and SSR in profile-only preview configuration, fresh task-owned temporary state and synthetic providers only; native authentication follows one explicitly authorized synthetic sign-in email and never injects a session.", "Profile creation UI, focus retention, transport recovery and busy controls remain source-reviewed only under the browser launch hold.", "Blank profile setup removes only the synthetic setup profile before any booking exists; it is guarded against reusing populated fixture state and never targets retained15702."] }, null, 2) + "\n");
} catch (error) {
  await writeFile(evidencePath, JSON.stringify({ status: "failed", observedAt: new Date().toISOString(), origin, checks, failure: error.message, stack: error.stack }, null, 2) + "\n"); throw error;
}
