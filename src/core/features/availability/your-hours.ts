import { createId, nowIso } from "../../shared/ids";
import { nextEventTimestampSql } from "../../shared/event-revision";
import { bookingLimitsSchema, emptyBookingLimits, type BookingLimitsConfig } from "./booking-limits";
import { bindEvent, replaceEventWindows, scheduleWindowsSql } from "./named-schedules";
import type { AvailabilityWindow } from "./engine";
import type { ScheduleInput } from "./schedule-input";

/** The hours an install starts with: Monday to Friday, 09:00 to 17:00 wall clock in the host's zone. */
export const startingHours: AvailabilityWindow[] = [1, 2, 3, 4, 5].map(weekday => ({ weekday, startMinute: 540, endMinute: 1020 }));

/** `yours`, another schedule's id, or the event's own hours (optionally started from yours or another event's). */
export type HoursChoice = { uses: string; startFrom?: string };
export type HoursRead = {
  yours: ({ id: string; windows: AvailabilityWindow[] } & Pick<ScheduleInput, "blockUsHolidays" | "reopenedHolidays" | "timeOff">) | null;
  others: { id: string; name: string; windows: AvailabilityWindow[]; eventIds: string[] }[];
  limits: BookingLimitsConfig;
  events: { id: string; title: string; uses: string }[];
};
type ScheduleRow = { id: string; name: string; windows_json: string; block_us_holidays: number; reopened_holidays_json: string; time_off_json: string; is_default: number };

/** Make "Your hours" when the install has none yet, and return its id. */
export async function yoursId(binding: D1Database) {
  const now = nowIso();
  await binding.prepare("INSERT INTO availability_schedules (id,name,windows_json,block_us_holidays,reopened_holidays_json,time_off_json,is_default,created_at,updated_at) SELECT ?,'Your hours',?,0,'[]','[]',1,?,? WHERE NOT EXISTS (SELECT 1 FROM availability_schedules WHERE is_default=1)")
    .bind(createId(), JSON.stringify(startingHours), now, now).run();
  return (await binding.prepare("SELECT id FROM availability_schedules WHERE is_default=1").first<{ id: string }>())!.id;
}

export class YourHours {
  constructor(private readonly binding: D1Database) {}

  /** One read for Settings › Hours, an event's choice of hours and the event list's lines. */
  async read(): Promise<HoursRead> {
    const [schedules, bindings, events, limits] = await this.binding.batch([
      this.binding.prepare("SELECT id,name,windows_json,block_us_holidays,reopened_holidays_json,time_off_json,is_default FROM availability_schedules ORDER BY name,id"),
      this.binding.prepare("SELECT b.event_type_id AS eventId,b.schedule_id AS scheduleId FROM event_schedule_bindings b JOIN event_types e ON e.id=b.event_type_id ORDER BY e.created_at,e.id"),
      this.binding.prepare("SELECT id,title FROM event_types ORDER BY created_at,id"),
      this.binding.prepare("SELECT limits_json AS limitsJson FROM booking_limit_policies WHERE scope='host'"),
    ]);
    const rows = schedules.results as ScheduleRow[], bound = bindings.results as { eventId: string; scheduleId: string }[];
    const yours = rows.find(row => row.is_default === 1), limit = (limits.results as { limitsJson: string }[])[0];
    return {
      yours: yours ? { id: yours.id, windows: JSON.parse(yours.windows_json), blockUsHolidays: Boolean(yours.block_us_holidays), reopenedHolidays: JSON.parse(yours.reopened_holidays_json), timeOff: JSON.parse(yours.time_off_json) } : null,
      others: rows.filter(row => row !== yours).map(row => ({ id: row.id, name: row.name, windows: JSON.parse(row.windows_json), eventIds: bound.filter(item => item.scheduleId === row.id).map(item => item.eventId) })),
      limits: limit ? bookingLimitsSchema.parse(JSON.parse(limit.limitsJson)) : { ...emptyBookingLimits },
      events: (events.results as { id: string; title: string }[]).map(event => {
        const scheduleId = bound.find(item => item.eventId === event.id)?.scheduleId;
        return { id: event.id, title: event.title, uses: !scheduleId ? "own" : scheduleId === yours?.id ? "yours" : scheduleId };
      }),
    };
  }

  /** Which hours one event uses, changed in one atomic batch. Own hours keep the event's windows unless started from yours or another event's. */
  async choose(eventId: string, choice: HoursChoice): Promise<"saved" | "event_not_found" | "schedule_not_found" | "start_not_found"> {
    if (!await this.exists("event_types", eventId)) return "event_not_found";
    const now = nowIso();
    const touch = this.binding.prepare(`UPDATE event_types SET updated_at=${nextEventTimestampSql} WHERE id=?`).bind(now, eventId);
    if (choice.uses !== "own") {
      const scheduleId = choice.uses === "yours" ? await yoursId(this.binding) : choice.uses;
      if (!await this.exists("availability_schedules", scheduleId)) return "schedule_not_found";
      await this.binding.batch([touch, ...bindEvent(this.binding, eventId, scheduleId, now)]);
      return "saved";
    }
    const own = [touch, this.binding.prepare("DELETE FROM event_schedule_bindings WHERE event_type_id=?").bind(eventId)];
    if (!choice.startFrom || choice.startFrom === eventId) await this.binding.batch(own);
    else if (choice.startFrom === "yours") await this.binding.batch([...own, ...replaceEventWindows(this.binding, eventId, scheduleWindowsSql, [await yoursId(this.binding)], now)]);
    else if (!await this.exists("event_types", choice.startFrom)) return "start_not_found";
    else await this.binding.batch([...own, ...replaceEventWindows(this.binding, eventId, "SELECT weekday,start_minute,end_minute FROM recurring_availability_windows WHERE event_type_id=?", [choice.startFrom], now)]);
    return "saved";
  }

  private async exists(table: "event_types" | "availability_schedules", id: string) {
    return Boolean(await this.binding.prepare(`SELECT 1 FROM ${table} WHERE id=?`).bind(id).first());
  }
}
