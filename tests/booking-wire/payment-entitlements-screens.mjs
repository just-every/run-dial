import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { completeEmptyWorkspace } from "../booking-axe/first-run-fixture.mjs";
import { evidencePath } from "../../scripts/evidence-path.mjs";

/** Real owner Settings, public purchase and redemption, and private manage screens with Stripe at the HTTP edge. */
const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752", headers = { Origin: origin };
const folder = evidencePath("appointment-credit-screens");
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext({ viewport: { width: 1440, height: 1024 }, timezoneId: "UTC" });
const invitee = await browser.newContext({ viewport: { width: 1440, height: 1024 }, timezoneId: "UTC" });
const json = async (response, expected = 200) => { assert.equal(response.status(), expected, await response.text()); return response.json(); };
const person = ["synthetic-dial-540", "example.test"].join("@");
const post = async (path, data, expected = 200) => json(await owner.request.post(origin + path, { headers, data }), expected);
const pay = async checkoutUrl => {
  const sessionId = new URL(checkoutUrl).pathname.split("/").at(-1);
  const paid = await post("/__fixtures/payments/pay", { sessionId });
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: `synthetic-dial-${randomUUID()}`, object: "event", type: "checkout.session.completed", account: "acct_wirehost", livemode: false, created: timestamp, data: { object: paid } });
  const signature = createHmac("sha256", ["whsec", "wiretest"].join("_")).update(`${timestamp}.${body}`).digest("hex");
  await json(await owner.request.post(origin + "/api/webhooks/stripe", { headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` }, data: body }));
  return paid;
};
const errors = [];
const watch = page => page.on("pageerror", error => errors.push(error.message));
const screenshot = async (page, name, target) => {
  await page.evaluate(() => globalThis.document.fonts.ready);
  await (target ?? page).screenshot({ path: `${folder}/${name}-${page.viewportSize().width}.png`, ...(target ? {} : { fullPage: true }) });
};
try {
  assert.equal((await owner.request.post(origin + "/auth/bootstrap", { headers, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Synthetic Dial Host", returnTo: "/setup" }, maxRedirects: 0 })).status(), 303);
  await completeEmptyWorkspace(owner, origin);
  await post("/__fixtures/setup", {});
  const start = await owner.request.get(origin + "/api/app/payments/stripe/oauth/start", { maxRedirects: 0 });
  assert.equal((await owner.request.get(`${origin}/api/payments/stripe/oauth/callback?code=wire-stripe-consent&state=${encodeURIComponent(new URL(start.headers().location).searchParams.get("state"))}`, { maxRedirects: 0 })).status(), 302);
  const event = await post("/api/app/event-types", { slug: "credit-coaching", title: "Credit coaching", description: "Coaching with packages, membership and gifts.", durationMinutes: 30, color: "#176b5a", locationType: "fixed_link", locationLabel: "Meeting room", locationValue: "https://example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 201);
  await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/price`, { headers, data: { amountCents: 5000, durationPrices: [] } }));
  await json(await owner.request.put(`${origin}/api/app/event-types/${event.id}/payment-terms`, { headers, data: { deposit: { kind: "none" }, balanceDueHours: 24, freeWindowHours: 48, lateCancelFeeCents: 0, noShowFeeCents: 0 } }));
  await post(`/api/app/event-types/${event.id}/publish`, {});
  const hostPage = await owner.newPage(); watch(hostPage);
  await hostPage.goto(origin + "/app/settings");
  await hostPage.locator('[data-operator-ready="true"]').waitFor();
  const card = hostPage.locator("#appointment-credits");
  await card.getByText("Configure products and issue coupons", { exact: true }).click();
  await card.getByLabel("Credit event type").selectOption(event.id);
  const form = card.getByRole("form", { name: "Appointment product" });
  const products = [];
  for (const [kind, name, amount, count] of [["package", "Three coaching sessions", "120.00", "3"], ["membership", "Monthly coaching", "150.00", "4"], ["gift", "Coaching gift", "50.00", "1"]]) {
    await form.getByLabel("Product type").selectOption(kind);
    await form.getByLabel("Product name").fill(name);
    await form.getByLabel(kind === "membership" ? "Monthly price (USD)" : kind === "gift" ? "Gift value (USD)" : "Purchase price (USD)").fill(amount);
    if (kind !== "gift") await form.getByLabel(kind === "membership" ? "Sessions each month" : "Sessions", { exact: true }).fill(count);
    await form.getByLabel("Valid for (days)").fill("180");
    const saved = hostPage.waitForResponse(response => new URL(response.url()).pathname.endsWith("/products") && response.request().method() === "POST");
    await form.getByRole("button", { name: "Save appointment product" }).click();
    products.push(await json(await saved, 201));
    await card.getByRole("list", { name: "Appointment product catalog" }).getByText(name, { exact: true }).waitFor();
  }
  await form.getByLabel("Product type").selectOption("coupon");
  await form.getByLabel("Product name").fill("Coaching coupon");
  await form.getByLabel("Discount per booking (USD)").fill("15.01");
  await form.getByLabel("Coupon uses").fill("2");
  await form.getByLabel("Recipient email").fill(["synthetic-dial-549", "example.test"].join("@"));
  const issued = hostPage.waitForResponse(response => new URL(response.url()).pathname.endsWith("/coupons") && response.request().method() === "POST");
  await form.getByRole("button", { name: "Issue coupon" }).click();
  const coupon = await json(await issued, 201);
  await card.getByText(coupon.code, { exact: true }).waitFor();

  const page = await invitee.newPage(); watch(page);
  const publicPath = `/book/dial-host/${event.slug}`, root = `/api/public/book/dial-host/${event.slug}`;
  await page.goto(origin + publicPath);
  const offers = page.getByRole("group", { name: "Appointment products" });
  await page.getByText("Packages, memberships and gifts", { exact: true }).click();
  const purchases = [];
  for (const [index, product] of products.entries()) {
    await page.getByLabel("Purchase email", { exact: true }).fill(index === 0 ? person : [`synthetic-dial-${541 + index}`, "example.test"].join("@"));
    const bought = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/purchase") && response.request().method() === "POST");
    await page.getByRole("button", { name: `Buy ${product.name}`, exact: true }).click();
    const purchase = await json(await bought, 201);
    const proceed = page.getByRole("link", { name: "Continue purchase on Stripe" });
    await proceed.waitFor();
    assert.equal(await proceed.getAttribute("href"), purchase.checkoutUrl);
    await page.getByText(purchase.code, { exact: true }).waitFor();
    const paid = await pay(purchase.checkoutUrl);
    assert.equal(paid.amount_total, product.amountCents, "the purchase controls charge the displayed product price");
    assert.equal(paid.mode, product.kind === "membership" ? "subscription" : "payment");
    purchases.push(purchase);
  }
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 1440 ? 1024 : 844 }); await screenshot(page, "public-products", offers); }
  await page.setViewportSize({ width: 1440, height: 1024 });
  const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const selection = async () => {
    const availability = await json(await invitee.request.get(`${origin}${root}/availability?week=${future}`));
    const startAt = availability.slots[0].startAt;
    const issued = await json(await invitee.request.post(origin + root + "/selection", { headers, data: { startAt, inviteeTimezone: "UTC" } }), 201);
    return { ...issued, startAt, path: publicPath + "/details?" + new URLSearchParams({ nonce: issued.nonce, startAt, inviteeTimezone: "UTC" }) };
  };
  const details = await selection();
  await page.goto(origin + details.path);
  await page.getByLabel("Name", { exact: true }).fill("Synthetic Dial Invitee");
  await page.getByLabel("Email", { exact: true }).fill(person);
  await page.getByLabel("Redemption code", { exact: true }).fill(purchases[0].code);
  await page.getByRole("button", { name: "Check and apply credit" }).click();
  await page.getByText("Remaining balance: 3 sessions", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Confirm with appointment credit" }).waitFor();
  await page.getByLabel("Find your credit").selectOption("email");
  await page.getByRole("button", { name: "Check and apply credit" }).click();
  await page.getByText("Remaining balance: 3 sessions", { exact: false }).waitFor();
  const confirmed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/confirm") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Confirm with appointment credit" }).click();
  const booked = await json(await confirmed, 201);
  await page.getByRole("heading", { name: "Booking confirmed.", exact: true }).waitFor();
  await page.getByRole("link", { name: "Manage booking", exact: true }).click();
  await page.getByRole("region", { name: "Appointment credit" }).getByText("Remaining balance: 2 sessions", { exact: false }).waitFor();
  const manageCredit = page.getByRole("region", { name: "Appointment credit" });
  await manageCredit.getByText("Redemption history (1)", { exact: true }).click();
  await manageCredit.getByText("1 session redeemed", { exact: false }).waitFor();
  await manageCredit.getByText(/^Expires /).waitFor();
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 1440 ? 1024 : 844 }); await screenshot(page, "manage-credit"); }

  await page.setViewportSize({ width: 1440, height: 1024 });
  const couponDetails = await selection();
  await page.goto(origin + couponDetails.path);
  await page.getByLabel("Name", { exact: true }).fill("Synthetic Coupon Invitee");
  await page.getByLabel("Email", { exact: true }).fill(person);
  await page.getByLabel("Redemption code", { exact: true }).fill(coupon.code);
  await page.getByRole("button", { name: "Check and apply credit" }).click();
  await page.getByText("Remaining balance: 2 uses", { exact: false }).waitFor();
  await page.getByText("Credit applied: $15.01 USD · Due now: $34.99 USD", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Continue to payment · $34.99 USD", exact: true }).waitFor();
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 1440 ? 1024 : 844 }); await screenshot(page, "public-credit-preview"); }
  await page.setViewportSize({ width: 1440, height: 1024 });
  // Observe the product response before the normal navigation to Stripe leaves the local test host.
  await page.route("https://checkout.stripe.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<p>Stripe test edge</p>" }));
  const paymentStep = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/confirm") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Continue to payment · $34.99 USD", exact: true }).click();
  const step = await json(await paymentStep, 202);
  assert.equal(step.payment.amountCents, 3499);
  const charged = await pay(step.payment.checkoutUrl);
  assert.equal(charged.amount_total, 3499, "browser coupon confirmation charges the displayed remainder");
  const status = await json(await invitee.request.get(`${origin}/api/public/payments/${new URL(step.payment.returnUrl).searchParams.get("return")}`));
  await page.goto(status.manageUrl);
  await page.getByRole("region", { name: "Appointment credit" }).getByText("Remaining balance: 1 use", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Cancel booking", exact: true }).click();
  await page.getByRole("button", { name: "Confirm cancellation", exact: true }).click();
  await page.getByRole("region", { name: "Appointment credit" }).getByText("Remaining balance: 2 uses", { exact: false }).waitFor();
  await page.getByRole("region", { name: "Appointment credit" }).getByText("Redemption history (1)", { exact: true }).click();
  await page.getByRole("region", { name: "Appointment credit" }).getByText(/^Restored /).waitFor();

  await hostPage.reload();
  await hostPage.locator('[data-operator-ready="true"]').waitFor();
  const balances = card.getByRole("list", { name: "Appointment credit balances" });
  const packageRow = balances.getByRole("listitem").filter({ has: hostPage.getByRole("heading", { name: products[0].name, exact: true }) });
  await packageRow.getByText("Remaining balance: 2 sessions", { exact: false }).waitFor();
  await packageRow.getByText("Redemption history (1)", { exact: true }).click();
  await packageRow.getByText("1 session redeemed", { exact: false }).waitFor();
  const couponRow = balances.getByRole("listitem").filter({ has: hostPage.getByRole("heading", { name: "Coaching coupon", exact: true }) });
  await couponRow.getByText("Remaining balance: 2 uses", { exact: false }).waitFor();
  await couponRow.getByText("Redemption history (1)", { exact: true }).click();
  await couponRow.getByText("Booking discount: $15.01 USD", { exact: true }).waitFor();
  await couponRow.getByText(/^Restored /).waitFor();
  for (const width of [1440, 390]) { await hostPage.setViewportSize({ width, height: width === 1440 ? 1024 : 844 }); await screenshot(hostPage, "host-credit-balances", card); }
  await hostPage.setViewportSize({ width: 1440, height: 1024 });
  await page.setViewportSize({ width: 1440, height: 1024 });
  for (const current of [hostPage, page]) {
    assert.deepEqual((await new AxeBuilder({ page: current }).analyze()).violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => item.id), [], "changed credit screens have no serious accessibility findings");
    assert.ok(await current.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "changed credit screens have no horizontal overflow");
  }
  assert.equal((await json(await invitee.request.get(origin + new URL(booked.manageUrl).pathname.replace("/manage/", "/api/public/manage/")))).entitlement.balance, 2);
  assert.deepEqual(errors, [], "credit screens have no browser errors");
  console.log("PAY-004 host product creation, package and membership and gift purchase, code and email preview, coupon remainder, restored credit and manage history passed; eight screenshots at 1440 and 390.");
} finally { await invitee.close(); await owner.close(); await browser.close(); }
