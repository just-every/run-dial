import start from "@tanstack/react-start/server-entry";
import { createWorker } from "../../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { connectionWatchObservers } from "../../src/core/app/connection-watch";
import { MicrosoftCalendarAdapter } from "../../src/core/platform/calendar/microsoft";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
import { graph } from "./worker";
function servicesFor(env: AppBindings) {
  return createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, {
    files: env.FILES,
    calendar: new MicrosoftCalendarAdapter({ clientId: "synthetic-dial-1607", clientSecret: "synthetic-dial-1608" }, graph.request),
    calendarChanges: coordinatedCalendarChanges(env), connectionWatch: connectionWatchObservers(env),
  });
}
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
export default createWorker(servicesFor);
