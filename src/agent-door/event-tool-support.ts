import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { AppServices } from "../core/app/services";
import type { EventTypeRecord } from "../core/features/event-types/repository";
import { external, live, nativeTool, objectOutput, required, standard, type ClassAndFacts, type ToolContext } from "./native-tool";

export const eventIdInput = z.object({ id: z.string().length(26) }).strict();
export const eventRecord = async (services: AppServices, id: string) => required(await services.eventTypes.getEventType(id));

export function eventChangeClasses(events: EventTypeRecord[], destructive = false): ClassAndFacts[] {
  const published = events.filter(event => event.status === "published");
  const changes = published.length ? [live("Dial booking pages"), external(published.length, "public")] : destructive ? [] : standard();
  return destructive ? [...changes, { class: "destructive", facts: { measure: events.length } }] : changes;
}

type EventWrite<T extends z.ZodType<{ id: string }>> = {
  input: T;
  name: string;
  title: string;
  description: string;
  clauses: string[];
  run(args: z.output<T>, ctx: ToolContext): ReturnType<ToolDefinition["run"]>;
  items(args: z.output<T>, event: EventTypeRecord): string[] | Promise<string[]>;
  affected?(args: z.output<T>, ctx: ToolContext): Promise<EventTypeRecord[]>;
  publicWrite?: boolean;
  destructive?: boolean;
};

/** All event mutations name their current native target and use its persisted revision. */
export function eventWrite<T extends z.ZodType<{ id: string }>>(services: AppServices, definition: EventWrite<T>): ToolDefinition {
  const { items, affected, publicWrite, destructive, ...tool } = definition;
  return nativeTool({
    ...tool, scope: "dial:write", readOnly: false, outputSchema: objectOutput,
    classes: publicWrite ? ["live", "external"] : destructive ? ["live", "external", "destructive"] : ["standard", "live", "external"],
    target: async args => { await required(await services.eventTypes.getEventType(String(args.id))); return {kind: "event", id: String(args.id)}; },
    revisionType: "string",
    revision: async args => (await eventRecord(services, args.id)).updatedAt,
    classify: async (args, ctx) => {
      const targets = affected ? await affected(args, ctx) : [await eventRecord(services, args.id)];
      return publicWrite ? [live("Dial booking pages"), external(1, "public")] : eventChangeClasses(targets, destructive);
    },
    summary: async args => {
      const event = await eventRecord(services, args.id);
      return { target: { id: event.id, name: event.title }, items: await items(args, event) };
    },
  });
}

export async function validateEventQuestions(services: AppServices, id: string, questions: EventTypeRecord["questions"]) {
  const config = await services.correspondence.read(id);
  if (config && !services.correspondence.validateQuestions(config, questions).success) {
    throw new ToolRefusal("template_question_in_use", "Edit invitation and email templates before removing a referenced question or making its calendar answer private.");
  }
}

/** Editing weekly hours through an event also edits every event bound to its schedule. */
export async function recurringTargets(services: AppServices, id: string) {
  const event = await eventRecord(services, id);
  const schedule = await services.namedSchedules.forEvent(id);
  if (!schedule) return [event];
  const hours = await services.yourHours.read();
  const uses = schedule.isDefault ? "yours" : schedule.id;
  const ids = new Set(hours.events.filter(item => item.uses === uses).map(item => item.id));
  return (await services.eventTypes.listEventTypes()).filter(item => ids.has(item.id));
}
