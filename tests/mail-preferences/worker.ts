import { captureAuthMail, capturedMail } from "../mail-capture";
import { ensureTestOperator } from "../auth-fixture";
import start from "@tanstack/react-start/server-entry";
import { z } from "zod";
import { createWorker } from "../../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
import { fixtureProviders } from "../review/providers";
import { handleFixtures } from "../review/fixture-routes";

const secondEmail = "second-operator@dial.test";
const servicesFor = (env: AppBindings) => createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, { ...fixtureProviders(env.DB), authMail: captureAuthMail(env.DB), calendarChanges: coordinatedCalendarChanges(env) });
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
const production = createWorker(servicesFor);
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    if (url.pathname === "/__test/mail") return capturedMail(env.DB);
    if (url.pathname === "/__fixtures/preferences/operators" && request.method === "POST") {
      const operator = await ensureTestOperator(env.DB, secondEmail);
      return Response.json({ operator });
    }
    if (url.pathname === "/__fixtures/preferences/state" && request.method === "GET") return Response.json({ operators: (await env.DB.prepare("SELECT id,email FROM operators ORDER BY email").all()).results, preferences: (await env.DB.prepare("SELECT operator_id,booking_mail_muted FROM operator_delivery_preferences ORDER BY operator_id").all()).results });
    if (url.pathname === "/__fixtures/preferences/reconcile" && request.method === "POST") return Response.json(await servicesFor(env).delivery.confirmConnections());
    if (url.pathname === "/__fixtures/preferences/signin" && request.method === "POST") {
      const { email } = z.object({ email: z.enum(["operator@dial.test", secondEmail]) }).strict().parse(await request.json());
      const runtime = { ...parseRuntimeEnvironment(env), ENVIRONMENT: "preview" as const };
      const services = createServices(env.DB, runtime, { fetch: (input: Request) => start.fetch(input) } as Fetcher, { ...fixtureProviders(env.DB), calendarChanges: coordinatedCalendarChanges(env) });
      return Response.json(await services.operators.requestMagicLink(request, email));
    }
    return url.pathname.startsWith("/__fixtures/") ? handleFixtures(request, env, servicesFor) : production.fetch(request, env, context);
  },
};
