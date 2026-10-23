import type { AppServices } from "../../src/core/app/services";
import { payStripeInvoice, payStripeSession } from "./stripe-wire";
import { stripeGateFixture } from "./stripe-gates";
import { stripeAuthorization } from "./stripe-authorization";

/** PAY-001 test-only controls: the payer finishing Stripe's page, a payment window or OAuth state reaching its
 * end, the production sweep, and a full-table scan for payer details. */
export async function paymentFixtures(url: URL, request: Request, db: D1Database, providerDb: D1Database, services: AppServices) {
  if(url.pathname==='/__fixtures/payments/payout'){
    const {intentId,payoutId}=await request.json<{intentId:string;payoutId:string}>();
    const value={id:'synthetic-dial-208',object:'balance_transaction',payout:payoutId,amount:2500,fee:100,net:2400,source:{id:'synthetic-dial-202',payment_intent:intentId}};
    await providerDb.prepare("INSERT INTO wire_stripe_objects(id,type,payload) VALUES(?,'balance_transactions',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(value.id,JSON.stringify(value)).run();return Response.json(value);
  }
  if (url.pathname === "/__fixtures/payments/accounting-expired") { await db.prepare("UPDATE accounting_oauth_states SET expires_at='2000-01-01T00:00:00Z'").run();return new Response(null,{status:204}); }
  if (url.pathname === "/__fixtures/payments/accounting-token-expired") { await db.prepare("UPDATE accounting_connections SET expires_at='2000-01-01T00:00:00Z'").run();return new Response(null,{status:204}); }
  if (url.pathname === "/__fixtures/payments/accounting-state") { return Response.json({receipts:(await providerDb.prepare("SELECT payload FROM wire_accounting_objects WHERE kind='SalesReceipt'").all<{payload:string}>()).results.map(r=>JSON.parse(r.payload)),exports:(await db.prepare("SELECT * FROM accounting_exports").all()).results}); }
  if (url.pathname === "/__fixtures/payments/gate") return stripeGateFixture(providerDb, request);
  if (url.pathname === "/__fixtures/payments/processor-state") {
    return Response.json(Object.fromEntries(await Promise.all(["wire_stripe_sessions","wire_stripe_objects","wire_calls"].map(async name => [name,(await providerDb.prepare(`SELECT * FROM ${name}`).all()).results]))));
  }
  if (url.pathname === "/__fixtures/payments/control") {
    const {name,value}=await request.json<{name:string;value:number}>();
    await providerDb.prepare("INSERT INTO wire_controls(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").bind(name,value).run();
    return Response.json({ok:true});
  }
  if (url.pathname === "/__fixtures/payments/pay") {
    const { sessionId, paymentStatus, paymentMethod } = await request.json<{ sessionId: string; paymentStatus?: "paid" | "unpaid"; paymentMethod?: string }>();
    const session = await payStripeSession(providerDb, sessionId, paymentStatus, paymentMethod);
    return session ? Response.json(session, { status: "error" in session ? 400 : 200 }) : new Response(null, { status: 404 });
  }
  if (url.pathname === "/__fixtures/payments/capture") {
    const { intentId, amountCents } = await request.json<{intentId:string;amountCents:number}>();
    return (await stripeAuthorization(providerDb, new URL(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(intentId)}/capture`), "POST", new URLSearchParams({amount_to_capture:String(amountCents)})))!;
  }
  if (url.pathname === "/__fixtures/payments/pay-invoice") {
    const { invoiceId } = await request.json<{ invoiceId: string }>();
    const invoice = await payStripeInvoice(providerDb, invoiceId);
    return invoice ? Response.json(invoice) : new Response(null, { status: 404 });
  }
  if (url.pathname === "/__fixtures/payments/window-ended") {
    const { holdId } = await request.json<{ holdId: string }>();
    await db.prepare("UPDATE payment_holds SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(holdId).run();
    await services.payments.sweepExpiredHolds();
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/__fixtures/payments/connect") {
    // The real-provider proof has no Connect client ID for a live OAuth grant; it records the test account directly.
    const { accountId } = await request.json<{ accountId: string }>();
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO payment_connections (singleton_key, provider, account_id, status, livemode, ach_enabled, connected_by_operator_id, connected_at, status_changed_at, created_at, updated_at) VALUES ('default','stripe',?,'connected',0,0,NULL,?,?,?,?) ON CONFLICT(singleton_key) DO UPDATE SET account_id=excluded.account_id, status='connected'").bind(accountId, now, now, now, now).run();
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/__fixtures/payments/oauth-expired") {
    await db.prepare("UPDATE payment_oauth_states SET expires_at='2000-01-01T00:00:00.000Z' WHERE consumed_at IS NULL").run();
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/__fixtures/payments/all-rows") {
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' AND name<>'booking_search_casefold'").all<{ name: string }>()).results.map(row => row.name);
    return Response.json(Object.fromEntries(await Promise.all(tables.map(async name => [name, (await db.prepare(`SELECT * FROM "${name}"`).all()).results]))));
  }
  return new Response("Not found", { status: 404 });
}
