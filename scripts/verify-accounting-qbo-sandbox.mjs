// Local PAY-006 proof. Invoke once through the fleet injector under heavy-slot.
// The harness exchanges the held grant once and stores a rotated value before
// any other provider request. The Worker receives only a sealed access token
// and a synthetic refresh placeholder through its test-only seed fixture.
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { access, chmod, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "@playwright/test";

const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const args = process.argv.slice(2);
ensure(args[0] === "--port" && /^\d+$/.test(args[1]) && args[2], "usage: --port PORT OUTPUT.json");
const port = Number(args[1]), out = resolve(args[2]), root = process.cwd();
ensure(port > 1024 && port < 65533 && ![4795, 4796, 4797, 4798, 4799, 4800, 4801, 4802, 4803, 4804, 4805, 4806, 4807, 4808, 4809, 4810, 4811, 4812, 4813, 4814, 4815, 4816, 4817, 4818, 4819, 4820, 4821, 4822, 4871, 4872, 15750, 15752, 15760].some(p => p >= port && p <= port + 2), "choose an unreserved three-port block");
const fleet = process.env.RER_FLEET_ROOT;
ensure(fleet, "RER_FLEET_ROOT must name the local fleet checkout");
const injector = resolve(fleet, "briefs/_od08-env.py"), ingest = resolve(fleet, ".tools/ingest-owner-env.py");
const key = process.env.STRIPE_SECRET_KEY, realm = process.env.QBO_REALM_ID;
ensure(key?.startsWith("sk_test_"), "Stripe test key required");
for (const name of ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REFRESH_TOKEN", "QBO_REALM_ID"]) ensure(process.env[name], `missing ${name}`);
const origin = `http://127.0.0.1:${port}`;
const suffix = value => value ? String(value).slice(-4) : null;
const record = {
  startedAt: new Date().toISOString(), sourceHead: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  identity: "QuickBooks Online sandbox company, Intuit development keys; Stripe test mode", realmLast4: suffix(realm),
  grantEntry: "held fleet grant exchanged once by the harness and seeded by fixture; Dial's refresh path and the OAuth consent door were not exercised",
  grantEntryExecuted: false,
  rotationRule: "When you get a new refresh token, the previous refresh token value automatically expires.",
  steps: [], calls: { dial: {}, direct: {} }, relayRefusals: 0, cleanup: {}, pids: [],
  notProven: ["Intuit consent with a real login", "Dial's refresh path against Intuit", "Xero", "Pantry", "tax-bearing receipts", "deployed webhook delivery", "production and deployed proofs"],
};
const count = (kind, host, method) => { const name = `${host} ${method}`; record.calls[kind][name] = (record.calls[kind][name] ?? 0) + 1; };
const counts = () => JSON.parse(JSON.stringify(record.calls));
const step = (name, detail = {}) => { record.steps.push({ at: new Date().toISOString(), name, ...detail, providerRequests: counts() }); console.log(name); };
const block = reason => { record.result = `BLOCKED ${reason}`; throw new Error(record.result); };
let accessToken, exchangedAt, expiresAt, scratch, rotationDirectory, preserveRotation = false;
let server, browser, browserServer, relay, cookie, account, webhook, webhookSecret, sessionId, paymentIntent, charge, receipt, item, documentRef;
let phase = "exchange";
let itemCreated = false, receiptCreated = false;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
for (const name of Object.keys(env)) if (name.startsWith("QBO_") || name.startsWith("STRIPE_") || name.startsWith("RER_DEV_")) delete env[name];
const run = (command, commandArgs, options = {}) => new Promise((done, reject) => {
  const child = spawn(command, commandArgs, { env, stdio: "ignore", ...options });
  record.pids.push({ kind: command, pid: child.pid });
  child.once("error", () => reject(new Error(`${command} failed to start`)));
  child.once("exit", code => code === 0 ? done() : reject(new Error(`${command} exited ${code}`)));
});
async function exchange() {
  count("direct", "oauth.platform.intuit.com", "POST");
  const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: process.env.QBO_REFRESH_TOKEN }).toString(), redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  const receivedAt = Date.now();
  const tokens = await response.json().catch(() => ({}));
  record.exchange = { at: new Date(receivedAt).toISOString(), http: response.status };
  if (!response.ok) { record.exchange.error = typeof tokens.error === "string" && /^[a-z_]+$/.test(tokens.error) ? tokens.error : "unspecified"; block("missing-grant"); }
  // Complete store-back before validation, runtime startup, or any further request.
  if (tokens.refresh_token && tokens.refresh_token !== process.env.QBO_REFRESH_TOKEN) {
    scratch = await mkdtemp(resolve(tmpdir(), "synthetic-dial-hk2-")); await chmod(scratch, 0o700);
    rotationDirectory = await mkdtemp(resolve(scratch, "rotation-")); await chmod(rotationDirectory, 0o700);
    const path = resolve(rotationDirectory, "grant.env");
    const file = await open(path, "wx", 0o600);
    await file.writeFile(`QBO_REFRESH_TOKEN=${tokens.refresh_token}\n`); await file.close();
    const stored = spawnSync("python3", ["-I", ingest, path], { encoding: "utf8" });
    const gone = await access(path).then(() => false, () => true);
    record.rotation = { rotated: "yes", ingestExit: stored.status, ingestNamedToken: /stored: QBO_REFRESH_TOKEN(?:\s|$)/.test(stored.stdout ?? ""), fileGone: gone };
    if (stored.status !== 0 || !record.rotation.ingestNamedToken || !gone) { preserveRotation = true; record.rotation.recoveryFile = path; block("grant-rotation ingest-failed"); }
    await rm(rotationDirectory, { recursive: true }); rotationDirectory = undefined;
  } else record.rotation = { rotated: "no" };
  ensure(typeof tokens.refresh_token === "string", "exchange omitted refresh token");
  const verified = spawnSync("python3", [injector, "T=QBO_REFRESH_TOKEN", "--", "node", "-e", "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.exit(process.env.T===s?0:1));"], { input: tokens.refresh_token, stdio: ["pipe", "ignore", "ignore"] });
  record.rotation.storeBackVerificationExit = verified.status;
  ensure(verified.status === 0, "store-back verification failed; no further provider requests");
  ensure(typeof tokens.access_token === "string" && Number.isFinite(tokens.expires_in), "invalid exchange response");
  accessToken = tokens.access_token; exchangedAt = receivedAt; expiresAt = new Date(exchangedAt + tokens.expires_in * 1000).toISOString();
  record.exchange.expiresInSeconds = tokens.expires_in;
  record.exchange.refreshLifeWholeDays = Math.floor(tokens.x_refresh_token_expires_in / 86400);
  delete process.env.QBO_REFRESH_TOKEN;
  step("held grant exchanged once and store-back verified", { http: response.status, ...record.rotation });
}
async function direct(host, path, { method = "GET", body, form, stripeAccount = true, allowed = [] } = {}) {
  ensure(host === "api.stripe.com" || host === "sandbox-quickbooks.api.intuit.com", "direct host refused");
  count("direct", host, method);
  const response = await fetch(`https://${host}${path}`, {
    method, headers: { authorization: `Bearer ${host === "api.stripe.com" ? key : accessToken}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...(host === "api.stripe.com" && account && stripeAccount ? { "stripe-account": account } : {}) },
    ...(body ? { body: JSON.stringify(body) } : form ? { body: new URLSearchParams(form).toString() } : {}), redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  const value = await response.json();
  ensure(response.ok || allowed.includes(response.status), `direct ${host} ${method} refused HTTP ${response.status}`);
  return { http: response.status, value };
}
const stripe = async (path, options) => (await direct("api.stripe.com", path, options)).value;
const qbo = async (path, options) => direct("sandbox-quickbooks.api.intuit.com", `/v3/company/${encodeURIComponent(realm)}/${path}`, options);
const query = sql => qbo(`query?${new URLSearchParams({ query: sql })}`);
async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST") {
  ensure(!exchangedAt || Date.now() - exchangedAt < 45 * 60000, "Dial sequence exceeded 45 minutes");
  const response = await fetch(origin + path, { method, redirect: "manual", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  if ([204, 303].includes(response.status)) { ensure(response.status === expected, `Dial ${method} refused HTTP ${response.status}`); return response; }
  const value = await response.json();
  if (path.includes("/accounting")) {
    step("Dial accounting door", { route: `${method} ${path}`, http: response.status, state: value.state ?? value.error?.code ?? value.exports?.[0]?.state ?? (value.accounts ? "connected" : null), receiptCardinality: value.exports?.length ?? (receiptCreated ? 1 : 0), ...(value.exports?.[0]?.receiptId ? { receiptLast4: suffix(value.exports[0].receiptId) } : {}) });
    const code = value.error?.code ?? value.code;
    if (code === "accounting_token_refused") { record.classification = "not a sandbox grant for this app"; block("missing-grant"); }
    if (code === "accounting_custom_transaction_numbers_required") block("sandbox-preference CustomTxnNumbers");
    if (code === "accounting_usd_company_required") block("sandbox-preference HomeCurrency");
  }
  ensure(response.status === expected, `Dial ${method} ${path.split("?")[0]} refused HTTP ${response.status}`);
  return value;
}
async function startRuntime() {
  const config = "tests/booking-wire/worker.wrangler.toml";
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "dial-booking-wire-test", "--local", "--persist-to", scratch, "--config", config]);
  server = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--persist-to", scratch, "--config", config, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(port + 1), "--var", `APP_URL:${origin}`, "--var", "STRIPE_EDGE:live", "--var", `STRIPE_EDGE_RELAY:http://127.0.0.1:${port + 2}`, "--var", `STRIPE_SECRET_KEY:${key}`, "--var", `STRIPE_WEBHOOK_SECRET:${webhookSecret}`], { env, stdio: "ignore", detached: true });
  record.pids.push({ kind: "booking-wire runtime", pid: server.pid });
  await ready();
}
async function ready() {
  for (let attempt = 0; attempt < 240; attempt++) {
    ensure(server.exitCode === null, "runtime exited before readiness");
    try { if ((await fetch(origin + "/health", { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* bounded startup observation */ }
    await pause(250);
  }
  throw new Error("runtime did not become ready");
}
async function stopRuntime() {
  if (server?.exitCode === null) { const stopped = new Promise(done => server.once("exit", done)); process.kill(-server.pid, "SIGTERM"); await stopped; }
  server = undefined;
}
async function pay() {
  const slug = `synthetic-dial-hk2-${Date.now()}`;
  const event = await call("/api/app/event-types", { slug, title: "Sandbox accounting session", description: "Dedicated synthetic PAY-006 invitee, Stripe test-mode payment.", durationMinutes: 30, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, 201);
  await call(`/api/app/event-types/${event.id}/price`, { amountCents: 2500, durationPrices: [] }, 200, "PUT");
  await call(`/api/app/event-types/${event.id}/publish`, {});
  const path = `/api/public/book/dial-host/${slug}`, day = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const startAt = (await call(`${path}/availability?week=${day}`)).slots[0]?.startAt; ensure(startAt, "a public booking slot is available");
  const selected = await call(`${path}/selection`, { startAt, inviteeTimezone: "UTC" }, 201);
  const paid = (await call(`${path}/confirm`, { nonce: selected.nonce, startAt, inviteeTimezone: "UTC", name: "synthetic-dial-hk2-invitee", email: "synthetic-dial-hk2-invitee@example.test", answers: {} }, 202)).payment;
  sessionId = new URL(paid.checkoutUrl).pathname.split("/").at(-1);
  const session = await stripe(`/v1/checkout/sessions/${sessionId}`);
  ensure(session.livemode === false && session.amount_total === 2500 && session.currency === "usd", "Checkout is USD Stripe test mode");
  const revision = /chromium-(\d+)/.exec(chromium.executablePath())?.[1];
  ensure(Number(revision) >= 1243, "current bundled headless shell required"); record.browserRevision = revision;
  browserServer = await chromium.launchServer({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  record.pids.push({ kind: "browser", pid: browserServer.process().pid }); browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext(), page = await context.newPage();
  phase = "Stripe hosted Checkout load"; await page.goto(paid.checkoutUrl, { waitUntil: "domcontentloaded" });
  const card = page.locator('[data-testid="card-accordion-item-button"]'); if (await card.isVisible()) await card.click();
  phase = "Stripe hosted test-card entry"; await page.locator("#cardNumber").fill("4242 4242 4242 4242", { timeout: 60000 });
  await page.locator("#cardExpiry").fill("12 / 34"); await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("synthetic-dial-hk2-invitee");
  if (await page.locator("#billingCountry").isVisible()) await page.locator("#billingCountry").selectOption("US");
  if (await page.locator("#billingPostalCode").isVisible()) await page.locator("#billingPostalCode").fill("94107");
  if (await page.locator("#enableStripePass").isChecked().catch(() => false)) await page.locator("#enableStripePass").uncheck();
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
  // The API-only booking rig cannot render the return document. Observe its URL.
  await page.waitForURL(url => url.origin === origin, { timeout: 90000, waitUntil: "commit" });
  ensure((await call("/wire/state")).booking_payments.length === 0, "return alone creates no paid booking");
  let completed;
  for (let attempt = 0; attempt < 30 && !completed; attempt++) {
    completed = (await stripe("/v1/events?type=checkout.session.completed&limit=100")).data.find(event => event.data.object.id === sessionId);
    if (!completed) await pause(1000);
  }
  ensure(completed, "Stripe recorded the hosted test payment");
  paymentIntent = completed.data.object.payment_intent;
  const intent = await stripe(`/v1/payment_intents/${paymentIntent}`); charge = intent.latest_charge;
  const payload = JSON.stringify(completed.account ? completed : { ...completed, account });
  record.envelopeAccountAddedByHarness = !completed.account;
  const timestamp = Math.floor(Date.now() / 1000), signature = `t=${timestamp},v1=${createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex")}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(origin + "/api/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload });
    ensure(response.status === 200, "signed real Stripe event accepted");
  }
  const snap = await call("/wire/state");
  ensure(snap.booking_payments.length === 1 && snap.booking_payments[0].payment_intent_id === paymentIntent && snap.booking_payments[0].tax_cents === 0, "exactly one tax-free captured payment");
  record.payment = { kind: "real Stripe test-mode hosted payment through Dial's public booking door", intentLast4: suffix(paymentIntent), chargeLast4: suffix(charge), amountCents: 2500, taxCents: 0, localWebhookDelivery: true };
  step("public booking paid on Stripe's hosted test page", { http: 202, paymentIntentLast4: suffix(paymentIntent), chargeLast4: suffix(charge) });
  await context.close();
}
async function accounting() {
  await call("/__fixtures/payments/accounting-seed", { realmId: realm, accessToken, expiresAt }, 204);
  record.grantEntryExecuted = true;
  const status = await call("/api/app/payments/accounting"); ensure(status.configured && status.state === "connected", "accounting is configured and connected");
  const income = (await call("/api/app/payments/accounting/accounts")).accounts[0]; ensure(income, "sandbox Income account required");
  record.classification = "sandbox accounts accepted; preferences pending";
  const writes = () => record.qboWrites ?? [];
  await call("/api/app/payments/accounting/mapping", { accountId: income.id }, 200, "PUT");
  let snap = await call("/wire/state"); item = { Id: snap.accounting_connections[0].item_id };
  itemCreated = writes().some(value => value.kind === "item" && value.id === item.Id);
  record.mapping = { accountLast4: suffix(income.id), itemLast4: suffix(item.Id), itemCreated };
  const first = await call("/api/app/payments/accounting/export", {});
  ensure(first.exports.length === 1 && first.exports[0].state === "exported", "one exported receipt row");
  receipt = { Id: first.exports[0].receiptId }; receiptCreated = writes().some(value => value.kind === "salesreceipt" && value.id === receipt.Id);
  record.classification = "QuickBooks Online sandbox company; accounts and export preferences accepted";
  const creates = writes().filter(value => value.kind === "salesreceipt").length;
  const repeated = await call("/api/app/payments/accounting/export", {});
  ensure(repeated.exports.length === 1 && repeated.exports[0].receiptId === receipt.Id && writes().filter(value => value.kind === "salesreceipt").length === creates && creates === 1, "retry creates nothing and returns the same receipt");
  snap = await call("/wire/state"); const entry = snap.accounting_exports[0], frozen = JSON.parse(entry.payload_json); documentRef = entry.document_ref;
  const readback = await query(`select * from SalesReceipt where DocNumber = '${documentRef}'`), matches = readback.value.QueryResponse?.SalesReceipt ?? [];
  ensure(matches.length === 1, "independent direct sandbox query finds exactly one receipt"); receipt = matches[0];
  const lines = receipt.Line.filter(line => line.DetailType === "SalesItemLineDetail"), line = lines[0], expected = frozen.Line[0];
  ensure(receipt.Id === entry.receipt_id && receipt.DocNumber === frozen.DocNumber && frozen.DocNumber === entry.request_id.slice(-21) && receipt.PrivateNote === frozen.PrivateNote && frozen.PrivateNote === `Dial payment ${paymentIntent}`, "receipt references equal Dial's frozen anonymous payload");
  ensure(lines.length === 1 && line.Amount === expected.Amount && line.SalesItemLineDetail.ItemRef.value === item.Id && line.SalesItemLineDetail.Qty === 1 && line.SalesItemLineDetail.UnitPrice === 25, "one mapped sales line equals the frozen payload");
  ensure(!JSON.stringify(frozen).includes("synthetic-dial-hk2-invitee") && !JSON.stringify(frozen).includes("@") && !frozen.CustomerRef && record.anonymousPayloads, "all outbound QBO payloads exclude invitee details");
  record.receipt = { receiptLast4: suffix(receipt.Id), documentLast4: suffix(documentRef), itemLast4: suffix(item.Id), cardinality: 1, sameReceiptOnRetry: true, retryCreates: 0, anonymous: true, frozenPayloadMatches: true };
  step("independent direct sandbox read-back", { route: "GET sandbox query SalesReceipt by DocNumber", http: readback.http, state: entry.state, receiptCardinality: matches.length });
  // Raw IDs are retained only in process memory for cleanup.
  delete record.qboWrites;
}
async function screens() {
  await stopRuntime();
  const source = path => JSON.stringify(resolve(root, path));
  // Add production SSR to the unchanged booking-wire API rig for these captures.
  // This temporary entry and config contain synthetic bindings only.
  const entry = resolve(scratch, "screen-worker.ts");
  await writeFile(entry, `import wire, { BookingCoordinator } from ${source("tests/booking-wire/worker.ts")};
import { createWorker } from ${source("src/core/app/worker.ts")};
import { createServices } from ${source("src/core/app/services.ts")};
import { parseRuntimeEnvironment } from ${source("src/core/shared/runtime-env.ts")};
import { wireTransport } from ${source("tests/booking-wire/transport.ts")};
import { GoogleCalendarAdapter } from ${source("src/core/platform/calendar/google.ts")};
import { captureAuthMail, captureMail } from ${source("tests/mail-capture.ts")};
import start from ${source("src/core/app/start.server.tsx")};
const services = env => { const runtime = parseRuntimeEnvironment(env), transport = wireTransport(env.PROVIDER_DB ?? env.DB); return createServices(env.DB, runtime, {fetch: request => start.fetch(request)}, { files: env.FILES, calendar: new GoogleCalendarAdapter({clientId:"synthetic-dial-hk2",clientSecret:"synthetic-dial-hk2"},transport), authMail:captureAuthMail(env.DB), mail:captureMail(env.DB), paymentsTransport:(input,init)=>{const url=new URL(String(input));return fetch("http://127.0.0.1:${port + 2}/"+url.hostname+url.pathname+url.search,init);} }); };
const production = createWorker(services);
export { BookingCoordinator };
export default {...wire,fetch(request,env,context){return /^\\/(app|setup|_serverFn)(\\/|$)/.test(new URL(request.url).pathname)?production.fetch(request,env,context):wire.fetch(request,env,context);}};
`);
  const config = resolve(scratch, "screens.toml");
  let text = await readFile("tests/booking-wire/worker.wrangler.toml", "utf8");
  text = text.replace('main = "worker.ts"', `main = ${JSON.stringify(entry)}`).replace('migrations_dir = "../../migrations/core"', `migrations_dir = ${source("migrations/core")}`).replace(/APP_URL = "[^"]+"/, `APP_URL = "${origin}"`);
  text = text.replace("[vars]", `[assets]\ndirectory = ${source("public")}\nbinding = "ASSETS"\nrun_worker_first = true\n\n[vars]\nSTRIPE_EDGE = "live"\nSTRIPE_EDGE_RELAY = "http://127.0.0.1:${port + 2}"`);
  await writeFile(config, text);
  server = spawn("pnpm", ["exec", "vite", "--config", "tests/vite.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env: { ...env, DIAL_WRANGLER_CONFIG_PATH: config, DIAL_PERSIST_STATE_DIR: scratch, DIAL_INSPECTOR_PORT: String(port + 1) }, stdio: "ignore", detached: true });
  record.pids.push({ kind: "screen runtime", pid: server.pid }); await ready();
  const folder = resolve(fleet, "evidence/sd-dial-hk2/screens"); await mkdir(folder, { recursive: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1024 : 844 } });
    const [name, value] = cookie.split("="); await context.addCookies([{ name, value, url: origin }]);
    const page = await context.newPage(); await page.goto(origin + "/app/settings", { waitUntil: "networkidle" });
    const section = page.locator("#payment-reconciliation"); await section.waitFor();
    await section.getByRole("button", { name: "Export to QuickBooks Online", exact: true }).waitFor();
    await section.getByText("Exported", { exact: true }).waitFor();
    await page.evaluate(() => globalThis.document.fonts.ready); await section.scrollIntoViewIfNeeded();
    ensure(!(await page.locator("body").innerText()).includes(realm), "realm is absent from the screen");
    await page.screenshot({ path: resolve(folder, `payments-accounting-connected-${width}.png`), fullPage: true, mask: [page.getByText(account, { exact: true }), page.getByText(`Stripe ${paymentIntent}`, { exact: true }), page.getByText(`Stripe ${charge}`, { exact: true })] });
    record.screenPrivacy = "Full Stripe account and processor references masked in captures; the product was not edited.";
    step("connected Settings capture", { width, route: "GET /app/settings", http: 200, state: "connected", receiptCardinality: 1 }); await context.close();
  }
}
async function cleanup() {
  const attempt = async (name, task) => { try { await task(); } catch { record.cleanup[name] = "FAILED"; record.result = "FAILED cleanup"; } };
  if (receiptCreated && receipt) await attempt("receipt", async () => {
    if (!receipt.SyncToken) receipt = (await qbo(`salesreceipt/${receipt.Id}`)).value.SalesReceipt;
    const removed = await qbo("salesreceipt?operation=delete", { method: "POST", body: { Id: receipt.Id, SyncToken: receipt.SyncToken } });
    const found = (await query(`select * from SalesReceipt where DocNumber = '${documentRef ?? receipt.DocNumber}'`)).value.QueryResponse?.SalesReceipt ?? [];
    ensure(found.length === 0, "deleted receipt read-back is empty"); record.cleanup.receipt = { last4: suffix(receipt.Id), deleteHttp: removed.http, readbackCardinality: 0 };
  });
  if (itemCreated && item) await attempt("item", async () => {
    item = (await qbo(`item/${item.Id}`)).value.Item;
    const changed = await qbo("item", { method: "POST", body: { Id: item.Id, SyncToken: item.SyncToken, sparse: true, Active: false } });
    const found = (await qbo(`item/${item.Id}`)).value.Item;
    ensure(found.Active === false, "created item is inactive on read-back"); record.cleanup.item = { last4: suffix(item.Id), updateHttp: changed.http, active: false };
  });
  if (sessionId) await attempt("stripePayment", async () => {
    const session = await stripe(`/v1/checkout/sessions/${sessionId}`);
    paymentIntent ??= session.payment_intent;
    if (session.status === "open") await stripe(`/v1/checkout/sessions/${sessionId}/expire`, { method: "POST" });
    if (paymentIntent) {
      const refund = await stripe("/v1/refunds", { method: "POST", form: { payment_intent: paymentIntent } });
      const found = await stripe(`/v1/refunds/${refund.id}`); ensure(found.status === "succeeded" && found.amount === 2500, "test charge refunded on read-back");
      record.cleanup.refund = { last4: suffix(found.id), status: found.status, amountCents: found.amount };
    }
    record.cleanup.session = { last4: suffix(sessionId), state: (await stripe(`/v1/checkout/sessions/${sessionId}`)).status };
    // Checkout's inline catalogue objects are already inactive. They cannot be
    // updated or deleted through the API; verify their state without a write.
    const lines = (await stripe(`/v1/checkout/sessions/${sessionId}/line_items`)).data;
    record.cleanup.catalogue = [];
    for (const line of lines) {
      const price = await stripe(`/v1/prices/${line.price.id}`);
      ensure(price.active === false, "Checkout inline price is already inactive on read-back");
      ensure((await stripe(`/v1/products/${price.product}`)).active === false, "Checkout inline product is already inactive on read-back");
      record.cleanup.catalogue.push({ priceLast4: suffix(price.id), productLast4: suffix(price.product), active: false, reason: "Checkout inline catalogue objects are already inactive and cannot be updated or deleted through the API" });
    }
    if (session.customer) {
      await stripe(`/v1/customers/${session.customer}`, { method: "DELETE" });
      ensure((await stripe(`/v1/customers/${session.customer}`)).deleted === true, "run-created customer is deleted on read-back");
      record.cleanup.customer = { last4: suffix(session.customer), deleted: true };
    } else record.cleanup.customersCreated = 0;
  });
  if (webhook) await attempt("webhook", async () => {
    await stripe(`/v1/webhook_endpoints/${webhook.id}`, { method: "DELETE", stripeAccount: false });
    const readback = await direct("api.stripe.com", `/v1/webhook_endpoints/${webhook.id}`, { stripeAccount: false, allowed: [404] });
    ensure(readback.http === 404, "throwaway endpoint is absent on read-back"); record.cleanup.webhook = { last4: suffix(webhook.id), readbackHttp: 404 };
  });
}
try {
  await exchange();
  scratch ??= await mkdtemp(resolve(tmpdir(), "synthetic-dial-hk2-")); await chmod(scratch, 0o700);
  account = (await stripe("/v1/account", { stripeAccount: false })).id;
  webhook = await stripe("/v1/webhook_endpoints", { method: "POST", stripeAccount: false, form: { url: "https://example.com/synthetic-dial-hk2-placeholder", "enabled_events[0]": "checkout.session.completed" } }); webhookSecret = webhook.secret;
  record.anonymousPayloads = true;
  relay = createServer(async (request, response) => {
    try {
      const [, host, ...path] = request.url.split("/");
      if (!["api.stripe.com", "sandbox-quickbooks.api.intuit.com"].includes(host)) { record.relayRefusals++; response.writeHead(502); response.end(); return; }
      count("dial", host, request.method);
      const chunks = []; for await (const chunk of request) chunks.push(chunk); const bytes = Buffer.concat(chunks);
      if (host === "sandbox-quickbooks.api.intuit.com") ensure(!bytes.includes(Buffer.from("synthetic-dial-hk2-invitee")) && !bytes.includes(Buffer.from("@")), "QBO payload contains no invitee name or email");
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !["host", "connection", "content-length"].includes(name)));
      const upstream = await fetch(`https://${host}/${path.join("/")}`, { method: request.method, headers, ...(bytes.length ? { body: bytes } : {}), redirect: "manual", signal: AbortSignal.timeout(30000) });
      const result = Buffer.from(await upstream.arrayBuffer());
      if (host === "sandbox-quickbooks.api.intuit.com" && request.method === "POST" && upstream.ok) {
        const value = JSON.parse(result); record.qboWrites ??= [];
        if (value.Item) { item = value.Item; itemCreated = true; record.qboWrites.push({ kind: "item", id: value.Item.Id }); }
        if (value.SalesReceipt) { receipt = value.SalesReceipt; receiptCreated = true; documentRef = receipt.DocNumber; record.qboWrites.push({ kind: "salesreceipt", id: receipt.Id }); }
      }
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" }); response.end(result);
    } catch { record.relayRefusals++; response.writeHead(502); response.end(); }
  });
  await new Promise((done, reject) => { relay.once("error", reject); relay.listen(port + 2, "127.0.0.1", done); });
  phase = "booking-wire startup"; await startRuntime();
  cookie = (await call("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Sandbox proof owner", returnTo: "/app" }, 303)).headers.get("set-cookie").split(";")[0];
  await call("/wire/init", {}); await call("/__fixtures/setup", {}); await call("/__fixtures/payments/connect", { accountId: account }, 204);
  phase = "public booking"; await pay(); phase = "accounting doors"; await accounting(); phase = "connected Settings captures"; await screens();
  const disconnected = await call("/api/app/payments/accounting", undefined, 200, "DELETE"); ensure(disconnected.state === "disconnected", "disconnect clears local grant");
  ensure((await call("/api/app/payments/accounting")).state === "disconnected", "status confirms disconnected");
  ensure(record.relayRefusals === 0, "relay refused no provider request"); record.result = "PASS";
} catch (error) {
  record.result ??= "FAILED";
  // Only controlled messages are retained; Playwright errors may carry Checkout URLs.
  record.failure = error.message.startsWith("BLOCKED ") ? error.message : `${phase}: ${error.name}; ${error.message.split("\n")[0].replace(/https?:\/\/\S+/g, "[URL]").replace(/(?:cs_test|pi|ch|acct|whsec|sk_test)_[A-Za-z0-9_]+/g, "[provider value]").replaceAll(realm, "[realm]")}`;
} finally {
  await browser?.close(); await browserServer?.close(); await stopRuntime();
  if (accessToken && !preserveRotation && record.rotation?.storeBackVerificationExit === 0) await cleanup();
  if (relay) await new Promise(done => relay.close(done));
  delete record.qboWrites;
  if (scratch && !preserveRotation) await rm(scratch, { recursive: true, force: true });
  record.scratchRemoved = !preserveRotation;
  record.finishedAt = new Date().toISOString(); await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(record, null, 2) + "\n");
}
console.log(record.result);
process.exitCode = record.result === "PASS" ? 0 : 2;
