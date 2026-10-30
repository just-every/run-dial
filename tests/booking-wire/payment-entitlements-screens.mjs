import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { completeEmptyWorkspace } from "../booking-axe/first-run-fixture.mjs";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { screenRecorder } from "../../scripts/screens-support.mjs";

/** Appointment credit sanity journey through Settings, purchase, details, confirmation and manage. */
const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752";
const folder = evidencePath("payment-entitlements");
await mkdir(folder, { recursive: true });
const headers = { Origin: origin };
const config = await readFile(new URL("../booking-axe/worker.wrangler.toml", import.meta.url), "utf8");
const webhookSecret = /^STRIPE_WEBHOOK_SECRET\s*=\s*"([^"]+)"/m.exec(config)?.[1];
assert.ok(webhookSecret, "the synthetic provider signing key is configured by the review rig");
const browser = await chromium.launch({ headless: true, ...(process.platform === "linux" && existsSync("/usr/bin/chromium") ? { executablePath: "/usr/bin/chromium" } : {}), args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const payer = await browser.newContext({ viewport: { width: 1440, height: 1024 }, timezoneId: "UTC" });
const json = async (response, expected = 200) => { const body = await response.text(); assert.equal(response.status(), expected, body); return JSON.parse(body); };
const post = async (path, data, expected = 200) => json(await owner.request.post(origin + path, { headers, data }), expected);
const get = async path => json(await owner.request.get(origin + path));
const email = ["synthetic-dial-404-screens", "example.test"].join("@");
const pay = async purchase => {
  const paid = await post("/__fixtures/payments/pay", { sessionId: new URL(purchase.checkoutUrl).pathname.split("/").at(-1) });
  const body = JSON.stringify({ id: `synthetic-dial-${randomUUID()}`, object: "event", type: "checkout.session.completed", account: "acct_wirehost", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: paid } });
  const timestamp = Math.floor(Date.now() / 1000);
  await json(await owner.request.post(origin + "/api/webhooks/stripe", { headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex")}` }, data: body }));
};
try {
  assert.equal((await owner.request.post(origin + "/auth/bootstrap", { headers, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Morgan Bell", returnTo: "/setup" }, maxRedirects: 0 })).status(), 303);
  await completeEmptyWorkspace(owner, origin);
  await post("/__fixtures/setup", {});
  const start = await owner.request.get(origin + "/api/app/payments/stripe/oauth/start", { maxRedirects: 0 });
  assert.equal((await owner.request.get(`${origin}/api/payments/stripe/oauth/callback?code=wire-stripe-consent&state=${encodeURIComponent(new URL(start.headers().location).searchParams.get("state"))}`, { maxRedirects: 0 })).status(), 302);
  const event = await post("/api/app/event-types", { slug: "appointment-credit-screens", title: "Coaching with appointment credit", description: "A focused session with flexible appointment credit.", durationMinutes: 30, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 201);
  await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/price`, { headers, data: { amountCents: 5000, durationPrices: [] } }));
  await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/payment-terms`, { headers, data: { deposit: { kind: "none" }, balanceDueHours: 24, freeWindowHours: 48, lateCancelFeeCents: 0, noShowFeeCents: 0 } }));
  await post(`/api/app/event-types/${event.id}/publish`, {});
  const hostPage = await owner.newPage();
  await hostPage.goto(origin + "/app/settings");
  await hostPage.locator('[data-operator-ready="true"]').waitFor();
  const card = hostPage.locator("#appointment-credits"), form = card.getByRole("form", { name: "Appointment purchase option" });
  await form.getByRole("combobox", { name: "Event type", exact: true }).selectOption(event.id);
  const create = async (kind, name, amount, sessions) => {
    await form.getByRole("combobox", { name: "Credit type", exact: true }).selectOption(kind);
    await form.getByLabel("Name", { exact: true }).fill(name);
    if (kind !== "gift") await form.getByLabel(kind === "coupon" ? "Number of uses" : kind === "membership" ? "Sessions each month" : "Sessions", { exact: true }).fill(String(sessions));
    await form.getByLabel(kind === "coupon" ? "Discount per use (USD)" : kind === "gift" ? "Gift value and price (USD)" : kind === "membership" ? "Monthly price (USD)" : "Price (USD)", { exact: true }).fill(amount);
    const response = hostPage.waitForResponse(response => new URL(response.url()).pathname.endsWith("/products") && response.request().method() === "POST");
    await form.getByRole("button", { name: kind === "coupon" ? "Issue coupon" : "Create purchase option", exact: true }).click();
    const created = await json(await response, 201);
    await card.getByText(name, { exact: false }).first().waitFor();
    return created;
  };
  await create("package", "Three coaching sessions", "120.00", 3);
  await create("membership", "Monthly coaching", "150.00", 4);
  await create("gift", "Coaching gift", "50.00", 1);
  const coupon = await create("coupon", "Coaching welcome coupon", "12.34", 2);
  assert.equal(await card.locator("code").first().textContent(), coupon.code, "issued coupon code is available to the host");
  const root = `/api/public/book/dial-host/${event.slug}`;
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const details = async () => {
    const slot = (await get(`${root}/availability?week=${future}`)).slots[0].startAt;
    const selection = await post(`${root}/selection`, { startAt: slot, inviteeTimezone: "UTC" }, 201);
    return `/book/dial-host/${event.slug}/details?${new URLSearchParams({ nonce: selection.nonce, startAt: slot, inviteeTimezone: "UTC" })}`;
  };
  const page = await payer.newPage();
  const confirmations = [];
  // Observe the real public response before its immediate receipt navigation discards the browser's body.
  await page.route("**/api/public/book/**/confirm", async route => {
    const response = await route.fetch();
    const body = await response.body();
    confirmations.push({ status: response.status(), value: JSON.parse(body.toString()) });
    await route.fulfill({ response, body });
  });
  const fill = async path => {
    await page.goto(origin + path);
    await page.getByLabel("Name", { exact: true }).fill("Synthetic Credit Guest");
    await page.getByLabel("Email", { exact: true }).fill(email);
  };
  const buy = async name => {
    const disclosure = page.locator(".pb-credit-purchases");
    if (!await disclosure.evaluate(element => element.open)) await disclosure.locator("summary").click();
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/purchase") && response.request().method() === "POST");
    await disclosure.getByRole("button", { name: `Buy ${name}`, exact: true }).click();
    const purchase = await json(await response, 201);
    assert.equal(await disclosure.getByRole("link", { name: "Continue on Stripe" }).getAttribute("href"), purchase.checkoutUrl);
    return purchase;
  };
  const credit = async code => {
    await page.getByRole("checkbox", { name: "Use a package, membership, gift or coupon" }).check();
    if (code) await page.getByLabel("Credit code", { exact: true }).fill(code);
    const preview = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/credit-preview") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Check balance", exact: true }).click();
    return json(await preview);
  };
  const confirm = async (label, status = 201) => {
    const completed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/confirm") && response.request().method() === "POST");
    await page.getByRole("button", { name: label, exact: true }).click();
    await completed;
    const observed = confirmations.shift();
    assert.ok(observed, "confirmation crosses the real public HTTP door");
    assert.equal(observed.status, status, JSON.stringify(observed.value));
    return observed.value;
  };
  await fill(await details());
  const purchase = await buy("Three coaching sessions");
  assert.equal((await credit(purchase.code)).kind, "refused", "unpaid purchase cannot be applied through the details screen");
  await page.getByText("This purchase is not active yet.", { exact: false }).waitFor();
  await pay(purchase);
  const available = await credit(purchase.code);
  assert.equal(available.balance, 3);
  assert.equal(available.remainderCents, 0);
  await page.getByText("3 sessions available", { exact: true }).waitFor();
  const booked = await confirm("Confirm booking with credit");
  await page.waitForURL(/\/confirmed\?/);
  await page.getByRole("heading", { name: "Booking confirmed.", exact: true }).waitFor();
  await page.goto(booked.manageUrl);
  await page.getByRole("region", { name: "Appointment credit" }).getByText("Three coaching sessions · 2 sessions remaining", { exact: true }).waitFor();
  assert.equal(await page.getByRole("list", { name: "Redemption history" }).getByRole("listitem").count(), 1);
  await fill(await details());
  assert.equal((await credit()).balance, 2, "purchase email works without a code in the public details screen");
  const second = await confirm("Confirm booking with credit");
  await page.waitForURL(/\/confirmed\?/);
  await fill(await details());
  const discounted = await credit(coupon.code);
  assert.equal(discounted.discountCents, 1234);
  assert.equal(discounted.remainderCents, 3766);
  const step = await confirm("Continue to payment · $37.66 USD", 202);
  await pay({ checkoutUrl: step.payment.checkoutUrl });
  const payment = await get(`/api/public/payments/${new URL(step.payment.returnUrl).searchParams.get("return")}`);
  assert.equal(payment.state, "confirmed");
  // Every sale control reaches its own Stripe purchase command; session-pack redemption is exercised above.
  await fill(await details());
  await pay(await buy("Monthly coaching"));
  await pay(await buy("Coaching gift"));
  const screenPath = await details();
  const storageState = await owner.storageState();
  const { capture, shots } = screenRecorder({ browser, origin, folder, storageState, timezoneId: "UTC" });
  for (const width of [1440, 390]) {
    await capture(width, "host-appointment-credits", "/app/settings", async capturePage => {
      const section = capturePage.locator("#appointment-credits");
      await section.getByRole("heading", { name: "Balances and redemption history" }).waitFor();
      await section.getByText("Three coaching sessions · 1 session remaining", { exact: true }).waitFor();
      await section.locator("select").first().selectOption(event.id);
      await section.getByText("Coaching gift · Gift certificate", { exact: true }).waitFor();
      await section.scrollIntoViewIfNeeded();
      return section;
    });
    await capture(width, "details-appointment-credit", screenPath, async capturePage => {
      await capturePage.getByLabel("Name", { exact: true }).fill("Synthetic Credit Guest");
      await capturePage.getByLabel("Email", { exact: true }).fill(email);
      await capturePage.getByRole("checkbox", { name: "Use a package, membership, gift or coupon" }).check();
      await capturePage.getByLabel("Credit code", { exact: true }).fill(coupon.code);
      await capturePage.getByRole("button", { name: "Check balance", exact: true }).click();
      await capturePage.getByText("1 use available", { exact: true }).waitFor();
      await capturePage.locator(".pb-credit-purchases summary").click();
      await capturePage.getByRole("button", { name: "Buy Monthly coaching", exact: true }).waitFor();
    }, { session: false });
    await capture(width, "manage-appointment-credit", new URL(second.manageUrl).pathname, async capturePage => {
      await capturePage.getByRole("region", { name: "Appointment credit" }).getByText("Three coaching sessions · 1 session remaining", { exact: true }).waitFor();
      await capturePage.getByRole("list", { name: "Redemption history" }).waitFor();
    }, { session: false });
    await capture(width, "manage-coupon", new URL(payment.manageUrl).pathname, async capturePage => {
      await capturePage.getByRole("region", { name: "Appointment credit" }).getByText("Coaching welcome coupon · 1 use remaining", { exact: true }).waitFor();
      await capturePage.getByText("Paid $37.66 USD", { exact: false }).waitFor();
    }, { session: false });
  }
  console.log(`PAY-004 Settings, sales, code and purchase-email preview, booking and manage screens passed; ${shots.length} screenshots at 1440 and 390.`);
} catch (error) {
  for (const [index, failedPage] of [...owner.pages(), ...payer.pages()].entries()) {
    await failedPage.screenshot({ path: `${folder}/failure-${index}.png`, fullPage: true }).catch(() => {});
    await writeFile(`${folder}/failure-${index}.txt`, await failedPage.locator("body").ariaSnapshot().catch(() => "Unavailable")).catch(() => {});
  }
  throw error;
} finally { await payer.close(); await owner.close(); await browser.close(); }
