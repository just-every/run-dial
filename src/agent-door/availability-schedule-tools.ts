import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { closureFields, scheduleInputSchema, type NamedSchedule, type ScheduleInput } from "../core/features/availability/schedule-input";
import { eventChangeClasses, eventIdInput } from "./event-tool-support";
import { arrayOutput, nativeTool, objectOutput, required, standard } from "./native-tool";

function requireNoClosures(input: ScheduleInput) {
  const fields = closureFields(input);
  if (fields.length) throw new ToolRefusal("invalid_request", "Holidays and time off belong to Your hours, which every event uses.", { fields });
}

export function availabilityScheduleTools(services: AppServices): ToolDefinition[] {
  const read = { scope: "dial:read", readOnly: true, classes: ["standard"] as ["standard"], classify: () => standard(), clauses: ["AVAIL-011"] };
  const affected = async (schedule: NamedSchedule, input: ScheduleInput) => {
    const events = await services.eventTypes.listEventTypes();
    const closuresChanged = schedule.isDefault && JSON.stringify([schedule.blockUsHolidays, schedule.reopenedHolidays, schedule.timeOff]) !== JSON.stringify([input.blockUsHolidays, input.reopenedHolidays, input.timeOff]);
    if (closuresChanged) return events;
    const hours = await services.yourHours.read(), uses = schedule.isDefault ? "yours" : schedule.id;
    const ids = new Set(hours.events.filter(event => event.uses === uses).map(event => event.id));
    return events.filter(event => ids.has(event.id));
  };
  return [
    nativeTool({
      ...read, name: "dial.availability.list_schedules", title: "List named schedules", description: "List native reusable schedules and their event counts, including Your hours.",
      input: z.object({}).strict(), outputSchema: arrayOutput, run: async () => ({ result: await services.namedSchedules.list() }),
    }),
    nativeTool({
      ...read, name: "dial.availability.get_schedule", title: "Read named schedule", description: "Read one existing native named schedule and its persisted revision.",
      input: eventIdInput, outputSchema: objectOutput, run: async args => ({ result: required(await services.namedSchedules.get(args.id)) }),
    }),
    nativeTool({
      name: "dial.availability.create_schedule", title: "Create named schedule", description: "Create native reusable weekly hours. Holidays and time off must stay on Your hours.",
      scope: "dial:write", readOnly: false, input: scheduleInputSchema, outputSchema: objectOutput,
      classes: ["standard"], clauses: ["AVAIL-011"], classify: () => standard(),
      summary: args => ({ target: { name: args.name }, items: ["Create an unassigned named schedule", `Schedule: ${JSON.stringify(args)}`] }),
      run: async args => { requireNoClosures(args); return { result: await services.namedSchedules.save(args) }; },
    }),
    nativeTool({
      name: "dial.availability.save_schedule", title: "Save named schedule", description: "Replace native named hours and update every event using them. Only Your hours may contain holidays and time off, which apply across all events.",
      scope: "dial:write", readOnly: false, input: eventIdInput.extend({ schedule: scheduleInputSchema }).strict(), outputSchema: objectOutput,
      classes: ["standard", "live", "external"], clauses: ["AVAIL-001", "AVAIL-011"],
      classify: async args => eventChangeClasses(await affected(required(await services.namedSchedules.get(args.id)), args.schedule)),
      revisionType: "string", revision: async args => required(await services.namedSchedules.get(args.id)).updatedAt,
      summary: async args => {
        const schedule = required(await services.namedSchedules.get(args.id));
        const events = await affected(schedule, args.schedule);
        return { target: { id: schedule.id, name: schedule.name }, items: [`Affected events: ${events.map(event => `${event.title} (${event.id})`).join(", ") || "none"}`, `Schedule: ${JSON.stringify(args.schedule)}`] };
      },
      run: async args => {
        const schedule = required(await services.namedSchedules.get(args.id));
        if (!schedule.isDefault) requireNoClosures(args.schedule);
        return { result: await services.namedSchedules.save(args.schedule, schedule.id) };
      },
    }),
    nativeTool({
      name: "dial.availability.save_closures", title: "Save host holidays and time off", description: "Replace holidays, reopened holiday dates and time off on native Your hours. These closures apply to every event regardless of its hours choice.",
      scope: "dial:write", readOnly: false,
      input: scheduleInputSchema.pick({ blockUsHolidays: true, reopenedHolidays: true, timeOff: true }).strict(), outputSchema: objectOutput,
      classes: ["standard", "live", "external"], clauses: ["AVAIL-001", "AVAIL-011"],
      classify: async () => eventChangeClasses(await services.eventTypes.listEventTypes()),
      revisionType: "string", revision: async () => (await services.namedSchedules.yours())?.updatedAt ?? null,
      summary: async args => {
        const schedule = await services.namedSchedules.yours();
        return { target: schedule ? { id: schedule.id, name: schedule.name } : { name: "Your hours" }, items: ["Apply holidays and time off to every event", `Closures: ${JSON.stringify(args)}`] };
      },
      run: async args => ({ result: await services.yourHours.saveClosures(args) }),
    }),
  ];
}
