import { createId, nowIso } from "../../shared/ids";
import { nextEventTimestampSql } from "../../shared/event-revision";
import { usFederalHolidays } from "./us-holidays";
import { datePlus } from "./timezone";
import type { NamedSchedule, ScheduleInput } from "./schedule-input";
import type { DateAvailabilityOverrideRecord } from "../event-types";

type Row = { id: string; name: string; windows_json: string; block_us_holidays: number; reopened_holidays_json: string; time_off_json: string; is_default: number; created_at: string; updated_at: string; eventCount: number };
const projection = (row: Row): NamedSchedule => ({ id: row.id, name: row.name, windows: JSON.parse(row.windows_json), blockUsHolidays: Boolean(row.block_us_holidays), reopenedHolidays: JSON.parse(row.reopened_holidays_json), timeOff: JSON.parse(row.time_off_json), isDefault: Boolean(row.is_default), createdAt: row.created_at, updatedAt: row.updated_at, eventCount: row.eventCount });
const readSql = "SELECT s.*, (SELECT count(*) FROM event_schedule_bindings b WHERE b.schedule_id = s.id) AS eventCount FROM availability_schedules s";

/** A random ULID-shaped id per materialized window row, made inside one INSERT ... SELECT. */
export function windowRowIdSql() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return `'${createId().slice(0, 10)}' || ${Array.from({ length: 16 }, () => `substr('${alphabet}', (random() & 31)+1, 1)`).join(" || ")}`;
}

/** Copy one schedule's windows onto every event bound to it, in the caller's batch. */
export function materializeSchedule(binding: D1Database, id: string, now: string) {
  return [
    binding.prepare(`UPDATE event_types SET updated_at=${nextEventTimestampSql} WHERE id IN (SELECT event_type_id FROM event_schedule_bindings WHERE schedule_id=?)`).bind(now, id),
    binding.prepare("DELETE FROM recurring_availability_windows WHERE event_type_id IN (SELECT event_type_id FROM event_schedule_bindings WHERE schedule_id=?)").bind(id),
    binding.prepare(`INSERT INTO recurring_availability_windows (id,event_type_id,weekday,start_minute,end_minute,created_at,updated_at)
      SELECT ${windowRowIdSql()}, b.event_type_id, json_extract(w.value,'$.weekday'),json_extract(w.value,'$.startMinute'),json_extract(w.value,'$.endMinute'),?,?
      FROM event_schedule_bindings b JOIN availability_schedules s ON s.id=b.schedule_id, json_each(s.windows_json) w WHERE s.id=?`).bind(now, now, id),
  ];
}

/** Replace one event's weekly rows with the windows a SELECT of (weekday, start_minute, end_minute) gives. */
export function replaceEventWindows(binding: D1Database, eventId: string, source: string, params: string[], now: string) {
  return [
    binding.prepare("DELETE FROM recurring_availability_windows WHERE event_type_id=?").bind(eventId),
    binding.prepare(`INSERT INTO recurring_availability_windows (id,event_type_id,weekday,start_minute,end_minute,created_at,updated_at)
      SELECT ${windowRowIdSql()}, ?, w.weekday, w.start_minute, w.end_minute, ?, ? FROM (${source}) w`).bind(eventId, now, now, ...params),
  ];
}
export const scheduleWindowsSql = "SELECT json_extract(j.value,'$.weekday') AS weekday, json_extract(j.value,'$.startMinute') AS start_minute, json_extract(j.value,'$.endMinute') AS end_minute FROM availability_schedules s, json_each(s.windows_json) j WHERE s.id=?";

/** Put one event on a schedule: its binding, and the schedule's windows as its rows. */
export function bindEvent(binding: D1Database, eventId: string, scheduleId: string, now: string) {
  return [
    binding.prepare("INSERT INTO event_schedule_bindings (event_type_id,schedule_id,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(event_type_id) DO UPDATE SET schedule_id=excluded.schedule_id,updated_at=excluded.updated_at").bind(eventId, scheduleId, now, now),
    ...replaceEventWindows(binding, eventId, scheduleWindowsSql, [scheduleId], now),
  ];
}

/** Shared windows are materialized atomically so all existing booking paths see the same hours. */
export class NamedSchedules {
  constructor(private readonly binding: D1Database) {}
  async list() { return (await this.binding.prepare(`${readSql} ORDER BY s.name, s.id`).all<Row>()).results.map(projection); }
  async get(id: string) { const row = await this.binding.prepare(`${readSql} WHERE s.id = ?`).bind(id).first<Row>(); return row ? projection(row) : undefined; }
  /** Your hours: the one schedule every event uses unless it names another or keeps its own. */
  async yours() { const row = await this.binding.prepare(`${readSql} WHERE s.is_default = 1`).first<Row>(); return row ? projection(row) : undefined; }
  async forEvent(eventId: string) { const row = await this.binding.prepare(`${readSql} WHERE s.id = (SELECT schedule_id FROM event_schedule_bindings WHERE event_type_id = ?)`).bind(eventId).first<Row>(); return row ? projection(row) : undefined; }
  async replaceWindows(eventId: string, windows: ScheduleInput["windows"]) {
    const schedule = await this.forEvent(eventId);
    if (!schedule) return false;
    const now = nowIso();
    await this.binding.batch([
      this.binding.prepare("UPDATE availability_schedules SET windows_json=?,updated_at=? WHERE id=?").bind(JSON.stringify(windows), now, schedule.id),
      ...materializeSchedule(this.binding, schedule.id, now),
    ]);
    return true;
  }
  async save(input: ScheduleInput, id = createId()) {
    const now = nowIso();
    await this.binding.batch([
      this.binding.prepare(`INSERT INTO availability_schedules (id,name,windows_json,block_us_holidays,reopened_holidays_json,time_off_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,windows_json=excluded.windows_json,block_us_holidays=excluded.block_us_holidays,reopened_holidays_json=excluded.reopened_holidays_json,time_off_json=excluded.time_off_json,updated_at=excluded.updated_at`).bind(id, input.name, JSON.stringify(input.windows), Number(input.blockUsHolidays), JSON.stringify(input.reopenedHolidays), JSON.stringify(input.timeOff), now, now),
      ...materializeSchedule(this.binding, id, now),
    ]);
    return (await this.get(id))!;
  }
  /** Your holidays and time off close dates on every event, whichever hours it uses (AVAIL-011). */
  async applyClosures(overrides: DateAvailabilityOverrideRecord[], firstDate: string, days: number) {
    const schedule = await this.yours();
    if (!schedule) return overrides;
    const holidays = new Set<string>();
    if (schedule.blockUsHolidays) for (const year of new Set([Number(firstDate.slice(0, 4)), Number(datePlus(firstDate, days - 1).slice(0, 4))])) {
      for (const holiday of usFederalHolidays(year)) if (!schedule.reopenedHolidays.includes(holiday.date)) holidays.add(holiday.date);
    }
    const result = new Map(overrides.map(override => [override.hostDate, override]));
    for (let day = 0; day < days; day++) {
      const date = datePlus(firstDate, day);
      if (holidays.has(date) || schedule.timeOff.some(range => date >= range.startDate && date <= range.endDate)) result.set(date, { id: `schedule:${schedule.id}:${date}`, hostDate: date, mode: "closed", windows: [], createdAt: schedule.createdAt, updatedAt: schedule.updatedAt });
    }
    return [...result.values()];
  }
}
