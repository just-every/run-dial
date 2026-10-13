import { fixtureProviders } from "../review/providers";
import type { ManagedCalendarChange, ManagedCalendarEvent } from "../../src/core/platform/calendar";

type Inspection =
  | { kind: "present"; event: Extract<ManagedCalendarChange, { kind: "changed" }> }
  | { kind: "deleted"; providerEventId: string }
  | { kind: "unresolved"; code: string };

export async function createInspectionFixtures(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS deletion_fixture_inspections (provider_id TEXT PRIMARY KEY, result_json TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS deletion_fixture_notes (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)"),
  ]);
}

export async function storeInspection(db: D1Database, providerEventId: string, result: Inspection) {
  await db.prepare("INSERT INTO deletion_fixture_inspections (provider_id, result_json) VALUES (?, ?) ON CONFLICT(provider_id) DO UPDATE SET result_json = excluded.result_json").bind(providerEventId, JSON.stringify(result)).run();
}

/** All provider observations persist in the test D1 database across actual restarts. */
export function deletionProviders(db: D1Database) {
  const base = fixtureProviders(db);
  return {
    ...base,
    calendar: {
      ...base.calendar,
      async upsertManagedEvent(token: string, calendarId: string, event: ManagedCalendarEvent) {
        const result = await base.calendar.upsertManagedEvent(token, calendarId, event);
        await storeInspection(db, result.providerEventId, { kind: "present", event: { kind: "changed", bookingId: event.bookingId, occurrenceId: event.occurrenceId, providerEventId: result.providerEventId, updatedAt: result.providerUpdatedAt, startAt: event.startAt, endAt: event.endAt, location: event.location } });
        return result;
      },
      async cancelManagedEvent(token: string, calendarId: string, bookingId: string) {
        await base.calendar.cancelManagedEvent(token, calendarId, bookingId);
        await storeInspection(db, `synthetic-${bookingId}`, { kind: "deleted", providerEventId: `synthetic-${bookingId}` });
      },
      async inspectManagedEvent(_token: string, _calendarId: string, input: { bookingId: string; providerEventId: string }): Promise<Inspection> {
        await db.prepare("INSERT INTO fixture_activity (kind, happened_at) VALUES (?, ?)").bind(`inspect:${input.providerEventId}`, new Date().toISOString()).run();
        const result = await db.prepare("SELECT result_json AS resultJson FROM deletion_fixture_inspections WHERE provider_id = ?").bind(input.providerEventId).first<{ resultJson: string }>();
        return result ? JSON.parse(result.resultJson) as Inspection : { kind: "unresolved", code: "provider_unavailable" };
      },
    },
  };
}
