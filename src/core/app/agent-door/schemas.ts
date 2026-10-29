import { z } from "zod";
import type { JsonSchemaObject } from "../../../base/modules/agent-door/index.ts";
export const schema = (value: z.ZodType) =>
  z.toJSONSchema(value, {
    unrepresentable: "any",
    io: "input",
  }) as JsonSchemaObject;
export const idInput = z.object({ id: z.string().length(26) });
export const pageInput = z.object({
  limit: z.number().int().min(1).max(100).default(100),
});
export const profileInput = z.object({
  handle: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80),
  name: z.string().min(1).max(120),
  title: z.string().min(1).max(180),
  biography: z.string().min(1).max(2000),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }),
  focusAreas: z.array(z.object({ label: z.string().min(1).max(40) })).max(6),
  socialProof: z
    .array(
      z.object({
        quote: z.string().min(1).max(280),
        attribution: z.string().min(1).max(120),
      }),
    )
    .max(3),
});
export const outputSchema = {
  type: "object" as const,
  properties: { record: {}, records: { type: "array", items: {} } },
  additionalProperties: true,
};
