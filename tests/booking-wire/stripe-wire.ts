import { accountingHosts, accountingWire } from "./accounting-wire";
/** Contract-shaped Stripe API and Connect OAuth at the HTTP edge (PAY-001, PAY-003, PAY-005). Production's StripeApi
 * talks to these exactly as to api.stripe.com and connect.stripe.com; no Stripe secret exists in CI. */
export const stripeHosts = ["api.stripe.com", "connect.stripe.com"];
import { stripeCustomerErasure } from "./stripe-erasure";
import { stripeApprovalSetup } from "./stripe-approval-setup";
import { stripeGate } from "./stripe-gates";
import { stripeAuthorization } from "./stripe-authorization";

type Stored = { id: string; type: string; payload: Record<string, unknown> };

export async function stripeWire(db: D1Database, url: URL, method: string, init: RequestInit) {
  const headers = new Headers(init.headers), form = new URLSearchParams(String(init.body ?? ""));
  await db.prepare("INSERT INTO wire_calls(url,method,body,headers) VALUES(?,?,?,?)").bind(url.toString(), method, JSON.stringify(Object.fromEntries(form)), JSON.stringify({ account: headers.get("stripe-account"), idempotency: headers.get("idempotency-key") })).run();
  if (headers.get("authorization") !== "Bearer sk_test_wire") return stripeError(401, "api_key_invalid");
  if (url.hostname === "connect.stripe.com") {
    if (url.pathname === "/oauth/token" && method === "POST") return form.get("grant_type") === "authorization_code" && form.get("code") === "wire-stripe-consent"
      ? Response.json({ access_token: "synthetic-connected-token-dial-never-stores", livemode: false, refresh_token: "synthetic-connected-refresh-dial-never-stores", scope: "read_write", stripe_publishable_key: "pk_test_wire", stripe_user_id: "acct_wirehost", token_type: "bearer" })
      : Response.json({ error: "invalid_grant", error_description: "Authorization code does not exist" }, { status: 400 });
    if (url.pathname === "/oauth/deauthorize" && method === "POST" && form.get("client_id") === "ca_wire") return Response.json({ stripe_user_id: form.get("stripe_user_id") });
    return stripeError(404, "resource_missing");
  }
  const account = headers.get("stripe-account");
  if (account !== "acct_wirehost") return stripeError(403, "account_invalid");
  await stripeGate(db, url.pathname, method);
  // Stripe replays the first response to a repeated idempotency key, errors included.
  const key = method === "POST" ? headers.get("idempotency-key") : null;
  if (key && !url.pathname.startsWith("/v1/checkout/sessions")) {
    const prior = await db.prepare("SELECT status, body FROM wire_stripe_replies WHERE idempotency_key=?").bind(key).first<{ status: number; body: string }>();
    if (prior) return new Response(prior.body, { status: prior.status, headers: { "content-type": "application/json" } });
    // Transport faults happen outside Stripe's idempotent execution: a retry sees the original result.
    if (url.pathname === "/v1/refunds" && await control(db, "stripe-refund-unavailable")) return stripeError(503, "unavailable");
    if (/\/customers\/[^/]+$/.test(url.pathname) && await control(db, "stripe-anonymize-unavailable")) return stripeError(503, "unavailable");
    if(url.pathname==="/v1/setup_intents" && await control(db,"stripe-setup-unavailable"))return stripeError(503,"unavailable");
    const operation = /\/payment_intents\/[^/]+\/(capture|cancel)$/.exec(url.pathname)?.[1];
    if (operation && await control(db, `stripe-${operation}-unavailable`)) return stripeError(503, "unavailable");
    const response = await stripeObjects(db, url, method, form);
    await db.prepare("INSERT INTO wire_stripe_replies(idempotency_key,status,body) VALUES(?,?,?)").bind(key, response.status, await response.clone().text()).run();
    if (/\/invoices\/[^/]+\/finalize$/.test(url.pathname) && response.ok && await control(db, "stripe-finalize-response-lost")) return stripeError(503, "unavailable");
    if(url.pathname==="/v1/setup_intents" && response.ok && await control(db,"stripe-setup-response-lost"))return stripeError(503,"unavailable");
    if (operation && response.ok && await control(db, `stripe-${operation}-response-lost`)) return stripeError(503, "unavailable");
    return response;
  }
  if (url.pathname.startsWith("/v1/checkout/sessions")) return checkoutSessions(db, url, method, form, headers.get("idempotency-key"));
  return stripeObjects(db, url, method, form);
}

