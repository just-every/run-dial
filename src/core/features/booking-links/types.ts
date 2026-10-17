import { z } from "zod";
import { hostDateSchema, timeWindowSchema, validateNonOverlappingWindows } from "../../shared/scheduling";
import type { EventTypeRecord } from "../event-types";

const dateOverride = z.object({ hostDate: hostDateSchema, windows: z.array(timeWindowSchema).min(1).max(20) }).superRefine((value, context) => validateNonOverlappingWindows(value.windows, context, ["windows"]));
export const oneOffOverridesSchema = z.object({
  durationMinutes: z.number().int().min(5).max(480),
  locationType: z.enum(["google_meet", "fixed_link", "phone", "in_person"]),
  locationLabel: z.string().trim().min(1).max(180),
  locationValue: z.string().trim().max(1000),
  dates: z.array(dateOverride).min(1).max(60),
}).superRefine((value, context) => {
  if (value.locationType !== "google_meet" && !value.locationValue) context.addIssue({ code: "custom", path: ["locationValue"], message: "Enter the meeting location." });
  if (value.locationType === "fixed_link") {
    try { if (new URL(value.locationValue).protocol !== "https:") throw new Error(); }
    catch { context.addIssue({ code: "custom", path: ["locationValue"], message: "Enter an HTTPS meeting URL." }); }
  }
  if (new Set(value.dates.map(date => date.hostDate)).size !== value.dates.length) context.addIssue({ code: "custom", path: ["dates"], message: "Each date may appear once." });
});
export const createBookingLinkSchema = z.object({
  eventTypeId: z.string().regex(/^[0-9A-Z]{26}$/),
  kind: z.enum(["single_use", "one_off"]),
  expiresAt: z.string().datetime({ offset: true }),
  overrides: oneOffOverridesSchema.optional(),
}).superRefine((value, context) => {
  if ((value.kind === "one_off") !== Boolean(value.overrides)) context.addIssue({ code: "custom", path: ["overrides"], message: "Only one-off meetings require their own meeting details." });
});
export type BookingLinkInput = z.infer<typeof createBookingLinkSchema>;
export type BookingLinkRecord = {
  id: string; eventTypeId: string; kind: BookingLinkInput["kind"]; overridesJson: string | null;
  expiresAt: string; consumedAt: string | null; consumedBookingId: string | null; revokedAt: string | null;
  createdAt: string; updatedAt: string; tokenHash: string | null;
};
export type LinkEvent = EventTypeRecord & { bookingLink?: { id: string; kind:BookingLinkInput["kind"]; expiresAt: string; dates?: z.infer<typeof oneOffOverridesSchema>["dates"] } };
