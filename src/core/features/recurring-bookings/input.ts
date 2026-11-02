import { z } from "zod";
import { hasSupportedInstantPrecision } from "../../shared/instants";
import { ianaTimeZoneSchema } from "../../shared/scheduling";

export const recurringEventSchema = z.object({
  handle: z.string().regex(/^[a-z0-9-]+$/).max(80),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(80),
});

/** A weekly proposal preserves the invitee's local hour across offset changes. */
export const recurringPreviewSchema = z.object({
  startAt: z.string().max(40).datetime({ offset: true }).refine(value => {
    const instant = new Date(value);
    return Number.isFinite(instant.getTime()) && instant.getUTCSeconds() === 0
      && instant.getUTCMilliseconds() === 0 && hasSupportedInstantPrecision(value);
  }),
  inviteeTimezone: ianaTimeZoneSchema,
  count: z.coerce.number().int().min(2).max(24),
}).strict();

export type RecurringPreviewInput = z.infer<typeof recurringPreviewSchema>;
