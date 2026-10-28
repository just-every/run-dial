import { z } from "zod";
import { routingFormInput,questionKinds } from "../../src/core/features/routing/validation.mjs";
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const routingAnswerSchema = z.array(z.object({
  key: identifier, label: z.string().min(1).max(500), kind: z.enum(questionKinds),
  value: z.union([z.string().max(4000), z.array(z.string().max(4000)).max(100)]), private: z.boolean().optional(),
}).strict()).max(50).refine(answers => new Set(answers.map(answer => answer.key)).size === answers.length);
// Event targets are soft references: a removed event leaves its form visible for repair.
// Public submission still resolves a published event and refuses a missing target.
export function validateRouting(name, row) {
  if (name === 'routing_forms') {
    const parsed = routingFormInput.safeParse(JSON.parse(row.configuration_json));
    if (!parsed.success || parsed.data.title !== row.title || parsed.data.slug !== row.slug || Number(parsed.data.published) !== row.published || !Number.isInteger(row.revision) || row.revision < 1) throw new Error('archive-invalid-routing-form');
  }
  if (name === 'routing_submissions') {
    if (row.capability_id !== null || !routingAnswerSchema.safeParse(JSON.parse(row.answers_json)).success) throw new Error('archive-invalid-routing-submission');
    const attribution = JSON.parse(row.attribution_json);
    if (!attribution || typeof attribution !== 'object' || Array.isArray(attribution) || Object.entries(attribution).some(([key, value]) => !['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source'].includes(key) || typeof value !== 'string' || value.length > 500)) throw new Error('archive-invalid-routing-attribution');
  }
}
