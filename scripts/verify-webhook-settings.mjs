import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidencePath } from "./evidence-path.mjs";
import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";
import { webhookReceiver } from "../tests/booking-wire/webhook-receiver.mjs";

const origin = process.env.DIAL_REVIEW_ORIGIN, receiver = await webhookReceiver();
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext(), headers = { Origin: origin };
const data = async (path, body, expected = 200) => {
  const response = body === undefined ? await owner.request.get(origin + path) : await owner.request.post(origin + path, { headers, data: body });
  assert.equal(response.status(), expected, path); return response.json();
};
try {
  const boot = await owner.request.post(origin + "/auth/bootstrap", { headers, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Morgan Bell", returnTo: "/setup" }, maxRedirects: 0 }); assert.equal(boot.status(), 303);
  await completeEmptyWorkspace(owner, origin); await data("/__fixtures/setup", {});
  const event = await data("/api/app/event-types", { slug: "synthetic-dial-1450", title: "Planning consultation", description: "A focused planning session.", durationMinutes: 30, color: "#176b5a", locationType: "fixed_link", locationLabel: "Meeting room", locationValue: "https://meet.example.test/planning", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 201);
  await data(`/api/app/event-types/${event.id}/publish`, {});
  await data("/api/app/teams", { name: "Planning", eventTypeIds: [event.id] }, 201);
  for (const width of [1440, 390]) {
    const page = await owner.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    try {
      await page.goto(origin + "/app/settings");
      const section = page.locator("#webhook-settings");
      const capture = async name => {
        await section.scrollIntoViewIfNeeded(); await page.evaluate(() => globalThis.document.fonts.ready);
        assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth + 1), `${name} no horizontal overflow`);
        const tiny = await section.locator("button,label,p,summary,h2,h3,code").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width && Number.parseFloat(globalThis.getComputedStyle(element).fontSize) < 13).map(element => element.tagName));
        assert.deepEqual(tiny, [], `${name} text stays readable`);
        const unlabeled = await section.locator("button,a").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width && !element.textContent.trim()).length);
        assert.equal(unlabeled, 0, `${name} every action has a text label`);
        const axe = await new AxeBuilder({ page }).include("#webhook-settings").analyze(); assert.deepEqual(axe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => row.id), []);
        await section.screenshot({ path: evidencePath(`webhook-${name}-${width}.png`), mask: [section.getByRole("region", { name: "New webhook signing secret" }).locator("code")] });
      };
      const form = section.getByRole("form", { name: "Create webhook" }); await form.waitFor(); await capture("new");
      await form.getByLabel("HTTPS endpoint", { exact: true }).fill(`https://receiver.synthetic.test/screen-${width}`);
      await form.getByLabel("Send events from").selectOption("team"); await form.getByLabel("Team", { exact: true }).selectOption({ label: "Planning" });
      await form.getByLabel("Booking created", { exact: true }).check(); await form.getByLabel(/I authorize Dial/).check();
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/webhooks" && response.request().method() === "POST");
      await form.getByRole("button", { name: "Create webhook and send events" }).click(); assert.equal((await saved).status(), 201);
      const secret = section.getByRole("region", { name: "New webhook signing secret" }); await secret.waitFor(); assert.ok((await secret.locator("code").textContent()).length >= 43); await capture("secret");
      await secret.getByRole("button", { name: /I stored the secret/ }).click(); await expect(secret).toHaveCount(0);
      const future = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10), base = `/api/public/book/dial-host/${event.slug}`;
      const slot = (await data(base + "/availability?week=" + future)).slots[0], selected = await data(base + "/selection", { startAt: slot.startAt, inviteeTimezone: "UTC" }, 201);
      await data(base + "/confirm", { nonce: selected.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", name: "Planning guest", email: [`synthetic-dial-${width}`, "example.test"].join("@"), answers: {} }, 201);
      await data("/__fixtures/webhooks/process", {});
      await section.getByRole("button", { name: "Load deliveries", exact: true }).click();
      const delivery = section.getByRole("list", { name: "Webhook deliveries" }).getByRole("listitem").filter({ hasText: `screen-${width}` });
      await expect(delivery).toContainText("delivered"); await expect(delivery).toContainText("HTTP 204"); await capture("delivered");
      await delivery.getByRole("button", { name: "Redeliver event" }).click(); await expect(section.getByRole("status")).toContainText("Delivery queued");
      await data("/__fixtures/webhooks/process", {}); await section.getByRole("button", { name: "Refresh deliveries" }).click(); await expect(delivery).toContainText("delivered");
      const subscription = section.getByRole("list", { name: "Webhook subscriptions" }).getByRole("listitem").filter({ hasText: `screen-${width}` });
      page.once("dialog", dialog => dialog.accept()); await subscription.getByRole("button", { name: "Delete webhook" }).click(); await expect(subscription).toHaveCount(0); await capture("deleted");
      await page.reload(); await expect(page.locator("#webhook-settings").getByRole("region", { name: "New webhook signing secret" })).toHaveCount(0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  console.log("Webhook Settings: creation, one-time secret, scoped subscription, delivered response, manual replay and deletion at 1440 and 390 passed.");
} finally { await owner.close(); await browser.close(); await receiver.close(); }
