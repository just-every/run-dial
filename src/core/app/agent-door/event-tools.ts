import { z } from "zod";
import { ToolRefusal } from "../../../base/modules/agent-door/index.ts";
import {
  eventTypeCreationSchema,
  eventTypeInputSchema,
  recurringAvailabilitySchema,
} from "../../features/event-types/event-input";
import { schema, idInput, pageInput } from "./schemas";
import { authorize } from "./native";
import {
  standard,
  live,
  destructive,
  resource,
  type NativeToolContext,
} from "./tool-context";
export function eventTools({
  add,
  env,
  services,
  forEffect,
  event,
}: NativeToolContext) {
  add("event", "list", {
    scope: "dial:read",
    readOnly: true,
    inputSchema: schema(pageInput),
    classes: ["standard"],
    clauses: ["EVENT-001"],
    classify: async (_args, ctx) => {
      await authorize(ctx);
      return standard;
    },
    run: async (args, ctx) => {
      await authorize(ctx);
      return {
        result: {
          records: (await services.eventTypes.listEventTypes()).slice(
            0,
            pageInput.parse(args).limit,
          ),
        },
      };
    },
  });
  add("event", "read", {
    scope: "dial:read",
    readOnly: true,
    inputSchema: schema(idInput),
    classes: ["standard"],
    clauses: ["EVENT-001"],
    classify: async (args, ctx) => {
      await event(args, ctx);
      return standard;
    },
    target: async (args, ctx) => ({
      kind: "event",
      id: (await event(args, ctx)).id,
    }),
    run: async (args, ctx) => ({ result: { record: await event(args, ctx) } }),
  });
  add("event", "create", {
    scope: "dial:configure",
    readOnly: false,
    inputSchema: schema(eventTypeCreationSchema),
    classes: ["standard"],
    clauses: ["EVENT-001"],
    classify: async (args, ctx) => {
      await authorize(ctx);
      eventTypeCreationSchema.parse(args);
      return standard;
    },
    summary: (args) => ({
      target: { name: eventTypeCreationSchema.parse(args).title },
      items: ["Draft event type"],
    }),
    run: async (args, ctx) => {
      await authorize(ctx);
      const value = await forEffect(
        ctx,
        "dial.event.create",
        null,
      ).eventTypes.createEventType(eventTypeCreationSchema.parse(args));
      return {
        result: { record: value },
        resources: resource("event-types", value),
      };
    },
  });
  const eventInput = z.object({
    id: idInput.shape.id,
    input: eventTypeInputSchema,
  });
  add("event", "update", {
    scope: "dial:configure",
    readOnly: false,
    inputSchema: schema(eventInput),
    classes: ["standard", "live"],
    clauses: ["EVENT-001", "EVENT-002"],
    classify: async (args, ctx) => {
      eventInput.parse(args);
      return (await event(args, ctx)).status === "published" ? live : standard;
    },
    revisionType: "string",
    revision: async (args, ctx) => (await event(args, ctx)).updatedAt,
    target: async (args, ctx) => ({
      kind: "event",
      id: (await event(args, ctx)).id,
    }),
    summary: (args) => ({
      target: { id: String(args.id), name: eventInput.parse(args).input.title },
      items: ["Event configuration"],
    }),
    run: async (args, ctx) => {
      const previous = await event(args, ctx),
        input = eventInput.parse(args).input;
      const correspondence = await services.correspondence.read(previous.id);
      if (
        correspondence &&
        !services.correspondence.validateQuestions(
          correspondence,
          input.questions,
        ).success
      )
        throw new ToolRefusal("template_question_in_use");
      const value = await forEffect(
        ctx,
        "dial.event.update",
        { kind: "event", id: previous.id },
        { table: "event_types", id: previous.id, value: previous.updatedAt },
      ).eventTypes.updateEventType(previous.id, input);
      if (!value) throw new ToolRefusal("resource_unavailable");
      return {
        result: { record: value },
        resources: resource("event-types", value),
      };
    },
  });
  const windows = z.object({
    id: idInput.shape.id,
    windows: recurringAvailabilitySchema,
  });
  add("event", "hours", {
    scope: "dial:configure",
    readOnly: false,
    inputSchema: schema(windows),
    classes: ["standard", "live"],
    clauses: ["AVAIL-001", "AVAIL-011"],
    classify: async (args, ctx) => {
      windows.parse(args);
      const current = await event(args, ctx);
      const shared = await env.DB.prepare(
        "SELECT 1 FROM event_schedule_bindings a JOIN event_schedule_bindings b ON a.schedule_id=b.schedule_id JOIN event_types e ON e.id=b.event_type_id WHERE a.event_type_id=? AND e.status='published' LIMIT 1",
      )
        .bind(current.id)
        .first();
      return current.status === "published" || shared ? live : standard;
    },
    revisionType: "string",
    revision: async (args, ctx) => (await event(args, ctx)).updatedAt,
    target: async (args, ctx) => ({
      kind: "event",
      id: (await event(args, ctx)).id,
    }),
    summary: async (args, ctx) => ({
      target: { id: (await event(args, ctx)).id },
      items: ["Recurring availability"],
    }),
    run: async (args, ctx) => {
      const previous = await event(args, ctx);
      const value = await forEffect(
        ctx,
        "dial.event.hours",
        { kind: "event", id: previous.id },
        { table: "event_types", id: previous.id, value: previous.updatedAt },
      ).eventTypes.replaceRecurringAvailability(
        previous.id,
        windows.parse(args).windows,
      );
      if (!value) throw new ToolRefusal("resource_unavailable");
      return {
        result: { record: value },
        resources: resource("event-types", value),
      };
    },
  });
  for (const verb of ["duplicate", "disable", "delete"] as const) {
    const name = `dial.event.${verb}`;
    add("event", verb, {
      scope: "dial:configure",
      readOnly: false,
      inputSchema: schema(idInput),
      classes:
        verb === "delete"
          ? ["destructive", "live"]
          : verb === "disable"
            ? ["standard", "live"]
            : ["standard"],
      clauses: ["EVENT-001"],
      classify: async (args, ctx, completed) => {
        await authorize(ctx);
        if (completed) return [...completed];
        const current = await event(args, ctx);
        return verb === "delete"
          ? current.status === "published"
            ? [...destructive, ...live]
            : destructive
          : verb === "disable" && current.status === "published"
            ? live
            : standard;
      },
      revisionType: "string",
      revision: async (args, ctx) => (await event(args, ctx)).updatedAt,
      target: async (args, ctx) => ({
        kind: "event",
        id: (await event(args, ctx)).id,
      }),
      summary: async (args, ctx) => {
        const current = await event(args, ctx);
        return {
          target: { id: current.id, name: current.title },
          items: [verb],
        };
      },
      run: async (args, ctx) => {
        const previous = await event(args, ctx),
          native = forEffect(
            ctx,
            name,
            { kind: "event", id: previous.id },
            {
              table: "event_types",
              id: previous.id,
              value: previous.updatedAt,
            },
          ).eventTypes;
        const value =
          verb === "duplicate"
            ? await native.duplicateEventType(previous.id)
            : verb === "disable"
              ? await native.disableEventType(previous.id)
              : await native.deleteEventType(previous.id);
        if (!value) throw new ToolRefusal("resource_unavailable");
        return typeof value === "object"
          ? {
              result: { record: value },
              resources: resource("event-types", value),
            }
          : {
              result: { deleted: previous.id },
              resources: [
                {
                  uri: `dial://activity/${ctx.operationId}`,
                  name: "Native deletion receipt",
                },
              ],
            };
      },
    });
  }
}
