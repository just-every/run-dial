import { z } from "zod";
import { ianaTimeZoneSchema } from "../../shared/scheduling";

export const profileInputSchema = z.object({
  handle: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80),
  name: z.string().min(1).max(120),
  title: z.string().min(1).max(180),
  biography: z.string().min(1).max(2000),
  timezone: ianaTimeZoneSchema,
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
