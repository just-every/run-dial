import type { AppServices } from "../core/app/services";
import { schedulingTools } from "./scheduling-tools";
import { bookingTools } from "./booking-tools";
import { workspaceTools } from "./workspace-tools";
import { paymentTools } from "./payment-tools";

/** Native adapters prepared for the shared door; the Worker does not mount them yet. */
export function dialTools(services: AppServices) {
  return [...schedulingTools(services), ...bookingTools(services), ...workspaceTools(services), ...paymentTools(services)];
}
