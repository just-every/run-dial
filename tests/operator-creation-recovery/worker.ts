import { ensureTestOperator } from "../auth-fixture";
import start from "@tanstack/react-start/server-entry";
import { createWorker } from "../../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
import { fixtureProviders, isolatedProviderDb } from "../review/providers";
import { handleFixtures } from "../review/fixture-routes";
import { setup, status } from "../review/setup";

const secondEmail = "second-operator@dial.test";
function servicesFor(env: AppBindings) {
  return createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, { ...fixtureProviders(isolatedProviderDb(env)), calendarChanges: coordinatedCalendarChanges(env) });
}
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
const production = createWorker(servicesFor);
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    isolatedProviderDb(env);
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    if (url.pathname === "/__fixtures/setup" && request.method === "POST") {
      const services = servicesFor(env), fixture = await setup(env, services);
      const second = await ensureTestOperator(env.DB, secondEmail);
      return Response.json({ ...fixture, secondEmail: second.email });
    }
    if (url.pathname === "/__fixtures/recovery/state" && request.method === "GET") {
      const state = await status(env.DB, isolatedProviderDb(env));
      for (const table of ["operators", "operator_creation_receipts", "operator_creation_tombstones"]) state[table] = (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
      return Response.json(state);
    }
    if (url.pathname.startsWith("/__fixtures/")) return handleFixtures(request, env, servicesFor);
    const response = await production.fetch(request, env, context);
    // Discard only a successful task-owned response after the real production commit.
    if (url.pathname === "/api/app/bookings" && request.method === "POST" && request.headers.get("X-Synthetic-Lost-Response") === "yes" && response.status === 201) return Response.json({ error: { code: "synthetic_lost_response" } }, { status: 503 });
    return response;
  },
};
