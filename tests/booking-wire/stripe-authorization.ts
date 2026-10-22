/** Stripe's manual authorization lifecycle. This edge owns processor state, never Dial booking state. */
export async function stripeAuthorization(db: D1Database, url: URL, method: string, form: URLSearchParams) {
  const match = /^\/v1\/payment_intents\/([^/]+)\/(capture|cancel)$/.exec(url.pathname);
  if (!match || method !== "POST") return undefined;
  const [, id, operation] = match;
  const row = await db.prepare("SELECT payload FROM wire_stripe_objects WHERE id=? AND type='payment_intents'").bind(id).first<{ payload: string }>();
  const failure = (code: string) => Response.json({ error: { code, type: "invalid_request_error" } }, { status: 400 });
  if (!row) return failure("resource_missing");
  const intent = JSON.parse(row.payload) as Record<string, unknown>;
  if (intent.status !== "requires_capture") return failure("payment_intent_unexpected_state");
  let next: Record<string, unknown>;
  if (operation === "capture") {
    const amount = Number(form.get("amount_to_capture") ?? intent.amount_capturable);
    if (!Number.isInteger(amount) || amount < 1 || amount > Number(intent.amount_capturable)) return failure("amount_too_large");
    next = { ...intent, status: "succeeded", amount_received: amount, amount_capturable: 0 };
  } else {
    const reason = form.get("cancellation_reason");
    if (reason && !["duplicate", "fraudulent", "requested_by_customer", "abandoned"].includes(reason)) return failure("parameter_invalid");
    next = { ...intent, status: "canceled", amount_received: 0, amount_capturable: 0, cancellation_reason: reason };
  }
  await db.prepare("UPDATE wire_stripe_objects SET payload=? WHERE id=?").bind(JSON.stringify(next), id).run();
  if (operation === "capture") {
    const sessions = (await db.prepare("SELECT id,payload FROM wire_stripe_sessions WHERE json_extract(payload,'$.payment_intent')=?").bind(id).all<{ id: string; payload: string }>()).results;
    for (const session of sessions) await db.prepare("UPDATE wire_stripe_sessions SET payload=? WHERE id=?").bind(JSON.stringify({ ...JSON.parse(session.payload), payment_status: "paid" }), session.id).run();
  }
  return Response.json(next);
}
