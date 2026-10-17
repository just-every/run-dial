import { z } from "zod";
import { hostDateSchema, timeWindowSchema, validateNonOverlappingWindows } from "../../shared/scheduling";

export const scheduleWindowsSchema = z.array(timeWindowSchema.and(z.object({ weekday: z.number().int().min(0).max(6) }))).max(1000).superRefine((windows, context) => {
  for (let day = 0; day < 7; day++) validateNonOverlappingWindows(windows.filter(window => window.weekday === day), context, ["windows"]);
});
export const scheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  windows: scheduleWindowsSchema,
  blockUsHolidays: z.boolean(),
  reopenedHolidays: z.array(hostDateSchema).max(1000),
  timeOff: z.array(z.object({ startDate: hostDateSchema, endDate: hostDateSchema }).refine(range => range.endDate >= range.startDate, "Time off must end on or after its first date.")).max(100),
}).strict();
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type NamedSchedule = ScheduleInput & { id: string; createdAt: string; updatedAt: string; eventCount: number };
