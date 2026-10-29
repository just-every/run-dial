import { z } from "zod";
import {
  ToolRefusal,
  type ToolContext,
} from "../../../base/modules/agent-door/index.ts";
import {
  scheduleInputSchema,
  closureFields,
} from "../../features/availability/schedule-input";
import { schema, idInput } from "./schemas";
import { authorize } from "./native";
import {
  standard,
  live,
  resource,
  type NativeToolContext,
} from "./tool-context";
export function scheduleTools({
  add,
  env,
  services,
  forEffect,
  schedule,
}: NativeToolContext) {
  add("schedule", "list", {
    scope: "dial:read",
    readOnly: true,
    inputSchema: schema(z.object({})),
    classes: ["standard"],
    clauses: ["AVAIL-011"],
    classify: async (_args, ctx) => {
      await authorize(ctx);
      return standard;
    },
    run: async (_args, ctx) => {
      await authorize(ctx);
      return { result: { records: await services.namedSchedules.list() } };
    },
  });
  add("schedule", "read", {
    scope: "dial:read",
    readOnly: true,
    inputSchema: schema(idInput),
    classes: ["standard"],
    clauses: ["AVAIL-011"],
    classify: async (args, ctx) => {
      await schedule(args, ctx);
      return standard;
    },
    run: async (args, ctx) => ({
      result: { record: await schedule(args, ctx) },
    }),
  });
  for (const verb of ["create", "update"] as const) {
    const input =
      verb === "create"
        ? z.object({ input: scheduleInputSchema })
        : z.object({ id: idInput.shape.id, input: scheduleInputSchema });
    add("schedule", verb, {
      scope: "dial:configure",
      readOnly: false,
      inputSchema: schema(input),
      classes: verb === "create" ? ["standard"] : ["standard", "live"],
      clauses: ["AVAIL-011"],
      classify: async (args, ctx) => {
        await authorize(ctx);
        const parsed = input.parse(args);
        const old = verb === "update" ? await schedule(args, ctx) : null;
        if ((!old || !old.isDefault) && closureFields(parsed.input).length)
          throw new ToolRefusal("invalid_request");
        const published =
          old &&
          (await env.DB.prepare(
            "SELECT 1 FROM event_types e JOIN event_schedule_bindings b ON b.event_type_id=e.id WHERE b.schedule_id=? AND e.status='published' LIMIT 1",
          )
            .bind(old.id)
            .first());
        const closuresChanged =
          old?.isDefault &&
          JSON.stringify([
            old.blockUsHolidays,
            old.reopenedHolidays,
            old.timeOff,
          ]) !==
            JSON.stringify([
              parsed.input.blockUsHolidays,
              parsed.input.reopenedHolidays,
              parsed.input.timeOff,
            ]);
        const global =
          closuresChanged &&
          (await env.DB.prepare(
            "SELECT 1 FROM event_types WHERE status='published' LIMIT 1",
          ).first());
        return published || global ? live : standard;
      },
      ...(verb === "update"
        ? {
            revisionType: "string" as const,
            revision: async (args: Record<string, unknown>, ctx: ToolContext) =>
              (await schedule(args, ctx)).updatedAt,
          }
        : {}),
      summary: (args) => ({
        target: { name: input.parse(args).input.name },
        items: ["Availability schedule"],
      }),
      run: async (args, ctx) => {
        await authorize(ctx);
        const old = verb === "update" ? await schedule(args, ctx) : null;
        const value = await forEffect(
          ctx,
          `dial.schedule.${verb}`,
          old ? { kind: "schedule", id: old.id } : null,
          old
            ? {
                table: "availability_schedules",
                id: old.id,
                value: old.updatedAt,
              }
            : undefined,
        ).namedSchedules.save(input.parse(args).input, old?.id);
        return {
          result: { record: value },
          resources: resource("schedules", value),
        };
      },
    });
  }
}
