import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { bookingReadClass } from "./booking-native-state";
import { bookingId } from "./booking-schemas";
import { nativeTool,objectOutput,required } from "./native-tool";

export function bookingCalendarTools(services: AppServices): ToolDefinition[] {
  return [
    nativeTool({
      name: "dial.bookings.calendar_deletion_status", title: "Read calendar deletion reconciliation", scope: "dial:read", readOnly: true,
      description: "Read recorded native deletion-inspection attempts, pending/failed state and exact resolution. No provider event content is returned.",
      input: bookingId, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["CAL-008", "CAL-005", "AGENT-004"],
      classify: () => bookingReadClass(),
      async run({ id }) { return { result: { probes: required(await services.bookings.calendarDeletionStatus(id)) } }; },
    }),
  ];
}