async function checkoutSessions(db: D1Database, url: URL, method: string, form: URLSearchParams, key: string | null) {
  const match = /^\/v1\/checkout\/sessions(?:\/([^/]+))?(\/expire)?$/.exec(url.pathname);
  if (!match) return stripeError(404, "resource_missing");
  const [, id, expire] = match;
  if (!id && method === "POST") {
    const prior = key ? await db.prepare("SELECT payload FROM wire_stripe_sessions WHERE idempotency_key=?").bind(key).first<{ payload: string }>() : null;
    if (prior) return Response.json(JSON.parse(prior.payload));
    const mode = form.get("mode");
    const items = [...new Set([...form.keys()].map(name => /^line_items\[(\d+)\]/.exec(name)?.[1]).filter(Boolean))];
    // The current Checkout API uses allowed_payment_method_types, and rejects the old parameter.
    if ([...form.keys()].some(name => name.startsWith("payment_method_types[")) || !form.get("success_url")?.includes("{CHECKOUT_SESSION_ID}")) return stripeError(400, "parameter_invalid");
    if (mode === "payment" ? !items.length || items.some(index => form.get(`line_items[${index}][price_data][currency]`) !== "usd") : mode !== "setup" || form.get("currency") !== "usd" || items.length) return stripeError(400, "parameter_invalid");
    const sessionId = `cs_test_wire${crypto.randomUUID().replaceAll("-", "")}`;
    const session = { id: sessionId, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${sessionId}`, status: "open", payment_status: mode === "setup" ? "no_payment_required" : "unpaid", mode,
      amount_total: mode === "setup" ? null : items.reduce((total, index) => total + Number(form.get(`line_items[${index}][price_data][unit_amount]`)) * Number(form.get(`line_items[${index}][quantity]`) ?? 1), 0),
      currency: "usd", payment_intent: null, setup_intent: null, customer: null, expires_at: Number(form.get("expires_at")),
      client_reference_id: form.get("client_reference_id"), metadata: prefixed(form, "metadata"), customer_creation: form.get("customer_creation"), customer_email: form.get("customer_email"),
      allowed_payment_method_types: [...form.entries()].filter(([name]) => name.startsWith("allowed_payment_method_types[")).map(([, value]) => value),
      setup_intent_data: { metadata: prefixed(form, "setup_intent_data[metadata]") },
      payment_intent_data: { capture_method: form.get("payment_intent_data[capture_method]") ?? "automatic", metadata: prefixed(form, "payment_intent_data[metadata]"), setup_future_usage: form.get("payment_intent_data[setup_future_usage]") },
      line_items: items.map(index => ({ name: form.get(`line_items[${index}][price_data][product_data][name]`), amount: Number(form.get(`line_items[${index}][price_data][unit_amount]`)) })),
      excluded_payment_method_types: [...form.entries()].filter(([name]) => name.startsWith("excluded_payment_method_types[")).map(([, value]) => value) };
    await db.prepare("INSERT INTO wire_stripe_sessions(id,idempotency_key,payload) VALUES(?,?,?)").bind(sessionId, key, JSON.stringify(session)).run();
    return Response.json(session);
  }
  const row = id ? await db.prepare("SELECT payload FROM wire_stripe_sessions WHERE id=?").bind(id).first<{ payload: string }>() : null;
  if (!row) return stripeError(404, "resource_missing");
  const session = JSON.parse(row.payload) as { status: string };
  if (method === "GET" && !expire) return Response.json(session);
  if (method === "POST" && expire) {
    if (session.status !== "open") return stripeError(400, "checkout_session_not_open");
    const expired = { ...session, status: "expired", url: null };
    await db.prepare("UPDATE wire_stripe_sessions SET payload=? WHERE id=?").bind(JSON.stringify(expired), id).run();
    return Response.json(expired);
  }
  return stripeError(404, "resource_missing");
}

/** PaymentIntents, SetupIntents, refunds and saved payment methods (PAY-003). */
async function stripeObjects(db: D1Database, url: URL, method: string, form: URLSearchParams) {
  const setup=await stripeApprovalSetup(db,url,method,form);
  if(setup)return setup;
  const erasure = await stripeCustomerErasure(db,url,method,form);
  if(erasure)return erasure;
  const authorization = await stripeAuthorization(db, url, method, form);
  if (authorization) return authorization;
  const intent = /^\/v1\/(payment_intents|setup_intents)\/([^/]+)$/.exec(url.pathname);
  if (intent && method === "GET") {
    const found = await object(db, intent[2]);
    return found && found.type === intent[1] ? Response.json(found.payload) : stripeError(404, "resource_missing");
  }
  if(url.pathname==='/v1/balance_transactions'&&method==='GET'){
    const rows=(await db.prepare("SELECT payload FROM wire_stripe_objects WHERE type='balance_transactions'").all<{payload:string}>()).results.map(r=>JSON.parse(r.payload)).filter(r=>r.payout===url.searchParams.get('payout'));
    return Response.json({data:rows,has_more:false});
  }
  const transaction=/^\/v1\/balance_transactions\/([^/]+)$/.exec(url.pathname);
  if(transaction&&method==='GET'){const row=await object(db,transaction[1]);return row?Response.json(row.payload):stripeError(404,'resource_missing');}
  if (url.pathname === "/v1/payment_intents" && method === "POST") {
    // An off-session charge of a saved card: it needs the customer the card is attached to and is confirmed at once.
    const card = await object(db, form.get("payment_method") ?? "");
    if (form.get("off_session") !== "true" || form.get("confirm") !== "true" || form.get("currency") !== "usd" || !card || card.payload.customer !== form.get("customer")) return stripeError(400, "parameter_invalid");
    if (await control(db, "stripe-card-decline")) return stripeError(402, "card_declined");
    const created = { id: `pi_wire${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`, object: "payment_intent", status: "succeeded", amount: Number(form.get("amount")), amount_received: Number(form.get("amount")), amount_capturable: 0, capture_method: "automatic", amount_refunded: 0, currency: "usd", customer: form.get("customer"), payment_method: card.id, off_session: true, description: form.get("description"), metadata: prefixed(form, "metadata") };
    await save(db, created.id, "payment_intents", created);
    return Response.json(created);
  }
  const refundRead = /^\/v1\/refunds\/([^/]+)$/.exec(url.pathname);
  if (refundRead && method === "GET") {
    const refund = await object(db, refundRead[1]);
    return refund?.type === "refunds" ? Response.json(refund.payload) : stripeError(404, "resource_missing");
  }
  if (url.pathname === "/v1/refunds" && method === "POST") {
    const charged = await object(db, form.get("payment_intent") ?? "");
    const amount = Number(form.get("amount"));
    if (!charged || charged.type !== "payment_intents" || charged.payload.status !== "succeeded") return stripeError(400, "resource_missing");
    if (!Number.isInteger(amount) || amount < 1 || amount > Number(charged.payload.amount) - Number(charged.payload.amount_refunded ?? 0)) return stripeError(400, "amount_too_large");
    await save(db, charged.id, "payment_intents", { ...charged.payload, amount_refunded: Number(charged.payload.amount_refunded ?? 0) + amount });
    const refund = { id: `re_wire${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`, object: "refund", status: await control(db, "stripe-refund-pending") ? "pending" : "succeeded", amount, currency: "usd", payment_intent: charged.id, metadata: prefixed(form, "metadata") };
    await save(db, refund.id, "refunds", refund);
    return Response.json(refund);
  }
  if (url.pathname === "/v1/tax/calculations" && method === "POST") return taxCalculation(db, form);
  if (url.pathname === "/v1/customers" && method === "POST") {
    if (await control(db, "stripe-customer-refused")) return stripeError(400, "customer_refused");
    const customer = { id: `cus_wire${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, object: "customer", email: form.get("email"), name: form.get("name"), address: prefixed(form, "address") };
    await save(db, customer.id, "customers", customer);
    return Response.json(customer);
  }
  if (url.pathname === "/v1/invoices" && method === "POST") {
    if (await control(db, "stripe-invoice-refused")) return stripeError(400, "invoice_refused");
    if (!(await object(db, form.get("customer") ?? "")) || form.get("collection_method") !== "send_invoice" || !form.get("days_until_due")) return stripeError(400, "parameter_invalid");
    const draft = { id: `in_wire${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, object: "invoice", status: "draft", customer: form.get("customer"), total: 0, amount_due: 0, amount_paid: 0, currency: "usd", lines: [] as Array<{ amount: number; description: string | null }>, hosted_invoice_url: null, number: null, payment_intent: null, metadata: prefixed(form, "metadata") };
    await save(db, draft.id, "invoices", draft);
    return Response.json(draft);
  }
  if (url.pathname === "/v1/invoiceitems" && method === "POST") {
    const invoice = await object(db, form.get("invoice") ?? "");
    if (!invoice || invoice.payload.status !== "draft" || invoice.payload.customer !== form.get("customer") || form.get("currency") !== "usd") return stripeError(400, "parameter_invalid");
    const amount = Number(form.get("amount")), lines = [...invoice.payload.lines as Array<{ amount: number; description: string | null }>, { amount, description: form.get("description") }];
    await save(db, invoice.id, "invoices", { ...invoice.payload, lines, total: lines.reduce((total, line) => total + line.amount, 0), amount_due: lines.reduce((total, line) => total + line.amount, 0) });
    return Response.json({ id: `ii_wire${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, object: "invoiceitem", amount, invoice: invoice.id });
  }
  const finalize = /^\/v1\/invoices\/([^/]+)\/finalize$/.exec(url.pathname);
  if (finalize && method === "POST") {
    const invoice = await object(db, finalize[1]);
    if (!invoice || invoice.payload.status !== "draft") return stripeError(400, "invoice_not_editable");
    const count = (await db.prepare("SELECT count(*) AS n FROM wire_stripe_objects WHERE type='invoices' AND json_extract(payload, '$.number') IS NOT NULL").first<{ n: number }>())?.n ?? 0;
    const open = { ...invoice.payload, status: "open", number: `WIRE-${String(count + 1).padStart(4, "0")}`, hosted_invoice_url: `https://invoice.stripe.com/i/acct_wirehost/${invoice.id}` };
    await save(db, invoice.id, "invoices", open);
    return Response.json(open);
  }
  // Stripe voids only an open invoice; a paid one stays paid.
  const voiding = /^\/v1\/invoices\/([^/]+)\/void$/.exec(url.pathname);
  if (voiding && method === "POST") {
    const invoice = await object(db, voiding[1]);
    if (!invoice) return stripeError(404, "resource_missing");
    if (invoice.payload.status !== "open") return stripeError(400, "invoice_not_open");
    const voided = { ...invoice.payload, status: "void", amount_due: 0 };
    await save(db, invoice.id, "invoices", voided);
    return Response.json(voided);
  }
  const detach = /^\/v1\/payment_methods\/([^/]+)\/detach$/.exec(url.pathname);
  if (detach && method === "POST") {
    if(await control(db,"stripe-detach-refused"))return stripeError(403,"payment_method_detach_refused");
    const card = await object(db, detach[1]);
    if (!card) return stripeError(404, "resource_missing");
    if (!card.payload.customer) return stripeError(400, "payment_method_unexpected_state");
    await save(db, card.id, "payment_methods", { ...card.payload, customer: null });
    return Response.json({ ...card.payload, customer: null });
  }
  return stripeError(404, "resource_missing");
}

/** The payer completes Stripe's hosted page. A payment session gets its PaymentIntent and, when the payer agreed
 * to save the card, a customer and an attached card; a setup session gets its SetupIntent and the saved card. */
export async function payStripeSession(db: D1Database, id: string, paymentStatus: "paid" | "unpaid" = "paid", paymentMethod = "card") {
  const row = await db.prepare("SELECT payload FROM wire_stripe_sessions WHERE id=?").bind(id).first<{ payload: string }>();
  if (!row) return undefined;
  const session = JSON.parse(row.payload) as Record<string, unknown> & { mode: string; amount_total: number | null; customer_creation: string | null; allowed_payment_method_types: string[]; setup_intent_data: { metadata: Record<string, string> }; payment_intent_data: { capture_method: string; metadata: Record<string, string>; setup_future_usage: string | null } };
  if (session.allowed_payment_method_types.length && !session.allowed_payment_method_types.includes(paymentMethod)) return { error: { code: session.payment_intent_data.capture_method === "manual" ? "approval_requires_card_or_link" : "payment_method_not_allowed" } };
  if (session.status === "complete") return session;
  if (session.status !== "open") return undefined;
  const suffix = id.slice(-12), saveCard = session.mode === "setup" || session.payment_intent_data.setup_future_usage === "off_session";
  const customer = session.customer_creation === "always" ? `cus_wire${suffix}` : null, card = saveCard ? `pm_wire${suffix}` : null;
  if (customer) await save(db, customer, "customers", { id: customer, object: "customer", email: session.customer_email });
  if (card) await save(db, card, "payment_methods", { id: card, object: "payment_method", type: "card", customer });
  const completed = { ...session, status: "complete", url: null, customer,
    // Stripe holds the payer and card on its own objects; Dial must not copy them.
    customer_details: { email: "payer-card-holder@dial.test", name: "Card Holder Name" }, payment_method_details: { card: { last4: "4242" } } };
  if (session.mode === "setup") {
    const setup = { id: `seti_wire${suffix}`, object: "setup_intent", status: "succeeded", customer, payment_method: card, usage: "off_session", metadata: session.setup_intent_data.metadata };
    await save(db, setup.id, "setup_intents", setup);
    Object.assign(completed, { setup_intent: setup.id, payment_status: "no_payment_required" });
  } else {
    const manual = session.payment_intent_data.capture_method === "manual";
    const intent = { id: `pi_wire${suffix}`, object: "payment_intent", status: manual ? "requires_capture" : paymentStatus === "paid" ? "succeeded" : "processing", capture_method: manual ? "manual" : "automatic", amount: session.amount_total, amount_capturable: manual ? session.amount_total : 0, amount_received: !manual && paymentStatus === "paid" ? session.amount_total : 0, payment_method_types: [paymentMethod], amount_refunded: 0, currency: "usd", customer, payment_method: card ?? `pm_wire_once${suffix}`, setup_future_usage: session.payment_intent_data.setup_future_usage, metadata: session.payment_intent_data.metadata };
    await save(db, intent.id, "payment_intents", intent);
    Object.assign(completed, { payment_intent: intent.id, payment_status: manual ? "unpaid" : paymentStatus });
  }
  await db.prepare("UPDATE wire_stripe_sessions SET payload=? WHERE id=?").bind(JSON.stringify(completed), id).run();
  return completed;
}

/** Synthetic Stripe Tax: sales tax by the address's state, none where the state has no sales tax. */
const salesTax: Record<string, { rate: number; name: string }> = { NY: { rate: 0.08875, name: "Sales Tax" }, WA: { rate: 0.1025, name: "Sales Tax" }, TX: { rate: 0.0825, name: "Sales Tax" } };
async function taxCalculation(db: D1Database, form: URLSearchParams) {
  if (await control(db, "stripe-tax-inactive")) return stripeError(400, "stripe_tax_inactive");
  const amount = Number(form.get("line_items[0][amount]")), state = form.get("customer_details[address][state]") ?? "";
  if (form.get("currency") !== "usd" || !Number.isInteger(amount) || form.get("customer_details[address][country]") !== "US" || !/^\d{5}/.test(form.get("customer_details[address][postal_code]") ?? "") || form.get("line_items[0][tax_behavior]") !== "exclusive") return stripeError(400, "parameter_invalid");
  const rule = salesTax[state], tax = rule ? Math.round(amount * rule.rate) : 0;
  return Response.json({ id: `taxcalc_wire${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, object: "tax.calculation", currency: "usd", amount_total: amount + tax, tax_amount_exclusive: tax, tax_amount_inclusive: 0,
    tax_breakdown: [{ amount: tax, inclusive: false, taxable_amount: rule ? amount : 0, taxability_reason: rule ? "standard_rated" : "not_subject_to_tax", tax_rate_details: { country: "US", state, display_name: rule?.name ?? "Sales Tax", percentage_decimal: rule ? String(Number((rule.rate * 100).toFixed(4))) : "0.0", tax_type: "sales_tax" } }] });
}

/** The payer pays a hosted invoice: it is paid by a new PaymentIntent that a refund can draw on. */
export async function payStripeInvoice(db: D1Database, id: string) {
  const invoice = await object(db, id);
  if (!invoice || invoice.payload.status !== "open") return undefined;
  const intent = { id: `pi_wire_inv${id.slice(-10)}`, object: "payment_intent", status: "succeeded", amount: invoice.payload.total, amount_received: invoice.payload.total, amount_capturable: 0, capture_method: "automatic", amount_refunded: 0, currency: "usd", customer: invoice.payload.customer, payment_method: `pm_wire_inv${id.slice(-10)}`, metadata: {} };
  await save(db, intent.id, "payment_intents", intent);
  const paid = { ...invoice.payload, status: "paid", amount_paid: invoice.payload.total, amount_due: 0, payment_intent: intent.id };
  await save(db, id, "invoices", paid);
  return paid;
}

export async function initializeStripeWire(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS wire_calls(id INTEGER PRIMARY KEY,url TEXT,method TEXT,body TEXT,headers TEXT,at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_stripe_sessions(id TEXT PRIMARY KEY,idempotency_key TEXT,payload TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_stripe_objects(id TEXT PRIMARY KEY,type TEXT NOT NULL,payload TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_stripe_replies(idempotency_key TEXT PRIMARY KEY,status INTEGER NOT NULL,body TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_controls(name TEXT PRIMARY KEY,value INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_stripe_gates(name TEXT PRIMARY KEY,path TEXT,method TEXT,entered INTEGER,released INTEGER)"),
  ]);
}

/** The same Stripe edge for the browser review rig. */
export function stripeTransport(db: D1Database): typeof fetch {
  return async (input, init = {}) => { await initializeStripeWire(db); const url=new URL(String(input)); return accountingHosts.includes(url.hostname)?accountingWire(db,url,init.method??"GET",init):stripeWire(db, url, init.method ?? "GET", init); };
}

async function object(db: D1Database, id: string): Promise<Stored | undefined> {
  const row = await db.prepare("SELECT id, type, payload FROM wire_stripe_objects WHERE id=?").bind(id).first<{ id: string; type: string; payload: string }>();
  return row ? { id: row.id, type: row.type, payload: JSON.parse(row.payload) as Record<string, unknown> } : undefined;
}
async function save(db: D1Database, id: string, type: string, payload: unknown) {
  await db.prepare("INSERT INTO wire_stripe_objects(id,type,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(id, type, JSON.stringify(payload)).run();
}
async function control(db: D1Database, name: string) {
  return (await db.prepare("SELECT value FROM wire_controls WHERE name=?").bind(name).first<{ value: number }>())?.value;
}
function prefixed(form: URLSearchParams, prefix: string) {
  return Object.fromEntries([...form.entries()].flatMap(([name, value]) => name.startsWith(`${prefix}[`) && !name.slice(prefix.length + 1).includes("[") ? [[name.slice(prefix.length + 1, -1), value]] : []));
}
function stripeError(status: number, code: string) { return Response.json({ error: { code, message: `Synthetic Stripe ${code}`, type: status === 402 ? "card_error" : "invalid_request_error" } }, { status }); }
