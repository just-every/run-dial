import type { AppServices } from "../core/app/services";
import { schedulingTools } from "./scheduling-tools";
import { bookingTools } from "./booking-tools";
import { workspaceTools } from "./workspace-tools";
import { paymentTools } from "./payment-tools";

/** Native synchronous registry. Queued effects and provider administration are undeclared. */
export function dialTools(services: AppServices) {
  return [...schedulingTools(services), ...bookingTools(services), ...workspaceTools(services), ...paymentTools(services)];
}
