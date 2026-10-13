import { ensureTestOperator, registerTestSetup } from "../auth-fixture";
import { CalendarConnectionRepository } from "../../src/core/features/calendar-connection";
import { EventTypesRepository } from "../../src/core/features/event-types";
import { seal } from "../../src/core/platform/crypto/sealed";
import type { AppBindings } from "../../src/core/app/bindings";
import type { AppServices } from "../../src/core/app/services";

export async function setup(env: AppBindings & { PROVIDER_DB?: D1Database }, services: AppServices) {
  const providerDb = env.PROVIDER_DB ?? env.DB;
  await providerDb.batch([
    providerDb.prepare("CREATE TABLE IF NOT EXISTS fixture_controls (kind TEXT PRIMARY KEY, failure INTEGER NOT NULL DEFAULT 0, delay_ms INTEGER NOT NULL DEFAULT 0)"),
    providerDb.prepare("CREATE TABLE IF NOT EXISTS fixture_events (booking_id TEXT PRIMARY KEY, event_json TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    providerDb.prepare("CREATE TABLE IF NOT EXISTS fixture_mail (key TEXT PRIMARY KEY, message_json TEXT NOT NULL, sent_at TEXT NOT NULL)"),
    providerDb.prepare("CREATE TABLE IF NOT EXISTS fixture_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, happened_at TEXT NOT NULL)"),
  ]);
  const operator = await ensureTestOperator(env.DB, "operator@dial.test");
  await registerTestSetup(env.DB, operator.id);
  await services.hostProfile.saveProfile({ handle: "dial-host", name: "Morgan Bell", title: "Product advisor", biography: "A task-owned Dial review workspace. All appointments and notifications in this workspace are synthetic.", timezone: "Australia/Brisbane", focusAreas: [{ label: "Product discovery", description: "Choose a useful next step" }, { label: "Focused conversations", description: "A clear half-hour discussion" }], socialProof: [] });
  const connection = new CalendarConnectionRepository(env.DB);
  await connection.saveCredentials({ operatorId: operator.id, accessTokenCiphertext: await seal("synthetic-access", env.SESSION_SECRET), refreshTokenCiphertext: await seal("synthetic-refresh", env.SESSION_SECRET), accessTokenExpiresAt: "2035-01-01T00:00:00.000Z" });
  await services.calendar.selectCalendars({ destinationCalendarId: "synthetic-calendar", conflictCalendarIds: ["synthetic-calendar"] });
  await services.delivery.checkMailConnection();
  await services.calendar.checkConnection();
  const events = new EventTypesRepository(env.DB);
  let event = await events.getBySlug("intro");
  event ??= await events.create({ slug: "intro", title: "A focused introduction", description: "Thirty minutes to talk through your goals and choose a useful next step.", durationMinutes: 30, color: "#176b5a", locationType: "google_meet", locationLabel: "Google Meet", locationValue: "", listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [{ kind: "text", label: "What would you like to discuss?", required: true, options: [] }], availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) });
  await events.setStatus(event.id, "published");
  return { operatorEmail: operator.email, eventId: event.id, publicUrl: "/book/dial-host/intro" };
}

export async function status(db: D1Database, providerDb: D1Database = db) {
  const tables = ["bookings", "booking_occurrences", "booking_history", "booking_answers", "booking_manage_tokens", "booking_nonces", "delivery_outbox", "delivery_attempts", "anonymized_audit", "erased_calendar_targets", "fixture_events", "fixture_mail", "fixture_activity", "booking_calendar_conflicts", "availability_requests", "availability_request_windows", "availability_request_review_nonces"];
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await (table.startsWith("fixture_") ? providerDb : db).prepare(`SELECT * FROM ${table}`).all()).results])));
}
