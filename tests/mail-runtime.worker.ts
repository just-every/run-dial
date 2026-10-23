import { operatorNotificationCommand } from "../src/core/platform/operator-notification-boundary";
import start from "@tanstack/react-start/server-entry";
import { createWorker } from "../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../src/core/app/booking-coordinator";
import { createServices } from "../src/core/app/services";
import { parseRuntimeEnvironment } from "../src/core/shared/runtime-env";
import type { AppBindings } from "../src/core/app/bindings";
import { captureMail, capturedMail } from "./mail-capture";

const servicesFor = (env: AppBindings) => createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, { operatorNotifications: operatorNotificationCommand(env.BOOKING_COORDINATOR), files: env.FILES, mail: captureMail(env.DB) });
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
const worker = createWorker(servicesFor);
export default {
  ...worker,
  fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    if (new URL(request.url).pathname === "/__test/mail") return capturedMail(env.DB);
    return worker.fetch(request, env, context);
  },
};
