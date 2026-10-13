import start from "@tanstack/react-start/server-entry";
import { createWorker } from "../../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
import { fixtureProviders } from "../review/providers";
import { handleFixtures } from "../review/fixture-routes";

const servicesFor = (env: AppBindings) => createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, { ...fixtureProviders(env.DB), calendarChanges: coordinatedCalendarChanges(env) });
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
const production = createWorker(servicesFor);
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    if (!url.pathname.startsWith("/__fixtures/")) return production.fetch(request, env, context);
    if (url.pathname === "/__fixtures/ux/accepted-response-loss" && request.method === "POST") {
      const forwarded = new Request(new URL("/api/public/book/dial-host/intro/confirm", request.url), request);
      const response = await production.fetch(forwarded, env, context);
      if (response.status !== 201) return response;
      // Task-owned post-commit response loss: the actual confirmation has already committed.
      await response.arrayBuffer();
      return new Response("Synthetic accepted response lost", { status: 503 });
    }
    return handleFixtures(request, env, servicesFor);
  },
};
