/** Contract-shaped Stripe API and Connect OAuth at the HTTP edge (PAY-001). Production's StripeApi talks to
 * these exactly as to api.stripe.com and connect.stripe.com; no Stripe secret exists in CI. */
export const stripeHosts = ["api.stripe.com", "connect.stripe.com"];

export async function stripeWire(db: D1Database, url: URL, method: string, init: RequestInit) {
  const headers = new Headers(init.headers), form = new URLSearchParams(String(init.body ?? ""));
  await db.prepare("INSERT INTO wire_calls(url,method,body,headers) VALUES(?,?,?,?)").bind(url.toString(), method, JSON.stringify(Object.fromEntries(form)), JSON.stringify({ account: headers.get("stripe-account"), idempotency: headers.get("idempotency-key") })).run();
  if (headers.get("authorization") !== "Bearer sk_test_wire") return stripeError(401, "api_key_invalid");
  if (url.hostname === "connect.stripe.com") {
    if (url.pathname === "/oauth/token" && method === "POST") return form.get("grant_type") === "authorization_code" && form.get("code") === "wire-stripe-consent"
      ? Response.json({ access_token: "connected-token-dial-never-stores", livemode: false, refresh_token: "connected-refresh-dial-never-stores", scope: "read_write", stripe_publishable_key: "pk_test_wire", stripe_user_id: "acct_wirehost", token_type: "bearer" })
      : Response.json({ error: "invalid_grant", error_description: "Authorization code does not exist" }, { status: 400 });
    if (url.pathname === "/oauth/deauthorize" && method === "POST" && form.get("client_id") === "ca_wire") return Response.json({ stripe_user_id: form.get("stripe_user_id") });
    return stripeError(404, "resource_missing");
  }
  const account = headers.get("stripe-account");
  if (account !== "acct_wirehost") return stripeError(403, "account_invalid");
  const match = /^\/v1\/checkout\/sessions(?:\/([^/]+))?(\/expire)?$/.exec(url.pathname);
  if (!match) return stripeError(404, "resource_missing");
  const [, id, expire] = match;
  if (!id && method === "POST") {
    const key = headers.get("idempotency-key");
    const prior = key ? await db.prepare("SELECT payload FROM wire_stripe_sessions WHERE idempotency_key=?").bind(key).first<{ payload: string }>() : null;
    if (prior) return Response.json(JSON.parse(prior.payload));
    if (form.get("mode") !== "payment" || form.get("line_items[0][price_data][currency]") !== "usd" || !form.get("success_url")?.includes("{CHECKOUT_SESSION_ID}")) return stripeError(400, "parameter_invalid");
    const sessionId = `cs_test_wire${crypto.randomUUID().replaceAll("-", "")}`;
    const session = { id: sessionId, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${sessionId}`, status: "open", payment_status: "unpaid", mode: "payment",
      amount_total: Number(form.get("line_items[0][price_data][unit_amount]")), currency: "usd", payment_intent: null, expires_at: Number(form.get("expires_at")),
      client_reference_id: form.get("client_reference_id"), metadata: { dial_hold_id: form.get("metadata[dial_hold_id]") },
      payment_method_types: [...form.entries()].filter(([name]) => name.startsWith("payment_method_types[")).map(([, value]) => value) };
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

/** The payer completes Stripe's hosted page: the session is paid and gets its PaymentIntent. */
export async function payStripeSession(db: D1Database, id: string, paymentStatus: "paid" | "unpaid" = "paid") {
  const row = await db.prepare("SELECT payload FROM wire_stripe_sessions WHERE id=?").bind(id).first<{ payload: string }>();
  if (!row) return undefined;
  const paid = { ...JSON.parse(row.payload), status: "complete", payment_status: paymentStatus, payment_intent: `pi_wire${id.slice(-12)}`, url: null,
    // Stripe holds the payer and card on its own objects; Dial must not copy them.
    customer_details: { email: "payer-card-holder@dial.test", name: "Card Holder Name" }, payment_method_details: { card: { last4: "4242" } } };
  await db.prepare("UPDATE wire_stripe_sessions SET payload=? WHERE id=?").bind(JSON.stringify(paid), id).run();
  return paid;
}

export async function initializeStripeWire(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS wire_stripe_sessions(id TEXT PRIMARY KEY,idempotency_key TEXT,payload TEXT)").run();
}

function stripeError(status: number, code: string) { return Response.json({ error: { code, message: `Synthetic Stripe ${code}`, type: "invalid_request_error" } }, { status }); }
