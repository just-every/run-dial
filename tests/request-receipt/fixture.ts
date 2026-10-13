import { Hono } from "hono";
import type { AppEnvironment } from "../../src/core/app/context";
import type { RuntimeEnvironment } from "../../src/core/shared/runtime-env";
import { availabilityRequestRoutes } from "../../src/core/features/availability-requests/routes";
import { AvailabilityRequestsService } from "../../src/core/features/availability-requests/service";
import { AvailabilityRequestsRepository } from "../../src/core/features/availability-requests/repository";
import { EventTypesRepository, EventTypesService } from "../../src/core/features/event-types";
import { HostProfileRepository } from "../../src/core/features/host-profile/repository";
import { HostProfileService } from "../../src/core/features/host-profile/service";

export function receiptApp(binding: D1Database) {
  const profiles = new HostProfileService(new HostProfileRepository(binding));
  const events = new EventTypesService(new EventTypesRepository(binding), profiles);
  const availabilityRequests = new AvailabilityRequestsService(new AvailabilityRequestsRepository(binding), events, profiles, { SESSION_SECRET: "receipt-test-only-session-secret-at-least-32" } as RuntimeEnvironment);
  const app = new Hono<AppEnvironment>();
  app.use("*", async (context, next) => {
    context.set("services", { availabilityRequests } as AppEnvironment["Variables"]["services"]);
    await next();
  });
  app.route("/", availabilityRequestRoutes);
  return app;
}
