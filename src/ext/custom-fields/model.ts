import { z } from "zod";
export const entitySchema = z.enum(["eventType", "booking", "availabilityRequest"]);
export const definitionSchema = z.object({
  entity: entitySchema, label: z.string().trim().min(1).max(120),
  kind: z.enum(["text", "long_text", "single_choice", "checkbox"]),
  options: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
}).strict().superRefine((field, context) => {
  if (field.kind === "single_choice" ? field.options.length < 1 || new Set(field.options).size !== field.options.length : field.options.length !== 0)
    context.addIssue({ code: "custom", path: ["options"], message: "Only single choice fields have unique, nonempty options." });
});
export type FieldDefinition = z.infer<typeof definitionSchema> & { id: string; createdAt: string; updatedAt: string };
export type FieldValue = string | boolean | null;
export type FieldEntry = FieldDefinition & { value: FieldValue };
export const maximumFieldsPerEntity = 20;
export function validValue(field: FieldDefinition, value: FieldValue) {
  if (value === null) return true;
  if (field.kind === "checkbox") return typeof value === "boolean";
  return typeof value === "string" && (field.kind === "single_choice" ? field.options.includes(value) : value.length <= (field.kind === "text" ? 500 : 5000));
}
