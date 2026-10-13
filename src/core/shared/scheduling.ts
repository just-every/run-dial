import { z } from "zod";

const supportedTimeZones = new Set(Intl.supportedValuesOf("timeZone"));
supportedTimeZones.add("UTC");

export const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => supportedTimeZones.has(value), "Use a canonical IANA timezone such as Australia/Brisbane.");

export const hostDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, "Use a real calendar date in YYYY-MM-DD format.");

export const timeWindowSchema = z
  .object({
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((window) => window.startMinute < window.endMinute, "A window must end after it starts.");

type TimeWindow = z.infer<typeof timeWindowSchema>;

export const dateAvailabilityOverrideInputSchema = z
  .discriminatedUnion("mode", [
    z.object({ hostDate: hostDateSchema, mode: z.literal("closed"), windows: z.array(timeWindowSchema).length(0) }),
    z.object({ hostDate: hostDateSchema, mode: z.literal("open"), windows: z.array(timeWindowSchema).min(1).max(1000) }),
  ])
  .superRefine((override, context) => validateNonOverlappingWindows(override.windows, context, ["windows"]));

export function validateNonOverlappingWindows(windows: TimeWindow[], context: z.RefinementCtx, path: PropertyKey[] = []) {
  const ordered = [...windows].sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].endMinute > ordered[index].startMinute) {
      context.addIssue({ code: "custom", path, message: "Availability windows cannot overlap." });
      return;
    }
  }
}

export function hostDateToday(timezone: string, now = new Date()) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function isCanonicalIanaTimeZone(value: string) {
  return supportedTimeZones.has(value);
}

function isCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}
