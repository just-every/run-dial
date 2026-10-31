import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { definitionSchema,entitySchema } from "../ext/custom-fields/model";
import { stateDigest } from "./booking-native-state";
import { arrayOutput,nativeTool,objectOutput,required,standard } from "./native-tool";

const id = z.string().min(1).max(80);
const entryTarget = z.object({ entity: z.enum(["booking", "availabilityRequest"]), id }).strict();

export function customTools(services: AppServices): ToolDefinition[] {
  const fields = services.customFields;
  const field = async (fieldId: string) => required((await fields.definitions()).find(item => item.id === fieldId));
  return [
    nativeTool({
      name: "dial.custom_fields.list", title: "List custom field definitions", description: "Read private native field definitions for event types, bookings and availability requests.",
      scope: "dial:read", readOnly: true, input: z.object({ entity: entitySchema.optional() }).strict(), outputSchema: arrayOutput, classes: ["standard"], clauses: ["CUSTOM-001", "CUSTOM-002"], untrusted: true,
      classify: () => standard(0), run: async args => ({ result: await fields.definitions(args.entity) }),
    }),
    nativeTool({
      name: "dial.custom_fields.create", title: "Create custom field definition", description: "Create a native private field definition, up to 20 per entity type. Supports text, long text, single choice and checkbox with native validation.",
      scope: "dial:write", readOnly: false, input: definitionSchema, outputSchema: objectOutput, classes: ["standard"], clauses: ["CUSTOM-001", "CUSTOM-002"],
      classify: () => standard(), summary: args => ({ items: [`Create ${args.kind} definition for ${args.entity}`, args.label, ...args.options] }),
      async run(args, ctx) {
        const created = await fields.create(args);
        if (!created) throw new ToolRefusal("field_limit");
        ctx.emit("dial.custom_field.created", `dial://custom-fields/${created.id}`, { actorLabel: ctx.actor.label });
        return { result: created };
      },
    }),
    nativeTool({
      name: "dial.custom_fields.remove", title: "Delete custom field definition", description: "Delete a private field definition and all its saved values across its native entity type.",
      scope: "dial:write", readOnly: false, input: z.object({ fieldId: id }).strict(), outputSchema: objectOutput, classes: ["destructive"], clauses: ["CUSTOM-001", "CUSTOM-002"],
      classify: async (args, ctx) => {
        await field(args.fieldId);
        const count = await ctx.db.prepare("SELECT count(*) AS n FROM ext_custom_field_values WHERE definition_id=?").bind(args.fieldId).first<{ n: number }>();
        return [{ class: "destructive", facts: { measure: 1 + (count?.n ?? 0) } }];
      },
      revisionType: "string", revision: async (args, ctx) => {
        const definition = await field(args.fieldId);
        const values = await ctx.db.prepare("SELECT id,value_json,updated_at FROM ext_custom_field_values WHERE definition_id=? ORDER BY id").bind(args.fieldId).all();
        return stateDigest([definition, values.results]);
      },
      summary: async args => { const definition = await field(args.fieldId); return { target: { id: definition.id, name: definition.label }, items: [`Delete ${definition.entity} field definition and every saved value`] }; },
      async run(args, ctx) {
        if (!await fields.remove(args.fieldId)) throw new ToolRefusal("field_not_found");
        ctx.emit("dial.custom_field.removed", `dial://custom-fields/${args.fieldId}`, { actorLabel: ctx.actor.label });
        return { result: { removed: true } };
      },
    }),
    nativeTool({
      name: "dial.custom_fields.read", title: "Read record annotations", description: "Read private typed annotations on an existing booking or availability request. Never adds annotations to public responses or outgoing mail.",
      scope: "dial:read", readOnly: true, input: entryTarget, outputSchema: arrayOutput, classes: ["sensitive"], clauses: ["CUSTOM-001", "CUSTOM-002"], untrusted: true,
      classify: async args => [{ class: "sensitive", facts: { measure: required(await fields.entries(args.entity, args.id)).length, kind: "private record annotations" } }],
      run: async args => ({ result: required(await fields.entries(args.entity, args.id)) }),
    }),
    nativeTool({
      name: "dial.custom_fields.set", title: "Set record annotation", description: "Set or clear one native booking or request annotation with field/entity, type, choice and size validation. Null clears the saved value; false remains a saved checkbox value.",
      scope: "dial:write", readOnly: false, input: entryTarget.extend({ fieldId: id, value: z.union([z.string().max(5000), z.boolean(), z.null()]) }).strict(), outputSchema: objectOutput, classes: ["standard", "destructive"], clauses: ["CUSTOM-001", "CUSTOM-002"],
      classify: async args => {
        const current = required(required(await fields.entries(args.entity, args.id)).find(item => item.id === args.fieldId));
        return args.value === null && current.value !== null ? [{ class: "destructive", facts: { measure: 1 } }] : standard();
      },
      revisionType: "string", revision: async args => stateDigest(required(required(await fields.entries(args.entity, args.id)).find(item => item.id === args.fieldId))),
      summary: async args => {
        const current = required(required(await fields.entries(args.entity, args.id)).find(item => item.id === args.fieldId));
        return { target: { id: args.id }, items: [`${args.entity}: ${current.label}`, args.value === null ? "Clear the saved value" : `Set value: ${String(args.value)}`] };
      },
      async run(args, ctx) {
        const outcome = await fields.set(args.entity, args.id, args.fieldId, args.value);
        if (outcome !== "saved") throw new ToolRefusal(outcome === "missing" ? "field_not_found" : "invalid_field_value");
        ctx.emit("dial.custom_field.value_saved", `dial://custom-fields/${args.fieldId}`, { entity: args.entity, id: args.id, actorLabel: ctx.actor.label });
        return { result: { saved: true } };
      },
    }),
  ];
}
