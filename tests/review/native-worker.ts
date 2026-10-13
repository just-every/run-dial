import { createApp } from "../../src/core/app/hono";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { bookingMutationTarget, forwardBookingRequest, coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
import { fixtureProviders } from "./providers";
import { handleFixtures } from "./fixture-routes";
type FixtureBindings = AppBindings & { PROVIDER_DB: D1Database };
const servicesFor = (env: AppBindings) => createServices(env.DB, parseRuntimeEnvironment(env), env.ASSETS, { ...fixtureProviders((env as FixtureBindings).PROVIDER_DB), files: env.FILES, calendarChanges: coordinatedCalendarChanges(env) });
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
const app = createApp(undefined, servicesFor);
export default {
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    if (new URL(request.url).hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    if (new URL(request.url).pathname.startsWith("/__fixtures/")) return handleFixtures(request, env, servicesFor);
    const target = await bookingMutationTarget(request, env);
    return target ? forwardBookingRequest(env, target, request) : app.fetch(request, env, context);
  },
};
