import { captureMail } from "../mail-capture";
import { issuedDevelopmentLink } from "../development-auth";
import { ensureTestOperator, registerTestSetup } from "../auth-fixture";
import { createApp } from "../../src/core/app/hono";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import { createId } from "../../src/core/shared/ids";
import type { AppBindings } from "../../src/core/app/bindings";
import { delayedBinding, mailSink } from "./controls";
import { fixtureProviders, isolatedProviderDb } from "../review/providers";
import { setup } from "../review/setup";
import { DeliveryRepository } from "../../src/core/features/delivery";

const servicesFor = (env: AppBindings, stage = "worker") => createServices(delayedBinding(env.DB, isolatedProviderDb(env), stage), parseRuntimeEnvironment(env), env.ASSETS, { ...fixtureProviders(isolatedProviderDb(env)), mail: mailSink(env) });
export class BookingCoordinator extends ProductionCoordinator {
  constructor(ctx: DurableObjectState, env: AppBindings) { super(ctx, { ...env, DB: delayedBinding(env.DB, isolatedProviderDb(env), "gate") }); }
  protected services(env: AppBindings) { return servicesFor(env, "gate"); }
}
const app = createApp(undefined, servicesFor);
export default {
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    const services = servicesFor(env);
    if (url.pathname === "/__order/setup") {
      const providerDb = isolatedProviderDb(env);
      await providerDb.batch([
        providerDb.prepare("CREATE TABLE order_control (singleton INTEGER PRIMARY KEY, stage TEXT, reached INTEGER DEFAULT 0, released INTEGER DEFAULT 0, failure INTEGER DEFAULT 0)"),
        providerDb.prepare("INSERT INTO order_control(singleton) VALUES (1)"),
        providerDb.prepare("CREATE TABLE order_calls (id INTEGER PRIMARY KEY, key TEXT, message_json TEXT, recipient_removed TEXT, recipient_present INTEGER NOT NULL, source_present INTEGER NOT NULL, source_state TEXT, invocation_state TEXT, provider_outcome TEXT NOT NULL DEFAULT 'invoking', provider_message_id TEXT)"),
      ]);
      const owner = await ensureTestOperator(env.DB, "owner@example.test");
      await registerTestSetup(env.DB, owner.id);
      const other = await ensureTestOperator(env.DB, "colleague@example.test");
      await setup(env, services);
      const signin = createServices(env.DB, { ...parseRuntimeEnvironment(env), ENVIRONMENT: "development", MAIL_PROVIDER: "development", APP_URL: url.origin, MAIL_FROM: "noreply@dial.test" }, env.ASSETS, { mail: captureMail(env.DB) });
      const link = await issuedDevelopmentLink(env.DB, owner.email, () => signin.operators.requestMagicLink(request, owner.email));
      return Response.json({ owner, other, link });
    }
    if (url.pathname === "/__order/sql") {
      const { sql, values = [] } = await request.json<{ sql: string; values: unknown[] }>();
      // These exact test-only tables live outside the application schema.
      const db = /\b(?:FROM|UPDATE|INTO)\s+"?(?:order_control|order_calls)"?\b/i.test(sql) ? isolatedProviderDb(env) : env.DB;
      return Response.json(await db.prepare(sql).bind(...values).all());
    }
    if (url.pathname === "/__order/enqueue") {
      const { email, role = "operator", key } = await request.json<{ email: string; role: string | null; key: string }>();
      const id = createId();
      const admission = await env.DB.prepare("SELECT id, access_generation AS generation FROM operators WHERE email = ?").bind(email).first();
      const payload = { to: email, ...(role ? { recipientRole: role } : {}), ...(role !== "invitee" ? { operatorAccess: admission } : {}), subject: "Notification ordering", text: "Synthetic native ordering proof" };
      await env.DB.prepare("INSERT INTO delivery_outbox (id, kind, idempotency_key, payload_json, state, attempts, next_attempt_at, created_at, updated_at) VALUES (?, 'mail_send', ?, ?, 'pending', 0, '2000', '2000', '2000')")
        .bind(id, key, JSON.stringify(payload)).run();
      return Response.json({ id });
    }
    if (url.pathname === "/__order/alert") {
      const { cycle } = await request.json<{ cycle: number }>();
      await new DeliveryRepository(delayedBinding(env.DB, isolatedProviderDb(env), "worker")).enqueueConnectionAlert({ provider: "resend", status: "unhealthy", reason: "provider_timeout", alertCycle: cycle });
      return Response.json({ queued: true });
    }
    if (url.pathname === "/__order/process") {
      const { id } = await request.json<{ id: string }>();
      return Response.json({ result: await services.delivery.process({ outboxId: id }) });
    }
    if (url.pathname === "/__order/due") return Response.json(await services.delivery.processDue());
    if ((url.pathname === "/api/app/operators" || /^\/api\/app\/operators\/[^/]+\/remove$/.test(url.pathname)) && request.method === "POST") return env.BOOKING_COORDINATOR.get(env.BOOKING_COORDINATOR.idFromName("operator-notifications")).fetch(request);
    return app.fetch(request, env, context);
  },
};
