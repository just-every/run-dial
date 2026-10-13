import type { AppBindings } from "../../src/core/app/bindings";
import { ProviderFailure, type CalendarAdapter, type ManagedCalendarEvent } from "../../src/core/platform/calendar";
import type { MailSender } from "../../src/core/platform/mail";

/** Task-owned fixtures are reachable only from the test entry point, never production composition. */
export function fixtureProviders(db: D1Database) {
  const credentials = () => ({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2035-01-01T00:00:00.000Z" });
  const descriptor = { id: "synthetic-calendar", accessRole: "owner" as const, primary: true, conferenceCapable: true };
  async function before(kind: string) {
    const control = await db.prepare("SELECT failure, delay_ms AS delayMs FROM fixture_controls WHERE kind = ?").bind(kind).first<{ failure: number; delayMs: number }>();
    await db.prepare("INSERT INTO fixture_activity(kind, happened_at) VALUES (?, ?)").bind(kind, new Date().toISOString()).run();
    if (control?.delayMs) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
    if (control?.failure) throw new ProviderFailure("provider_unavailable", false);
  }
  const calendar: CalendarAdapter = {
    authorizationUrl(redirect, state) { const url = new URL(redirect); url.searchParams.set("code", "synthetic-code"); url.searchParams.set("state", state); return url.toString(); },
    async exchangeAuthorizationCode() { return credentials(); },
    async refreshAccessToken() { return credentials(); },
    async listCalendars() { return [descriptor]; },
    async checkDestination() { await before("check"); return descriptor; },
    async readBusy(_token, input) {
      await before("busy");
      const events = await db.prepare("SELECT event_json AS eventJson FROM fixture_events WHERE state = 'active'").all<{ eventJson: string }>();
      return { observedAt: new Date().toISOString(), intervals: events.results.map(({ eventJson }) => { const event = JSON.parse(eventJson) as ManagedCalendarEvent; return { calendarId: input.calendarIds[0], startsAt: event.startAt, endsAt: event.endAt, deleted: false, transparency: "opaque" as const }; }) };
    },
    async upsertManagedEvent(_token, _calendar, event) {
      await before("upsert");
      const updated = new Date().toISOString();
      await db.prepare("INSERT INTO fixture_events (booking_id, event_json, state, updated_at) VALUES (?, ?, 'active', ?) ON CONFLICT(booking_id) DO UPDATE SET event_json = excluded.event_json, state = 'active', updated_at = excluded.updated_at").bind(event.bookingId, JSON.stringify(event), updated).run();
      const meet = await db.prepare("SELECT failure FROM fixture_controls WHERE kind = 'meet'").first<{ failure: number }>();
      const pending = await db.prepare("SELECT failure FROM fixture_controls WHERE kind = 'meet_pending'").first<{ failure: number }>();
      return { providerEventId: `synthetic-${event.bookingId}`, providerUpdatedAt: updated, conferenceState: event.requestGoogleMeet ? (meet?.failure ? "failed" : pending?.failure ? "pending" : "ready") : "not_requested", ...(event.requestGoogleMeet && !meet?.failure && !pending?.failure ? { conferenceUrl: `https://meet.example.test/${event.bookingId}` } : {}) };
    },
    async cancelManagedEvent(_token, _calendar, id) { await before("cancel"); await db.prepare("UPDATE fixture_events SET state = 'cancelled', updated_at = ? WHERE booking_id = ?").bind(new Date().toISOString(), id).run(); },
    async inspectManagedEvent(_token, _calendar, input) {
      await before("inspect");
      const row = await db.prepare("SELECT event_json AS eventJson, state, updated_at AS updatedAt FROM fixture_events WHERE booking_id = ?").bind(input.bookingId).first<{ eventJson: string; state: string; updatedAt: string }>();
      if (!row || input.providerEventId !== `synthetic-${input.bookingId}`) return { kind: "unresolved", code: "event_missing" };
      if (row.state === "cancelled") return { kind: "deleted", providerEventId: input.providerEventId };
      const event = JSON.parse(row.eventJson) as ManagedCalendarEvent;
      return { kind: "present", event: { kind: "changed", bookingId: event.bookingId, occurrenceId: event.occurrenceId, providerEventId: input.providerEventId, updatedAt: row.updatedAt, startAt: event.startAt, endAt: event.endAt, location: event.location } };
    },
    async syncManagedEvents() { await before("sync"); return { changes: [], syncCursor: "synthetic-cursor" }; },
    async watchCalendars(_token, input) { return input.calendarIds.map((calendarId) => ({ calendarId, providerChannelId: `synthetic-channel-${calendarId}`, providerResourceId: `synthetic-resource-${calendarId}`, expiresAt: "2035-01-01T00:00:00.000Z" })); },
    async stopWatch() {},
  };
  const mail: MailSender = {
    async checkConnection() { return { checkedAt: new Date().toISOString() }; },
    async send(message) {
      await before("mail");
      await db.prepare("INSERT INTO fixture_mail (key, message_json, sent_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING").bind(message.idempotencyKey, JSON.stringify(message), new Date().toISOString()).run();
      await before("mail_after_accept");
      return { providerMessageId: `synthetic-${message.idempotencyKey}` };
    },
  };
  return { calendar, mail };
}

/** Isolated native suites must bind provider storage independently of application D1. */
export function isolatedProviderDb(env: AppBindings & { PROVIDER_DB?: D1Database }): D1Database {
  if (!env.PROVIDER_DB) throw new Error("Native fixture runtime requires a separate PROVIDER_DB binding");
  if (env.PROVIDER_DB === env.DB) throw new Error("PROVIDER_DB must be separate from application DB");
  return env.PROVIDER_DB;
}
