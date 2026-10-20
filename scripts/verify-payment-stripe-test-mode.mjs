// PAY-001 real-provider proof, local only and in Stripe TEST mode. Run through the fleet key door:
//   python3 $HOME/rer-consolidation/briefs/_od08-env.py STRIPE_SECRET_KEY=STRIPE_RER_TEST_SECRET_KEY -- node scripts/verify-payment-stripe-test-mode.mjs
// Dial runs through its own door (the booking-wire Worker with STRIPE_EDGE=live) against api.stripe.com: Dial's
// code creates and expires the Checkout Sessions; a headless browser pays on Stripe's hosted page with test card
// 4242; the real checkout.session.completed is fetched with GET /v1/events and delivered to Dial's webhook signed
// with a throwaway endpoint's secret. Stripe cannot reach a local Worker, so Stripe-to-Dial delivery is not proven.
// No key, session secret or webhook secret is written anywhere; the evidence JSON holds IDs and outcomes only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const key = process.env.STRIPE_SECRET_KEY;
assert.ok(key?.startsWith("sk_test_"), "a Stripe TEST secret key is required; live keys are refused");
const out = resolve(process.argv[2] ?? "evidence/contract/2026-10-21/PAY-001/stripe-test-mode.json");
const port = 15760, origin = `http://127.0.0.1:${port}`, config = "tests/booking-wire/worker.wrangler.toml";
const record = { mode: "test", startedAt: new Date().toISOString(), steps: [], cleanup: {}, notProven: ["Stripe-to-Dial webhook delivery: the local Worker is not reachable from Stripe, so the real event was fetched with GET /v1/events and delivered by this harness", "A real Connect OAuth grant: the fleet holds no Connect client ID; the connected account was recorded through a test-only fixture"] };
const step = (name, detail) => { record.steps.push({ name, ...detail }); console.log(`- ${name}`); };
const stripe = async (path, { method = "GET", form, account } = {}) => {
  const response = await fetch(`https://api.stripe.com${path}`, { method, headers: { authorization: `Bearer ${key}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...(account ? { "stripe-account": account } : {}) }, ...(form ? { body: new URLSearchParams(form).toString() } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(`Stripe ${method} ${path} ${response.status} ${body.error?.code ?? body.error?.type}`);
  return body;
};
const platform = await stripe("/v1/account");
let account = platform.id, connected;
try {
  connected = await stripe("/v1/accounts", { method: "POST", form: { type: "standard", country: "US", email: "dial-pay-001-proof@example.com" } });
  account = connected.id;
  step("connected Standard test account created through the API", { account: connected.id, chargesEnabled: connected.charges_enabled });
} catch (error) { step("Connect Standard test account unavailable; the platform account is used", { reason: String(error.message) }); }
const endpoint = await stripe("/v1/webhook_endpoints", { method: "POST", form: { url: "https://example.com/dial-pay-001-placeholder", "enabled_events[0]": "checkout.session.completed", "enabled_events[1]": "checkout.session.expired", ...(connected ? { connect: "true" } : {}) } });
const webhookSecret = endpoint.secret;
step("throwaway webhook endpoint created for its signing secret", { endpoint: endpoint.id });
// The sandbox's Worker runtime has no direct egress: a byte-for-byte local relay forwards Dial's Stripe requests.
const relay = createServer(async (request, response) => {
  const [, host, ...rest] = request.url.split("/");
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !["host", "connection", "content-length"].includes(name)));
  const upstream = await fetch(`https://${host}/${rest.join("/")}`, { method: request.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
  response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" }); response.end(Buffer.from(await upstream.arrayBuffer()));
});
await new Promise(done => relay.listen(port + 2, "127.0.0.1", done));
record.transport = "Dial's Worker request bytes relayed unchanged by a local forwarder because the sandbox Worker runtime has no direct egress";
const state = await mkdtemp(resolve(tmpdir(), "dial-stripe-proof-"));
const env = { ...process.env, CI: "1" };
const run = args => new Promise((done, reject) => { const child = spawn(args[0], args.slice(1), { env, stdio: "ignore" }); child.on("exit", code => code === 0 ? done() : reject(new Error(`${args[0]} exited ${code}`))); });
let server, browser, sessions = [], paymentIntent;
try {
  await run(["pnpm", "exec", "wrangler", "d1", "migrations", "apply", "dial-booking-wire-test", "--local", "--persist-to", state, "--config", config]);
  server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", state, "--config", config, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(port + 1),
    "--var", `APP_URL:${origin}`, "--var", "STRIPE_EDGE:live", "--var", `STRIPE_EDGE_RELAY:http://127.0.0.1:${port + 2}`, "--var", `STRIPE_SECRET_KEY:${key}`, "--var", `STRIPE_WEBHOOK_SECRET:${webhookSecret}`], { env, stdio: "ignore", detached: true });
  for (let attempt = 0; ; attempt++) { assert.ok(attempt < 960 && server.exitCode === null, "Dial started"); try { if ((await fetch(origin + "/health")).ok) break; } catch { /* starting */ } await new Promise(done => setTimeout(done, 125)); }
  let cookie;
  const call = async (path, body, expected, method = body === undefined ? "GET" : "POST", headers = {}) => {
    const response = await fetch(origin + path, { method, redirect: "manual", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
    assert.equal(response.status, expected, `${method} ${path.replace(/return=[^&]+|\/manage\/[^/?]+/g, "[capability]")}`);
    return response.status === 204 || response.status === 302 || response.status === 303 ? response : response.json();
  };
  cookie = (await call("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Proof owner", returnTo: "/app" }, 303)).headers.get("set-cookie").split(";")[0];
  await call("/wire/init", {}, 200); await call("/__fixtures/setup", {}, 200);
  await call("/__fixtures/payments/connect", { accountId: account }, 204);
  const event = await call("/api/app/event-types", { slug: "paid-proof", title: "Paid proof session", description: "PAY-001 test-mode proof.", durationMinutes: 30, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 201);
  await call(`/api/app/event-types/${event.id}/price`, { amountCents: 2500, durationPrices: [] }, 200, "PUT");
  await call(`/api/app/event-types/${event.id}/publish`, {}, 200);
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const slots = (await call(`/api/public/book/dial-host/paid-proof/availability?week=${future}`, undefined, 200)).slots.map(slot => slot.startAt);
  const hold = async (startAt, email) => {
    const selection = await call("/api/public/book/dial-host/paid-proof/selection", { startAt, inviteeTimezone: "UTC" }, 201);
    return (await call("/api/public/book/dial-host/paid-proof/confirm", { nonce: selection.nonce, startAt, inviteeTimezone: "UTC", name: "Proof Payer", email, answers: {} }, 202)).payment;
  };
  const paid = await hold(slots[0], "pay-001-proof@example.com");
  const sessionId = new URL(paid.checkoutUrl).pathname.split("/").at(-1).split("#")[0];
  sessions.push(sessionId);
  const created = await stripe(`/v1/checkout/sessions/${sessionId}`, { account: connected ? account : undefined });
  assert.deepEqual([created.status, created.amount_total, created.currency, created.metadata.dial_hold_id !== undefined], ["open", 2500, "usd", true]);
  step("Dial created a real Checkout Session through its own confirm route", { session: sessionId, amountTotal: created.amount_total, currency: created.currency, paymentMethodTypes: created.payment_method_types, excludedPaymentMethodTypes: created.excluded_payment_method_types, expiresAt: created.expires_at });
  assert.equal((await call("/wire/state", undefined, 200)).bookings.filter(row => row.event_slug === "paid-proof").length, 0);
  browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  const page = await (await browser.newContext()).newPage();
  await page.goto(paid.checkoutUrl, { waitUntil: "domcontentloaded" });
  const card = page.locator('[data-testid="card-accordion-item-button"]');
  if (await card.isVisible({ timeout: 15000 }).catch(() => false)) await card.click();
  await page.locator("#cardNumber").fill("4242 4242 4242 4242", { timeout: 60000 });
  await page.locator("#cardExpiry").fill("12 / 34"); await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Proof Payer");
  const country = page.locator("#billingCountry"); if (await country.isVisible().catch(() => false)) await country.selectOption("US");
  const zip = page.locator("#billingPostalCode"); if (await zip.isVisible().catch(() => false)) await zip.fill("94107");
  const linkOptOut = page.locator("#enableStripePass"); if (await linkOptOut.isChecked().catch(() => false)) await linkOptOut.uncheck();
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
  await page.waitForURL(url => url.origin === origin, { timeout: 90000 });
  step("test card 4242 paid on Stripe's hosted Checkout page; Stripe returned to Dial's return URL", { returnedTo: new URL(page.url()).pathname });
  assert.equal((await call("/wire/state", undefined, 200)).bookings.filter(row => row.event_slug === "paid-proof").length, 0, "the return URL alone confirmed nothing");
  step("the return URL alone created no booking", {});
  let completed;
  for (let attempt = 0; attempt < 30 && !completed; attempt++) {
    const events = await stripe("/v1/events?type=checkout.session.completed&limit=20", { account: connected ? account : undefined });
    completed = events.data.find(item => item.data.object.id === sessionId);
    if (!completed) await new Promise(done => setTimeout(done, 2000));
  }
  assert.ok(completed, "Stripe recorded checkout.session.completed");
  paymentIntent = completed.data.object.payment_intent;
  // A Connect webhook delivery carries the connected account in `account`. Without Connect the session lives on the
  // platform account (addressed by Stripe-Account), whose own events carry no `account`; the harness adds that one
  // field so Dial's account check sees a Connect-shaped delivery. Everything else is Stripe's object unchanged.
  const payload = JSON.stringify(completed.account ? completed : { ...completed, account });
  record.envelopeAccountAddedByHarness = !completed.account;
  const sign = body => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac("sha256", webhookSecret).update(`${t}.${body}`).digest("hex")}`; };
  await call("/api/webhooks/stripe", payload, 401, "POST", { "stripe-signature": sign(payload).replace(/v1=./, "v1=0") });
  await call("/api/webhooks/stripe", payload, 200, "POST", { "stripe-signature": sign(payload) });
  await call("/api/webhooks/stripe", payload, 200, "POST", { "stripe-signature": sign(payload) });
  let snap = await call("/wire/state", undefined, 200);
  const booking = snap.bookings.filter(row => row.event_slug === "paid-proof");
  assert.equal(booking.length, 1); assert.equal(booking[0].state, "confirmed");
  assert.deepEqual(snap.booking_payments.map(row => [row.amount_cents, row.checkout_session_id, row.payment_intent_id]), [[2500, sessionId, paymentIntent]]);
  step("the real signed checkout.session.completed confirmed exactly one booking (a mis-signed copy was 401, a duplicate added nothing)", { event: completed.id, eventHasAccount: Boolean(completed.account), paymentIntent, amountCents: 2500 });
  const lapsed = await hold(slots[1], "pay-001-lapsed@example.com");
  const lapsedId = new URL(lapsed.checkoutUrl).pathname.split("/").at(-1).split("#")[0];
  sessions.push(lapsedId);
  snap = await call("/wire/state", undefined, 200);
  const held = snap.payment_holds.find(row => row.checkout_session_id === lapsedId);
  await call("/__fixtures/payments/window-ended", { holdId: held.id }, 204);
  snap = await call("/wire/state", undefined, 200);
  const expired = await stripe(`/v1/checkout/sessions/${lapsedId}`, { account: connected ? account : undefined });
  assert.equal(expired.status, "expired"); assert.equal(snap.payment_holds.find(row => row.id === held.id).state, "released");
  assert.ok((await call(`/api/public/book/dial-host/paid-proof/availability?week=${future}`, undefined, 200)).slots.some(slot => slot.startAt === slots[1]));
  step("Dial's sweep expired the second real session through POST /v1/checkout/sessions/:id/expire and released the slot", { session: lapsedId, stripeStatus: expired.status, holdState: "released" });
} finally {
  await browser?.close(); relay.close();
  if (server?.exitCode === null) { try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); } }
  await rm(state, { recursive: true, force: true });
  const scope = connected ? account : undefined;
  if (paymentIntent) { const refund = await stripe("/v1/refunds", { method: "POST", form: { payment_intent: paymentIntent }, account: scope }); record.cleanup.refund = { id: refund.id, status: refund.status, amount: refund.amount }; }
  for (const id of sessions) { const session = await stripe(`/v1/checkout/sessions/${id}`, { account: scope }); if (session.status === "open") await stripe(`/v1/checkout/sessions/${id}/expire`, { method: "POST", account: scope }); }
  record.cleanup.sessions = await Promise.all(sessions.map(async id => ({ id, status: (await stripe(`/v1/checkout/sessions/${id}`, { account: scope })).status })));
  record.cleanup.openSessionsCreatedByRun = record.cleanup.sessions.filter(session => session.status === "open").length;
  if (paymentIntent) record.cleanup.refundsReadback = (await stripe(`/v1/refunds?payment_intent=${paymentIntent}`, { account: scope })).data.map(refund => ({ id: refund.id, status: refund.status, amount: refund.amount }));
  await stripe(`/v1/webhook_endpoints/${endpoint.id}`, { method: "DELETE" });
  record.cleanup.webhookEndpointsOfThisRun = (await stripe("/v1/webhook_endpoints?limit=100")).data.filter(item => item.id === endpoint.id || item.url === endpoint.url).length;
  record.cleanup.customersCreated = 0;
  if (connected) { await stripe(`/v1/accounts/${connected.id}`, { method: "DELETE" }).then(() => { record.cleanup.connectedAccountDeleted = connected.id; }).catch(error => { record.cleanup.connectedAccountDeleted = `not deleted: ${error.message}`; }); }
  record.finishedAt = new Date().toISOString();
  await writeFile(out, JSON.stringify(record, null, 2) + "\n");
}
console.log("PAY-001 Stripe test-mode proof passed.");
