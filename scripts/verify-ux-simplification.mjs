import { evidencePath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { add, authenticate, call, data, neutral, origin, remove, sideEffects, snapshot } from "../tests/ux-simplification/helpers.mjs";

const checks = [], receipts = [];
const mark = (check) => { checks.push(check); console.log(`PASS ${check}`); };
const visible = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const text = (html) => visible(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
async function document(path, expected = 200) {
  const response = await call(path, undefined, expected);
  assert.match(response.headers.get("content-type"), /text\/html/);
  return visible(await response.text());
}
function progress(html, expected) {
  const navigation = html.match(/<nav[^>]*aria-label="Booking progress"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  if (!expected) { assert.equal(navigation, undefined); return; }
  assert.ok(navigation, "Booking progress should be rendered");
  const current = [...navigation.matchAll(/<span[^>]*aria-current="step"[^>]*>([\s\S]*?)<\/span>/g)];
  assert.equal(current.length, 1); assert.match(text(current[0][1]), new RegExp(expected));
}
const token = (receipt) => new URL(receipt.manageUrl).pathname.split("/").at(-1);
const receiptPath = (receipt) => `/book/dial-host/intro/confirmed?token=${encodeURIComponent(token(receipt))}`;
const noticeCount = (html) => [...html.matchAll(/<p[^>]*class="pb-request-notice"[^>]*role="status"/g)].length;
try {
  const fixture = await data("/__fixtures/setup", {});
  await authenticate(fixture.operatorEmail);
  const event = await data("/api/public/events/dial-host/intro");
  const answerKey = event.eventType.questions[0].key;
  const week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const availability = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`);
  const slots = availability.slots.filter((slot) => Date.parse(slot.startAt) > Date.now() + 86400000); assert.ok(slots.length > 60);
  async function selection(index, email) {
    const selected = await data("/api/public/book/dial-host/intro/selection", { startAt: slots[index].startAt, inviteeTimezone: "UTC" }, 201);
    return { nonce: selected.nonce, startAt: selected.selection.startAt, inviteeTimezone: "UTC", name: "Synthetic UX invitee", email, answers: { [answerKey]: "Synthetic answer retained for native retry" } };
  }
  const confirm = (body, expected = 201) => data("/api/public/book/dial-host/intro/confirm", body, expected);
  progress(await document("/book/dial-host/intro"), "Choose time");
  const parent = "https://synthetic-parent.example.test";
  await call("/api/app/embed-settings", { allowedOrigins: [parent] }, 200, true, "PUT");
  const embeddedChooseResponse = await call(`/embed/dial-host/intro?parent=${encodeURIComponent(parent)}`);
  assert.ok(embeddedChooseResponse.headers.get("content-security-policy").includes(parent));
  const embeddedChoose = visible(await embeddedChooseResponse.text()); progress(embeddedChoose, "Choose time");
  const requestLink = embeddedChoose.match(/href="([^"]+)"[^>]*>None of these work\?/); assert.ok(requestLink);
  const requestUrl = new URL(requestLink[1].replaceAll("&amp;", "&"), origin);
  assert.equal(requestUrl.pathname, "/embed/dial-host/intro/request"); assert.equal(requestUrl.searchParams.get("parent"), parent);
  const pendingBody = await selection(0, "pending-ux@dial.test");
  const detailsPath = `/book/dial-host/intro/details?${new URLSearchParams({ nonce: pendingBody.nonce, startAt: pendingBody.startAt, inviteeTimezone: pendingBody.inviteeTimezone })}`;
  const details = await document(detailsPath); progress(details, "Your details");
  assert.doesNotMatch(details, /pb-session-detail-link/);
  const embeddedDetails = await document(`/embed/dial-host/intro/details?${new URLSearchParams({ parent, nonce: pendingBody.nonce, startAt: pendingBody.startAt, inviteeTimezone: pendingBody.inviteeTimezone })}`);
  progress(embeddedDetails, "Your details");
  const pending = await confirm(pendingBody); const pendingHtml = await document(receiptPath(pending));
  assert.equal(pending.calendarState, "pending"); progress(pendingHtml, "Confirmed");
  assert.match(text(pendingHtml), /Booking confirmed/i); assert.doesNotMatch(text(pendingHtml), /You.re on the calendar|Joining link pending/);
  assert.equal(noticeCount(pendingHtml), 1, "Pending receipt should have one combined status notice");
  mark("actual production SSR marks choose/details/confirmed accurately and removes inert session-details decoration");
  const embeddedReceipt = await document(`/embed/dial-host/intro/confirmed?${new URLSearchParams({ parent, token: token(pending) })}`); progress(embeddedReceipt, "Confirmed");
  const manageLink = embeddedReceipt.match(/href="([^"]+)"[^>]*>Manage booking<\/a>/); assert.ok(manageLink);
  const manageUrl = new URL(manageLink[1].replaceAll("&amp;", "&"), origin);
  assert.equal(manageUrl.pathname, `/embed/manage/${token(pending)}`); assert.equal(manageUrl.searchParams.get("parent"), parent);
  progress(await document(manageUrl.pathname + manageUrl.search), undefined);
  progress(await document(`/embed/manage/not-a-valid-capability?parent=${encodeURIComponent(parent)}`, 404), undefined);
  const refusedParent = await call(`/embed/manage/${token(pending)}?parent=${encodeURIComponent("https://unlisted-parent.example.test")}`, undefined, 404);
  assert.match(refusedParent.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  mark("embedded choose/details/receipt SSR retains the allowlisted query parent in links/framing; manage resolves, invalid capability recovers, and unlisted parent is refused");

  for (const path of ["/book/dial-host", `/manage/${token(pending)}`, "/privacy"]) progress(await document(path), undefined);
  progress(await document("/book/dial-host/intro/confirmed?token=not-a-capability", 404), undefined);
  mark("profile, manage, privacy and unavailable-capability recovery SSR contain no booking progress");

  await call("/__fixtures/control", { kind: "upsert", failure: true }, 204);
  const pendingRows = await snapshot(); const failedJob = pendingRows.delivery_outbox.find((row) => row.kind === "calendar_upsert" && row.booking_id === pendingRows.bookings.find((row) => row.invitee_email === pendingBody.email).id);
  await data("/__fixtures/deliver", { id: failedJob.id });
  const failed = await data(`/api/public/manage/${token(pending)}`); assert.equal(failed.calendarState, "failed");
  const failedHtml = await document(receiptPath(failed)); progress(failedHtml, "Confirmed");
  assert.equal(noticeCount(failedHtml), 1, "Failed+pending meeting state should yield one failure notice");
  assert.match(text(failedHtml), /Contact the host/i); assert.doesNotMatch(text(failedHtml), /You.re on the calendar|refreshing delivery/i);
  await call("/__fixtures/control", { kind: "upsert", failure: false }, 204);
  const cancelled = await data(`/api/public/manage/${token(pending)}/cancel`, { reason: "Synthetic cancellation" });
  const cancelledHtml = await document(receiptPath(cancelled)); progress(cancelledHtml, undefined);
  assert.match(text(cancelledHtml), /This booking is cancelled/); assert.doesNotMatch(text(cancelledHtml), /Your booking is confirmed|Join session|Joining link pending/);
  assert.ok(noticeCount(cancelledHtml) <= 1);
  const cancellationDownload = cancelledHtml.match(/<a[^>]*href="([^"]+)"[^>]*>Download cancellation<\/a>/);
  assert.equal(cancellationDownload?.[1], cancelled.icsUrl); assert.doesNotMatch(text(cancelledHtml), /Add to calendar/);
  const cancellationFile = await call(new URL(cancelled.icsUrl).pathname);
  assert.match(cancellationFile.headers.get("content-type"), /text\/calendar/);
  const cancellationText = await cancellationFile.text(); assert.match(cancellationText, /METHOD:CANCEL/); assert.match(cancellationText, /STATUS:CANCELLED/);
  receipts.push({ state: "pending", calendarState: pending.calendarState }, { state: "failed", calendarState: failed.calendarState, meetingState: failed.meetingState }, { state: "cancelled", calendarState: cancelled.calendarState });
  mark("pending, failed and cancelled production receipts make honest claims with at most one recovery notice and a correctly labeled cancellation ICS download");

  const editable = await data(`/api/app/event-types/${fixture.eventId}`, undefined, 200, true);
  async function configureLocation(locationType, locationLabel, locationValue) {
    await call(`/api/app/event-types/${fixture.eventId}`, { ...editable, locationType, locationLabel, locationValue }, 200, true, "PATCH");
  }
  let next = 8;
  for (const [locationType, locationLabel, locationValue, link] of [
    ["in_person", "Host office", "Suite 8, Synthetic Street", false],
    ["phone", "Phone call", "+61 400 000 000", false],
    ["fixed_link", "Unsafe link", "javascript:alert('synthetic')", false],
    ["fixed_link", "Custom protocol", "zoommtg://synthetic.example.test/session", false],
    ["fixed_link", "Meeting link", "https://session.example.test/actual-join", true],
    ["fixed_link", "Local synthetic link", "http://meeting.example.test/actual-join", true],
  ]) {
    await configureLocation(locationType, locationLabel, locationValue);
    const receipt = await confirm(await selection(next, `location-${next}@dial.test`)); next += 4;
    const html = await document(receiptPath(receipt)); const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1]; assert.ok(main);
    const joining = main.match(/<a[^>]*href="([^"]+)"[^>]*>Join session<\/a>/);
    if (link) assert.equal(joining?.[1], locationValue); else { assert.equal(joining, null); assert.match(text(main), new RegExp(locationLabel)); }
    if (locationType === "in_person" || locationType === "phone") assert.ok(text(main).includes(locationValue), "Plain physical/phone value must remain usable");
    assert.doesNotMatch(main, /href="(?:javascript:|zoommtg:)/i);
    receipts.push({ locationType, locationValue, joiningLink: !!joining });
  }
  mark("actual booking location snapshots render physical/phone information as text and only http(s) session values as joining links");

  await configureLocation("google_meet", "Google Meet", "");
  const body = await selection(40, "blocked-ux@dial.test"); const rule = await add("email", body.email);
  const beforeBlock = sideEffects(await snapshot());
  await neutral(await call("/api/public/book/dial-host/intro/confirm", body, 409), "booking_unavailable");
  assert.deepEqual(sideEffects(await snapshot()), beforeBlock);
  progress(await document(`/book/dial-host/intro/details?${new URLSearchParams({ nonce: body.nonce, startAt: body.startAt, inviteeTimezone: body.inviteeTimezone })}`), "Your details");
  await remove(rule.id); const receipt = await confirm(body);
  const beforeReplay = sideEffects(await snapshot()); const repeated = await confirm(body, 200);
  assert.deepEqual(repeated, receipt); assert.deepEqual(sideEffects(await snapshot()), beforeReplay);
  mark("neutral blocked409 consumes no nonce or booking effects; the same selection and answers commit once after unblocking and replay preserves capability");

  const lostBody = await selection(48, "lost-response-ux@dial.test");
  await call("/__fixtures/ux/accepted-response-loss", lostBody, 503);
  const committed = sideEffects(await snapshot()); assert.equal(committed.bookings.filter((row) => row.invitee_email === lostBody.email).length, 1);
  const restored = await confirm(lostBody, 200); assert.deepEqual(sideEffects(await snapshot()), committed);
  progress(await document(receiptPath(restored)), "Confirmed");
  assert.deepEqual(await confirm(lostBody, 200), restored);
  mark("fixture-only post-commit response loss recovers through matching native confirmation retry with the same receipt capability and no duplicate writes");

  await writeFile(evidencePath("ux-simplification.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), origin, providers: "task-owned synthetic calendar/mail", checks, receipts, limits: ["Actual production SSR and native Worker/D1 HTTP only; no browser process was launched.", "Client redirect branching, saving-finally behavior, retained form inputs, settings controls and mobile visual layout remain static-review claims under the explicit browser hold.", "Accepted-response loss is introduced only by the fixture after production commits; real network ambiguity is not claimed."] }, null, 2) + "\n");
} catch (error) {
  await writeFile(evidencePath("ux-simplification-failure.json"), JSON.stringify({ observedAt: new Date().toISOString(), origin, checks, receipts, failure: error.message, stack: error.stack }, null, 2) + "\n"); throw error;
}
