import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { external,live,nativeTool,objectOutput,required,standard,type ToolContext } from "./native-tool";

type NativeConnection = {
  id: string;
  provider: string;
  status: string;
  operatorId: string | null;
  updatedAt: string;
};

// The native connection's primary key is its singleton key. Tokens never enter this projection.
const connection = (ctx: ToolContext, id = "default") => ctx.db.prepare(
  "SELECT singleton_key AS id,provider,status,authorised_by_operator_id AS operatorId,updated_at AS updatedAt FROM calendar_connections WHERE singleton_key=?",
).bind(id).first<NativeConnection>();
const targetInput = z.object({ id: z.string().min(1).max(128) }).strict();
const emptyInput = z.object({}).strict();

async function revocableConnection(ctx: ToolContext, id: string) {
  const record = required(await connection(ctx, id));
  if (!record.operatorId && record.status !== "disconnected") throw new ToolRefusal("calendar_authority_missing", "The native calendar connection has no authorising operator.");
  return record;
}

export function calendarTools(services: AppServices): ToolDefinition[] {
  const read = { scope: "dial:read", readOnly: true, outputSchema: objectOutput, classes: ["standard"] as ["standard"], classify: () => standard() };
  return [
    nativeTool({
      ...read, name: "dial.calendar.setup", title: "Read calendar setup", description: "Read native calendar configuration readiness and the registered callback URI. OAuth connection remains a human connector flow.",
      input: emptyInput, clauses: ["CAL-001"], run: async () => ({ result: services.calendar.setupGuide() }),
    }),
    nativeTool({
      ...read, name: "dial.calendar.health", title: "Read calendar health", description: "Read native calendar connection health, selected calendars and durable recent health transitions without exposing provider credentials.",
      input: emptyInput, clauses: ["CAL-001", "CAL-006"],
      run: async (_args, ctx) => {
        const [health, recentChanges, record] = await Promise.all([services.calendar.connectionHealth(), services.calendar.recentHealthChanges(), connection(ctx)]);
        return { result: { ...health, id: record?.id ?? null, recentChanges } };
      },
    }),
    nativeTool({
      ...read, name: "dial.calendar.list", title: "List provider calendars", description: "List calendars through the native connected provider, preserving its unavailable response and native credential handling.",
      input: emptyInput, clauses: ["CAL-001", "CAL-002", "CAL-010"],
      run: async () => {
        const result = await services.calendar.listCalendars();
        if (result.kind !== "ok") throw new ToolRefusal("calendar_unavailable", "Calendar data cannot be read right now.", { reason: result.code });
        return { result: { calendars: result.calendars } };
      },
    }),
    nativeTool({
      name: "dial.calendar.select", title: "Select booking and conflict calendars", description: "Select one native writable booking destination and one to ten readable conflict calendars. The native provider validates every calendar.",
      scope: "dial:write", readOnly: false,
      input: z.object({ destinationCalendarId: z.string().min(1).max(1024), conflictCalendarIds: z.array(z.string().min(1).max(1024)).min(1).max(10) }).strict(), outputSchema: objectOutput,
      classes: ["live", "external"], clauses: ["CAL-001", "CAL-006", "CAL-010"],
      classify: async (_args, ctx) => {
        required(await connection(ctx));
        return [live("Dial calendar selection"), external(1, "known")];
      },
      revisionType: "string", revision: async (_args, ctx) => required(await connection(ctx)).updatedAt,
      summary: async (args, ctx) => {
        const record = required(await connection(ctx));
        const health = await services.calendar.connectionHealth();
        return { target: { id: record.id, name: `${record.provider} calendar connection` }, items: [
          `Booking destination: ${health.destinationCalendarId ?? "unselected"} → ${args.destinationCalendarId}`,
          `Conflict calendars: ${[...new Set(args.conflictCalendarIds)].join(", ")}`,
          "Apply this selection to future native availability and calendar delivery",
        ] };
      },
      run: async args => {
        const result = await services.calendar.selectCalendars(args);
        if (result.kind !== "saved") throw new ToolRefusal(result.kind === "invalid_selection" ? "invalid_calendar_selection" : "calendar_unavailable");
        return { result: result.health };
      },
    }),
    nativeTool({
      ...read, name: "dial.calendar.grants", title: "Read native calendar grant", description: "Witness whether the targeted native connection still holds its provider grant. A disconnected connection has an empty grant set.",
      input: targetInput, clauses: ["CAL-001"],
      outputSchema: { type: "object", properties: { id: { type: "string" }, grants: { type: "array", items: { type: "string" }, uniqueItems: true } }, required: ["id", "grants"], additionalProperties: false },
      run: async (args, ctx) => {
        const record = required(await connection(ctx, args.id));
        return { result: { id: record.id, grants: record.status !== "disconnected" && record.operatorId ? [record.id] : [] } };
      },
    }),
    nativeTool({
      name: "dial.calendar.disconnect", title: "Disconnect calendar", description: "Revoke the targeted native connection, clear its local credentials, calendar selections and busy cache, and stop native calendar synchronization. Existing bookings retain their obligations and history.",
      scope: "dial:write", readOnly: false, input: targetInput, outputSchema: objectOutput,
      classes: ["access", "live", "destructive"], clauses: ["CAL-001", "CAL-006", "AVAIL-004"],
      widens: false, narrowing: { effect: "revoke", target: "id" },
      authority: async (args, ctx) => ({ subject: (await revocableConnection(ctx, args.id)).operatorId ?? ctx.person.id, widens: false }),
      classify: async (args, ctx) => {
        await revocableConnection(ctx, args.id);
        return [{ class: "access", facts: { measure: 1, direction: "narrows" } }, live("Dial calendar connection"), { class: "destructive", facts: { measure: 1 } }];
      },
      revisionType: "string", revision: async (args, ctx) => (await revocableConnection(ctx, args.id)).updatedAt,
      summary: async (args, ctx) => {
        const record = await revocableConnection(ctx, args.id);
        return { target: { id: record.id, name: `${record.provider} calendar connection` }, items: ["Revoke the native calendar connection", "Remove stored credentials, selections and cached busy intervals", "Stop calendar sync; preserve existing bookings and their history"] };
      },
      run: async (args, ctx) => {
        await revocableConnection(ctx, args.id);
        await services.calendar.disconnect();
        return { result: { id: args.id, disconnected: true } };
      },
    }),
  ];
}
