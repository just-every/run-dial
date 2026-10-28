import { webhookFixtures } from "../booking-wire/webhook-fixtures";
import { webhookWire } from "../booking-wire/webhook-wire";
import { operatorNotificationCommand } from "../../src/core/platform/operator-notification-boundary";
import { stripeTransport } from "../booking-wire/stripe-wire";
import start from "@tanstack/react-start/server-entry";
import { createWorker } from "../../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
import { fixtureProviders } from "./providers";
import { handleFixtures } from "./fixture-routes";

const servicesFor = (env: AppBindings) => createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, { webhookTransport: webhookWire(), operatorNotifications: operatorNotificationCommand(env.BOOKING_COORDINATOR), ...fixtureProviders((env as AppBindings & { PROVIDER_DB?: D1Database }).PROVIDER_DB ?? env.DB), paymentsTransport: stripeTransport((env as AppBindings & { PROVIDER_DB?: D1Database }).PROVIDER_DB ?? env.DB), files: env.FILES, calendarChanges: coordinatedCalendarChanges(env) });
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
const production = createWorker(servicesFor);
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    if (!url.pathname.startsWith("/__fixtures/")) return production.fetch(request, env, context);
    const webhookFixture = await webhookFixtures(request, servicesFor(env), env);
    return webhookFixture ?? handleFixtures(request, env, servicesFor);
  },
};
