import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { recurringAvailabilitySchema } from "../core/features/event-types/event-input";
import { dateAvailabilityOverrideInputSchema, hostDateSchema } from "../core/shared/scheduling";
import { arrayOutput, nativeTool, required, standard } from "./native-tool";
import { eventIdInput, eventWrite, recurringTargets } from "./event-tool-support";

export function eventHoursTools(services: AppServices): ToolDefinition[] {
  return [
    eventWrite(services, {
      name: "dial.event.replace_availability", title: "Replace recurring event hours", description: "Replace recurring native windows. When the event uses shared hours, update that schedule and every event using it.",
      input: eventIdInput.extend({ windows: recurringAvailabilitySchema }).strict(), clauses: ["EVENT-002", "AVAIL-001", "AVAIL-011"],
      affected: args => recurringTargets(services, args.id),
      items: async args => {
        const [schedule, targets] = await Promise.all([services.namedSchedules.forEvent(args.id), recurringTargets(services, args.id)]);
        return [schedule ? `Replace windows on shared schedule ${schedule.name} (${schedule.id})` : "Replace this event's own weekly windows", `Affected events: ${targets.map(event => `${event.title} (${event.id})`).join(", ")}`, `Windows: ${JSON.stringify(args.windows)}`];
      },
      run: async args => ({ result: required(await services.eventTypes.replaceRecurringAvailability(args.id, args.windows)) }),
    }),
    nativeTool({
      name: "dial.event.list_date_overrides", title: "List event date overrides", description: "List the event's native date-specific availability overrides.",
      scope: "dial:read", readOnly: true, input: eventIdInput, outputSchema: arrayOutput,
      classes: ["standard"], clauses: ["AVAIL-001"], classify: () => standard(),
      run: async args => ({ result: required(await services.eventTypes.listDateAvailabilityOverrides(args.id)) }),
    }),
    eventWrite(services, {
      name: "dial.event.save_date_override", title: "Save date availability override", description: "Replace one native host-date override, rejecting invalid windows, past dates and a missing or invalid host timezone.",
      input: z.object({ id: eventIdInput.shape.id, override: dateAvailabilityOverrideInputSchema }).strict(), clauses: ["AVAIL-001", "AVAIL-005", "EVENT-002"],
      items: args => [`Replace availability for host date ${args.override.hostDate}`, `Override: ${JSON.stringify(args.override)}`],
      run: async args => {
        const result = await services.eventTypes.replaceDateAvailabilityOverride(args.id, args.override);
        if (result.kind !== "saved") throw new ToolRefusal(result.kind);
        return { result: result.override };
      },
    }),
    eventWrite(services, {
      name: "dial.event.delete_date_override", title: "Delete date availability override", description: "Delete one native future host-date override so recurring hours apply again. Host-wide holidays and time off still apply.",
      input: eventIdInput.extend({ hostDate: hostDateSchema }).strict(), clauses: ["AVAIL-001", "AVAIL-005"], destructive: true,
      items: args => [`Delete the override for host date ${args.hostDate}; restore recurring hours for that date`],
      run: async args => {
        const result = await services.eventTypes.deleteDateAvailabilityOverride(args.id, args.hostDate);
        if (result !== "deleted") throw new ToolRefusal(result);
        return { result: { id: args.id, hostDate: args.hostDate, deleted: true } };
      },
    }),
  ];
}
