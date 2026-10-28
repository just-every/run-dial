import type { ResourceDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { schedulingResources } from "./resource-scheduling";
import { bookingResources } from "./resource-bookings";
import { peopleResources } from "./resource-people";

export function dialResources(services: AppServices): ResourceDefinition[] {
  return [...schedulingResources(services), ...bookingResources(services), ...peopleResources(services)];
}
