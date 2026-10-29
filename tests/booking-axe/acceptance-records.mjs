import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { auditor, trackPage } from "./audit.mjs";
import { evidencePath } from "../../scripts/evidence-path.mjs";
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

export async function bookingRecordDeliveryJourney(browser, owner, origin, booking, scans, errors) {
  const storageState = await owner.storageState();
  const deliveries = async () => {
    const response = await owner.request.get(`${origin}/api/app/bookings/${booking.id}/deliveries`);
    assert.equal(response.status(), 200); return response.json();
  };
  const mails = (await deliveries()).filter(delivery => delivery.kind === "mail_send");
  assert.ok(mails.length >= 2, "OPER-004 has separate invitee and host confirmation emails");
  for (const [index, width] of [1440, 390].entries()) {
    const context = await browser.newContext({ storageState, viewport: { width, height: width === 1440 ? 1024 : 844 } });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      await page.goto(origin + "/app/bookings?query=Acceptance%20record");
      await page.getByRole("heading", { name: "Acceptance record invitee", exact: true }).waitFor();
      await page.getByText("Saved value: DISCOVERY-42", { exact: true }).waitFor();
      for (const value of ["Saved value: High", "Saved value: Yes", "Saved value: A private note for follow-up.\nReview the proposed scope before our next conversation."]) assert.ok(await page.getByText(value, { exact: true }).isVisible(), "OPER-004 shows every stored custom-field value");
      assert.ok(await page.getByRole("heading", { name: booking.inviteeName, exact: true }).locator("..").getByText(booking.eventTitle, { exact: true }).isVisible());
      assert.ok(await page.locator("dl > div").filter({ has: page.getByText("Location", { exact: true }) }).locator("dd").getByText(booking.locationLabel, { exact: true }).isVisible());
      const audit = async state => {
        await auditor(page, width, scans)(`OPER-004-${state}`);
        await page.getByRole("region", { name: "Deliveries", exact: true }).screenshot({ path: evidencePath(`OPER-004-${width}-${state}-deliveries.png`), caret: "initial" });
      };
      assert.ok(await page.getByText("A detailed discussion of a useful next step.", { exact: false }).first().isVisible());
      const timeFacts = booking.inviteeTimezone === booking.hostTimezone ? [["Time", booking.hostTimezone]] : [["Host time", booking.hostTimezone], ["Invitee time", booking.inviteeTimezone]];
      assert.equal(await page.locator("dl dt").filter({ hasText: /^(Time|Host time|Invitee time)$/ }).count(), timeFacts.length, "each distinct zone has exactly one time fact");
      for (const [label, zone] of timeFacts) {
        const value = page.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
        const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
        const tokens = [booking.occurrence.startAt, booking.occurrence.endAt].flatMap(instant => formatter.formatToParts(new Date(instant)).filter(part => part.type !== "literal" && !(part.type === "minute" && part.value === "00")).map(part => part.value));
        const text = await value.innerText();
        assert.ok(tokens.every(token => text.includes(token)), `OPER-004 ${label} shows both local endpoints: ${JSON.stringify({ text, tokens })}`);
        assert.ok(zone === booking.hostTimezone ? await page.getByText(`Times in ${zone}`, { exact: true }).isVisible() : text.includes(zone), `OPER-004 ${label} has an IANA zone context`);
      }
      assert.ok(await page.getByRole("region", { name: "Booking history" }).getByText(/Created/).isVisible());
      const target = mails[index];
      const row = id => page.locator(`[data-delivery-id="${id}"]`);
      await row(target.id).getByText("Queued", { exact: true }).waitFor();
      assert.ok(await row(target.id).getByText(`To: ${target.recipient}`, { exact: true }).isVisible());
      assert.ok(await row(target.id).getByText(target.subject, { exact: true }).isVisible());
      await page.getByText("Update pending", { exact: true }).waitFor();
      await page.getByText("Meeting link pending", { exact: true }).waitFor();
      await audit("queued");
      assert.equal((await owner.request.post(origin + "/__fixtures/control", { data: { kind: "mail", failure: true } })).status(), 204);
      try { assert.equal((await owner.request.post(origin + "/__fixtures/deliver", { data: { id: target.id } })).status(), 200); }
      finally { await owner.request.post(origin + "/__fixtures/control", { data: { kind: "mail", failure: false } }); }
      if (await page.locator("details.dial-more").first().getAttribute("open") === null) await page.locator("details.dial-more > summary").first().click();
      await page.getByRole("button", { name: "Refresh deliveries", exact: true }).click();
      await row(target.id).getByText("Failed", { exact: true }).waitFor();
      assert.ok(await row(target.id).getByText("Last failure: provider unavailable", { exact: true }).isVisible(), "OPER-004 names the recorded failure");
      assert.ok(await row(target.id).getByText("Attempts: 1", { exact: true }).isVisible());
      await audit("failed");
      const retried = page.waitForResponse(response => response.url().endsWith(`/deliveries/${target.id}/retry`) && response.request().method() === "POST");
      await row(target.id).getByRole("button", { name: "Retry delivery", exact: true }).click();
      const retryResponse = await retried; assert.equal(retryResponse.status(), 202);
      const retry = await retryResponse.json();
      await row(retry.id).getByText("Queued", { exact: true }).waitFor();
      await row(target.id).getByText("Retry: queued", { exact: true }).waitFor();
      assert.equal(await row(target.id).getByRole("button", { name: "Retry delivery", exact: true }).count(), 0);
      assert.equal((await owner.request.post(origin + "/__fixtures/deliver", { data: { id: retry.id } })).status(), 200);
      if (await page.locator("details.dial-more").first().getAttribute("open") === null) await page.locator("details.dial-more > summary").first().click();
      await page.getByRole("button", { name: "Refresh deliveries", exact: true }).click();
      await row(retry.id).getByText("Sent", { exact: true }).waitFor();
      await row(target.id).getByText("Retry: sent", { exact: true }).waitFor();
      assert.ok(await row(target.id).getByText("Last failure: provider unavailable", { exact: true }).isVisible(), "OPER-004 retains the original failure after recovery");
      const reminder = (await deliveries()).find(delivery => delivery.kind === "reminder");
      assert.ok(await row(reminder.id).getByText("Queued", { exact: true }).isVisible(), "OPER-004 keeps the state of each email separate");
      await audit("sent");
      await page.reload(); await row(retry.id).getByText("Sent", { exact: true }).waitFor();
    } finally { await context.close(); }
  }
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
