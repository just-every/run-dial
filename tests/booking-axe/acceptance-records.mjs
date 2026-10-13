import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { auditor, trackPage } from "./audit.mjs";
import { keyboardControls } from "./acceptance-keyboard.mjs";

export async function seedAcceptanceRecords(owner, origin, fixture) {
  const headers = { Origin: origin };
  const request = async (method, path, data, expected = 200) => {
    const response = await owner.request[method](origin + path, { headers, data });
    assert.equal(response.status(), expected, `${method} ${path}: ${await response.text()}`); return response.json();
  };
  const event = await request("get", `/api/app/event-types/${fixture.eventId}`);
  const date = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const availability = await request("get", `/api/public/book/dial-host/intro/availability?week=${date}`);
  const booking = await request("post", "/api/app/bookings", { idempotencyKey: randomUUID(), eventTypeId: fixture.eventId, startAt: availability.slots[0].startAt, inviteeTimezone: "UTC", name: "Acceptance record invitee", email: "acceptance-record@dial.test", answers: Object.fromEntries(event.questions.map(q => [q.key, "A detailed discussion of a useful next step."])), overrideNoticeAndHorizon: false }, 201);
  const composition = { inviteeName: "Acceptance request invitee", inviteeEmail: "acceptance-request@dial.test", inviteeTimezone: "UTC", note: "Find an alternative conversation window.", windows: [{ date, startMinute: 600, endMinute: 660 }] };
  const review = await request("post", "/api/public/events/dial-host/intro/request/review", composition, 201);
  await request("post", `/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(review.nonce)}`, composition, 201);
  const requests = await request("get", "/api/app/availability-requests");
  const requestId = requests.find(row => row.inviteeEmail === composition.inviteeEmail).id;
  for (const [entity, id] of [["booking", booking.id], ["eventType", event.id], ["availabilityRequest", requestId]]) {
    for (const [kind, label, value, options] of [["text", "Internal reference", "DISCOVERY-42", []], ["long_text", "Operator context", "A private note for follow-up.\nReview the proposed scope before our next conversation.", []], ["single_choice", "Follow-up priority", "High", ["Normal", "High"]], ["checkbox", "Review complete", true, []]]) {
      const field = await request("post", "/api/app/custom-fields", { entity, kind, label, options }, 201);
      await request("put", `/api/app/custom-fields/${entity}/${id}/${field.id}`, { value });
    }
  }
  for (const path of ["/book/dial-host", "/book/dial-host/intro", "/api/public/profiles/dial-host", "/api/public/events/dial-host/intro"]) {
    const response = await owner.request.get(origin + path);
    assert.equal(response.status(), 200, `public projection ${path}`);
    const body = await response.text();
    assert.ok(!body.includes("DISCOVERY-42") && !body.includes("A private note for follow-up."), `custom annotation absent from public projection ${path}`);
  }
  return { booking, requestId };
}

export async function avatarEvidence(browser, origin, storageState, scans, errors, checks) {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ storageState, viewport: { width, height: width === 1440 ? 1024 : 844 } });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      await page.goto(origin + "/app/profile");
      const upload = page.getByLabel("Upload avatar", { exact: true });
      await upload.waitFor(); await page.waitForFunction(() => !globalThis.document.querySelector('input[type=file]')?.disabled);
      await auditor(page, width, scans)("avatar-editor-before");
      await keyboardControls(page, [["Upload avatar", upload]], "avatar-before", width, checks);
      await page.goto(origin + "/book/dial-host"); await page.locator(".pb-event-card").first().waitFor();
      await auditor(page, width, scans)("avatar-public-before");
      await page.goto(origin + "/app/profile");
      await page.getByLabel("Upload avatar", { exact: true }).setInputFiles("tests/avatar/jpeg.jpg");
      const replace = page.getByLabel("Replace avatar", { exact: true }); await replace.waitFor();
      await page.waitForFunction(() => [...globalThis.document.querySelectorAll('img[src^="/media/"]')].some(img => img.complete && img.naturalWidth > 0));
      await auditor(page, width, scans)("avatar-editor-after");
      await keyboardControls(page, [["Replace avatar", replace], ["Remove avatar", page.getByRole("button", { name: "Remove avatar", exact: true })]], "avatar-after", width, checks);
      await page.goto(origin + "/book/dial-host"); await page.locator(".pb-event-card").first().waitFor();
      await page.waitForFunction(() => [...globalThis.document.querySelectorAll('img[src^="/media/"]')].some(img => img.complete && img.naturalWidth > 0));
      await auditor(page, width, scans)("avatar-public-after");
      await page.goto(origin + "/app/profile");
      const remove = page.getByRole("button", { name: "Remove avatar", exact: true }); await remove.waitFor();
      await remove.click(); await page.getByLabel("Upload avatar", { exact: true }).waitFor();
      checks.push({ check: `Avatar upload/render/remove at ${width}px through real UI`, passed: true });
    } finally { await context.close(); }
  }
  // Preserve a real uploaded avatar for event/detail/confirmation flow evidence.
  const response = await browser.newContext({ storageState });
  try {
    const page = await response.newPage(); await page.goto(origin + "/app/profile");
    await page.getByLabel("Upload avatar", { exact: true }).setInputFiles("tests/avatar/jpeg.jpg");
    await page.getByLabel("Replace avatar", { exact: true }).waitFor();
  } finally { await response.close(); }
}
