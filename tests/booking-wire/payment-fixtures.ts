import type { AppServices } from "../../src/core/app/services";
import { payStripeSession } from "./stripe-wire";

/** PAY-001 test-only controls: the payer finishing Stripe's page, a payment window or OAuth state reaching its
 * end, the production sweep, and a full-table scan for payer details. */
export async function paymentFixtures(url: URL, request: Request, db: D1Database, providerDb: D1Database, services: AppServices) {
  if (url.pathname === "/__fixtures/payments/pay") {
    const { sessionId, paymentStatus } = await request.json<{ sessionId: string; paymentStatus?: "paid" | "unpaid" }>();
    const session = await payStripeSession(providerDb, sessionId, paymentStatus);
    return session ? Response.json(session) : new Response(null, { status: 404 });
  }
  if (url.pathname === "/__fixtures/payments/window-ended") {
    const { holdId } = await request.json<{ holdId: string }>();
    await db.prepare("UPDATE payment_holds SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(holdId).run();
    await services.payments.sweepExpiredHolds();
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
