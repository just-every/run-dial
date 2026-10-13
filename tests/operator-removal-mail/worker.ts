import { issuedDevelopmentLink } from "../development-auth";
import { ensureTestOperator, registerTestSetup } from "../auth-fixture";
import start from "@tanstack/react-start/server-entry";
import { createWorker } from "../../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import { loadPrivateShell } from "../../src/core/app/loaders";
import type { AppBindings } from "../../src/core/app/bindings";
import { ProviderFailure } from "../../src/core/platform/calendar";
import { DeliveryRepository } from "../../src/core/features/delivery";
import { fixtureProviders } from "../review/providers";
import { handleFixtures } from "../review/fixture-routes";
import { setup, status } from "../review/setup";

type RemovalBindings = AppBindings & { PROVIDER_DB?: D1Database };
function providerDb(env: RemovalBindings) { if (!env.PROVIDER_DB) throw Error("Missing test network-edge database"); return env.PROVIDER_DB; }
function servicesFor(env: RemovalBindings) {
  const providers = fixtureProviders(providerDb(env));
  return createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, {
    ...providers, calendarChanges: coordinatedCalendarChanges(env),
    mail: { ...providers.mail, async send(message) {
      await providerDb(env).prepare("INSERT INTO removal_mail_calls (key, message_json) VALUES (?, ?)").bind(message.idempotencyKey, JSON.stringify(message)).run();
      const fault = await providerDb(env).prepare("SELECT mode FROM removal_mail_faults WHERE key = ?").bind(message.idempotencyKey).first<{ mode: string }>();
      if (fault?.mode === "before") throw new ProviderFailure("provider_timeout", true);
      const receipt = await providers.mail.send(message);
      if (fault?.mode === "after") throw new ProviderFailure("provider_timeout", true);
      if (fault?.mode === "terminal") throw new ProviderFailure("provider_unavailable", false);
      return receipt;
    } },
  });
}
export class BookingCoordinator extends ProductionCoordinator { protected services(env: RemovalBindings) { return servicesFor(env); } }
const production = createWorker(servicesFor);
export default {
  ...production,
  async fetch(request: Request, env: RemovalBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    const services = servicesFor(env);
    if (url.pathname === "/__removal/private-function") return Response.json({ path: loadPrivateShell.url });
    if (url.pathname === "/__removal/bounce") {
      const { providerMessageId } = await request.json<{ providerMessageId: string }>();
      return Response.json({ changed: await new DeliveryRepository(env.DB).markProviderMessageFailed(providerMessageId, "bounced") });
    }
    if (url.pathname === "/__removal/setup") {
      await providerDb(env).batch([
        providerDb(env).prepare("CREATE TABLE IF NOT EXISTS removal_mail_calls (id INTEGER PRIMARY KEY, key TEXT NOT NULL, message_json TEXT NOT NULL)"),
        providerDb(env).prepare("CREATE TABLE IF NOT EXISTS removal_mail_faults (key TEXT PRIMARY KEY, mode TEXT NOT NULL)"),
      ]);
      const fixture = await setup(env, services);
      const owner = await ensureTestOperator(env.DB, fixture.operatorEmail);
      await registerTestSetup(env.DB, owner.id);
      return Response.json(fixture);
    }
    if (url.pathname === "/__removal/signin") {
      const { email } = await request.json<{ email: string }>();
      const development = createServices(env.DB, { ...parseRuntimeEnvironment(env), ENVIRONMENT: "development", MAIL_PROVIDER: "development", APP_URL: url.origin, MAIL_FROM: "noreply@dial.test" }, { fetch: (input: Request) => start.fetch(input) } as Fetcher);
      const entry = await env.DB.prepare("SELECT status FROM oa_operators WHERE email=?").bind(email).first<{ status: string }>();
      const link = await issuedDevelopmentLink(env.DB, email, () => entry?.status === "invited"
        ? development.operatorManagement.invite(request, email)
        : development.operators.requestMagicLink(request, email));
      return Response.json({ link });
    }
    if (url.pathname === "/__removal/alert") {
      const { cycle } = await request.json<{ cycle: number }>();
      await new DeliveryRepository(env.DB).enqueueConnectionAlert({ provider: "resend", status: "unhealthy", reason: "provider_timeout", alertCycle: cycle });
      return Response.json({ queued: true });
    }
    if (url.pathname === "/__removal/sql") {
      const { sql, values = [] } = await request.json<{ sql: string; values?: string[] }>();
      return Response.json(await (/\b(?:removal_mail_|fixture_)/.test(sql) ? providerDb(env) : env.DB).prepare(sql).bind(...values).all());
    }
    if (url.pathname === "/__removal/process") {
      const { id } = await request.json<{ id: string }>();
      return Response.json({ result: await services.delivery.process({ outboxId: id }) });
    }
    if (url.pathname === "/__removal/state") return Response.json({
      ...await status(env.DB, providerDb(env)),
      operators: (await env.DB.prepare("SELECT id, email, removed_at FROM operators ORDER BY email").all()).results,
      calls: (await providerDb(env).prepare("SELECT * FROM removal_mail_calls ORDER BY id").all()).results,
      connections: (await env.DB.prepare("SELECT * FROM calendar_connections").all()).results,
    });
    return url.pathname.startsWith("/__fixtures/") ? handleFixtures(request, env, servicesFor) : production.fetch(request, env, context);
  },
};
