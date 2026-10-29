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
export { profileInputSchema as profileInput } from "../../features/host-profile/input";
export const outputSchema = {
  type: "object" as const,
  properties: { record: {}, records: { type: "array", items: {} } },
  additionalProperties: true,
};
