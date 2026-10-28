import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { bookingLimitsSchema } from "../core/features/availability/booking-limits";
import { hasSupportedInstantPrecision } from "../core/shared/instants";
import { availabilityScheduleTools } from "./availability-schedule-tools";
import { eventChangeClasses, eventIdInput, eventRecord, eventWrite } from "./event-tool-support";
import { nativeTool, objectOutput, required, standard } from "./native-tool";

const scopeInput = z.object({ scope: z.union([z.literal("host"), z.string().length(26)]) }).strict();
const hoursChoice = z.union([
  z.object({ uses: z.literal("own"), startFrom: z.union([z.literal("yours"), z.string().length(26)]).optional() }).strict(),
  z.object({ uses: z.union([z.literal("yours"), z.string().length(26)]) }).strict(),
]);

export function availabilityTools(services: AppServices): ToolDefinition[] {
  const read = { scope: "dial:read", readOnly: true, outputSchema: objectOutput, classes: ["standard"] as ["standard"], classify: () => standard() };
  const requireScope = async (scope: string) => { if (scope !== "host") await eventRecord(services, scope); };
  return [
    nativeTool({
      ...read, name: "dial.availability.get_hours", title: "Read Your hours", description: "Read native host hours, holidays, time off, named schedules, limits and each event's hours choice.",
      input: z.object({}).strict(), clauses: ["AVAIL-001", "AVAIL-010", "AVAIL-011"],
      run: async () => ({ result: await services.yourHours.read() }),
    }),
    eventWrite(services, {
      name: "dial.availability.choose_event_hours", title: "Choose an event's hours", description: "Use Your hours, a native named schedule, or the event's own hours, optionally starting from Your hours or another event. Native missing-source refusals are preserved.",
      input: eventIdInput.extend({ hours: hoursChoice }).strict(), clauses: ["AVAIL-001", "AVAIL-011"],
      items: async args => {
        if (args.hours.uses === "yours") return ["Use Your hours for this event"];
        if (args.hours.uses !== "own") {
          const schedule = required(await services.namedSchedules.get(args.hours.uses));
          return [`Use named schedule ${schedule.name} (${schedule.id})`];
        }
        const source = "startFrom" in args.hours ? args.hours.startFrom : undefined;
        return [!source ? "Use this event's own existing windows" : source === "yours" ? "Use own hours copied from Your hours" : `Use own hours copied from ${(await eventRecord(services, source)).title} (${source})`];
      },
      run: async args => {
        const result = await services.yourHours.choose(args.id, args.hours);
        if (result !== "saved") throw new ToolRefusal(result);
        return { result: await eventRecord(services, args.id) };
      },
    }),
    nativeTool({
      ...read, name: "dial.availability.get_limits", title: "Read booking limits", description: "Read native booking counts, meeting-minute caps and invitee gap for the host or one existing event.",
      input: scopeInput, clauses: ["AVAIL-010"],
      run: async args => { await requireScope(args.scope); return { result: await services.bookingLimits.get(args.scope) }; },
    }),
    nativeTool({
      name: "dial.availability.save_limits", title: "Save booking limits", description: "Replace native host or event booking limits; existing event scope is verified before writing.",
      scope: "dial:write", readOnly: false, input: scopeInput.extend({ limits: bookingLimitsSchema }).strict(), outputSchema: objectOutput,
      classes: ["standard", "live", "external"], clauses: ["AVAIL-010"],
      classify: async args => eventChangeClasses(args.scope === "host" ? await services.eventTypes.listEventTypes() : [await eventRecord(services, args.scope)]),
      revisionType: "string", revision: async (args, ctx) => {
        await requireScope(args.scope);
        return (await ctx.db.prepare("SELECT updated_at AS updatedAt FROM booking_limit_policies WHERE scope=?").bind(args.scope).first<{ updatedAt: string }>())?.updatedAt ?? null;
      },
      summary: async args => {
        const target = args.scope === "host" ? { name: "Host-wide booking limits" } : await eventRecord(services, args.scope).then(event => ({ id: event.id, name: event.title }));
        return { target, items: [`Replace ${args.scope === "host" ? "host-wide" : "event"} booking limits`, `Limits: ${JSON.stringify(args.limits)}`] };
      },
      run: async args => { await requireScope(args.scope); return { result: await services.bookingLimits.save(args.scope, args.limits) }; },
    }),
    nativeTool({
      ...read, name: "dial.availability.diagnose", title: "Diagnose a proposed time", description: "Run native operator diagnostics with fresh calendar availability. The optional override affects only notice and horizon in this diagnosis; it never creates a booking or bypasses conflict checks.",
      input: eventIdInput.extend({
        startAt: z.string().datetime().refine(hasSupportedInstantPrecision, "Use an instant with at most millisecond precision."),
        durationMinutes: z.number().int().min(5).max(480).optional(),
        overrideNoticeAndHorizon: z.boolean().default(false),
      }).strict(), clauses: ["AVAIL-009", "AVAIL-004", "EVENT-011"],
      run: async (args, ctx) => {
        const result = await services.availability.diagnoseOperatorTime(args.id, args.startAt, { overrideNoticeAndHorizon: args.overrideNoticeAndHorizon }, new Date(ctx.now()), args.durationMinutes);
        if (result.kind !== "evaluated") throw new ToolRefusal(result.kind);
        return { result: result.diagnosis };
      },
    }),
    ...availabilityScheduleTools(services),
  ];
}
