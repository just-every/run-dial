/** Contract-shaped Stripe API and Connect OAuth at the HTTP edge (PAY-001, PAY-003). Production's StripeApi talks to
 * these exactly as to api.stripe.com and connect.stripe.com; no Stripe secret exists in CI. */
export const stripeHosts = ["api.stripe.com", "connect.stripe.com"];

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
  // Stripe replays the first response to a repeated idempotency key, errors included.
  const key = method === "POST" ? headers.get("idempotency-key") : null;
  if (key && !url.pathname.startsWith("/v1/checkout/sessions")) {
    const prior = await db.prepare("SELECT status, body FROM wire_stripe_replies WHERE idempotency_key=?").bind(key).first<{ status: number; body: string }>();
    if (prior) return new Response(prior.body, { status: prior.status, headers: { "content-type": "application/json" } });
    const response = await stripeObjects(db, url, method, form);
    await db.prepare("INSERT INTO wire_stripe_replies(idempotency_key,status,body) VALUES(?,?,?)").bind(key, response.status, await response.clone().text()).run();
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
    // Stripe refuses payment_method_types on Checkout Sessions; methods come from the Dashboard.
    if ([...form.keys()].some(name => name.startsWith("payment_method_types[")) || !form.get("success_url")?.includes("{CHECKOUT_SESSION_ID}")) return stripeError(400, "parameter_invalid");
    if (mode === "payment" ? !items.length || items.some(index => form.get(`line_items[${index}][price_data][currency]`) !== "usd") : mode !== "setup" || form.get("currency") !== "usd" || items.length) return stripeError(400, "parameter_invalid");
    const sessionId = `cs_test_wire${crypto.randomUUID().replaceAll("-", "")}`;
    const session = { id: sessionId, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${sessionId}`, status: "open", payment_status: mode === "setup" ? "no_payment_required" : "unpaid", mode,
      amount_total: mode === "setup" ? null : items.reduce((total, index) => total + Number(form.get(`line_items[${index}][price_data][unit_amount]`)) * Number(form.get(`line_items[${index}][quantity]`) ?? 1), 0),
      currency: "usd", payment_intent: null, setup_intent: null, customer: null, expires_at: Number(form.get("expires_at")),
      client_reference_id: form.get("client_reference_id"), metadata: prefixed(form, "metadata"), customer_creation: form.get("customer_creation"),
      payment_intent_data: { metadata: prefixed(form, "payment_intent_data[metadata]"), setup_future_usage: form.get("payment_intent_data[setup_future_usage]") },
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
  const intent = /^\/v1\/(payment_intents|setup_intents)\/([^/]+)$/.exec(url.pathname);
  if (intent && method === "GET") {
    const found = await object(db, intent[2]);
    return found && found.type === intent[1] ? Response.json(found.payload) : stripeError(404, "resource_missing");
  }
  if (url.pathname === "/v1/payment_intents" && method === "POST") {
    // An off-session charge of a saved card: it needs the customer the card is attached to and is confirmed at once.
    const card = await object(db, form.get("payment_method") ?? "");
    if (form.get("off_session") !== "true" || form.get("confirm") !== "true" || form.get("currency") !== "usd" || !card || card.payload.customer !== form.get("customer")) return stripeError(400, "parameter_invalid");
    if (await control(db, "stripe-card-decline")) return stripeError(402, "card_declined");
    const created = { id: `pi_wire${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`, object: "payment_intent", status: "succeeded", amount: Number(form.get("amount")), amount_received: Number(form.get("amount")), amount_refunded: 0, currency: "usd", customer: form.get("customer"), payment_method: card.id, off_session: true, description: form.get("description"), metadata: prefixed(form, "metadata") };
    await save(db, created.id, "payment_intents", created);
    return Response.json(created);
  }
  if (url.pathname === "/v1/refunds" && method === "POST") {
    const charged = await object(db, form.get("payment_intent") ?? "");
    const amount = Number(form.get("amount"));
    if (!charged || charged.type !== "payment_intents" || charged.payload.status !== "succeeded") return stripeError(400, "resource_missing");
    if (!Number.isInteger(amount) || amount < 1 || amount > Number(charged.payload.amount) - Number(charged.payload.amount_refunded ?? 0)) return stripeError(400, "amount_too_large");
    await save(db, charged.id, "payment_intents", { ...charged.payload, amount_refunded: Number(charged.payload.amount_refunded ?? 0) + amount });
    const refund = { id: `re_wire${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`, object: "refund", status: "succeeded", amount, currency: "usd", payment_intent: charged.id, metadata: prefixed(form, "metadata") };
    await save(db, refund.id, "refunds", refund);
    return Response.json(refund);
  }
  const detach = /^\/v1\/payment_methods\/([^/]+)\/detach$/.exec(url.pathname);
  if (detach && method === "POST") {
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
export async function payStripeSession(db: D1Database, id: string, paymentStatus: "paid" | "unpaid" = "paid") {
  const row = await db.prepare("SELECT payload FROM wire_stripe_sessions WHERE id=?").bind(id).first<{ payload: string }>();
  if (!row) return undefined;
  const session = JSON.parse(row.payload) as Record<string, unknown> & { mode: string; amount_total: number | null; customer_creation: string | null; payment_intent_data: { metadata: Record<string, string>; setup_future_usage: string | null } };
  const suffix = id.slice(-12), saveCard = session.mode === "setup" || session.payment_intent_data.setup_future_usage === "off_session";
  const customer = session.customer_creation === "always" ? `cus_wire${suffix}` : null, card = saveCard ? `pm_wire${suffix}` : null;
  if (card) await save(db, card, "payment_methods", { id: card, object: "payment_method", type: "card", customer });
  const completed = { ...session, status: "complete", url: null, customer,
    // Stripe holds the payer and card on its own objects; Dial must not copy them.
    customer_details: { email: "payer-card-holder@dial.test", name: "Card Holder Name" }, payment_method_details: { card: { last4: "4242" } } };
  if (session.mode === "setup") {
    const setup = { id: `seti_wire${suffix}`, object: "setup_intent", status: "succeeded", customer, payment_method: card, usage: "off_session" };
    await save(db, setup.id, "setup_intents", setup);
    Object.assign(completed, { setup_intent: setup.id, payment_status: "no_payment_required" });
  } else {
    const intent = { id: `pi_wire${suffix}`, object: "payment_intent", status: paymentStatus === "paid" ? "succeeded" : "processing", amount: session.amount_total, amount_received: paymentStatus === "paid" ? session.amount_total : 0, amount_refunded: 0, currency: "usd", customer, payment_method: card ?? `pm_wire_once${suffix}`, setup_future_usage: session.payment_intent_data.setup_future_usage, metadata: session.payment_intent_data.metadata };
    await save(db, intent.id, "payment_intents", intent);
    Object.assign(completed, { payment_intent: intent.id, payment_status: paymentStatus });
  }
  await db.prepare("UPDATE wire_stripe_sessions SET payload=? WHERE id=?").bind(JSON.stringify(completed), id).run();
  return completed;
}

export async function initializeStripeWire(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS wire_calls(id INTEGER PRIMARY KEY,url TEXT,method TEXT,body TEXT,headers TEXT,at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_stripe_sessions(id TEXT PRIMARY KEY,idempotency_key TEXT,payload TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_stripe_objects(id TEXT PRIMARY KEY,type TEXT NOT NULL,payload TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_stripe_replies(idempotency_key TEXT PRIMARY KEY,status INTEGER NOT NULL,body TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_controls(name TEXT PRIMARY KEY,value INTEGER)"),
  ]);
}

/** The same Stripe edge for the browser review rig. */
export function stripeTransport(db: D1Database): typeof fetch {
  return async (input, init = {}) => { await initializeStripeWire(db); return stripeWire(db, new URL(String(input)), init.method ?? "GET", init); };
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
