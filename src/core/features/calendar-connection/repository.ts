import { and, asc, eq, gt, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { createDatabase } from "../../platform/db/client";
import {
  calendarBusyIntervals,
  calendarBusyReadWindows,
  calendarConnectionCalendars,
  calendarConnections,
  calendarOAuthStates,
  calendarPushChannels,
  providerWebhookEvents,
} from "../../platform/db/provider-schema";
import { healthChangeStatement, recentHealthChanges } from "./health-history";
import { createId, nowIso } from "../../shared/ids";

export type CalendarConnectionStatus = "disconnected" | "healthy" | "unhealthy";
export type CalendarSelection = { calendarId: string; purpose: "destination" | "conflict"; conferenceCapable: boolean };
export type CalendarConnectionRecord = {
  provider: "google" | "microsoft" | "caldav";
  status: CalendarConnectionStatus;
  authorisedByOperatorId: string | null;
  accountEmail: string | null;
  accessTokenCiphertext: string | null;
  refreshTokenCiphertext: string | null;
  accessTokenExpiresAt: string | null;
  syncCursor: string | null;
  lastCheckedAt: string | null;
  lastSuccessfulReadAt: string | null;
  unhealthyCode: string | null;
  selection: CalendarSelection[];
};

export class CalendarConnectionRepository {
  private readonly db;

  constructor(private readonly binding: D1Database) {
    this.db = createDatabase(binding);
  }

  async get(): Promise<CalendarConnectionRecord | undefined> {
    const [connection] = await this.db.select().from(calendarConnections).where(eq(calendarConnections.singletonKey, "default"));
    if (!connection) return undefined;
    const selected = await this.db.select().from(calendarConnectionCalendars).orderBy(asc(calendarConnectionCalendars.purpose), asc(calendarConnectionCalendars.calendarId));
    return {
      provider: connection.calendarProvider,
      status: connection.status,
      authorisedByOperatorId: connection.authorisedByOperatorId,
      accountEmail: connection.accountEmail,
      accessTokenCiphertext: connection.accessTokenCiphertext,
      refreshTokenCiphertext: connection.refreshTokenCiphertext,
      accessTokenExpiresAt: connection.accessTokenExpiresAt,
      syncCursor: connection.syncCursor,
      lastCheckedAt: connection.lastCheckedAt,
      lastSuccessfulReadAt: connection.lastSuccessfulReadAt,
      unhealthyCode: connection.unhealthyCode,
      selection: selected.map((entry) => ({
        calendarId: entry.calendarId,
        purpose: entry.purpose,
        conferenceCapable: entry.conferenceCapable,
      })),
    };
  }

  async createOAuthState(input: { id: string; sessionId: string; operatorId: string; expiresAt: string }) {
    await this.db.insert(calendarOAuthStates).values({ ...input, consumedAt: null, createdAt: nowIso() });
  }

  async consumeOAuthState(input: { id: string; sessionId: string; operatorId: string; now: string }) {
    const result = await this.db
      .update(calendarOAuthStates)
      .set({ consumedAt: input.now })
      .where(and(
        eq(calendarOAuthStates.id, input.id),
        eq(calendarOAuthStates.sessionId, input.sessionId),
        eq(calendarOAuthStates.operatorId, input.operatorId),
        isNull(calendarOAuthStates.consumedAt),
        gt(calendarOAuthStates.expiresAt, input.now),
      ))
      .run();
    return result.meta.changes === 1;
  }

  async saveCredentials(input: {
    operatorId: string;
    provider?: "google" | "microsoft";
    accessTokenCiphertext: string;
    refreshTokenCiphertext: string;
    accessTokenExpiresAt: string;
  }) {
    const timestamp = nowIso();
    const write = this.db
      .insert(calendarConnections)
      .values({
        singletonKey: "default",
        provider: "google",
        calendarProvider: input.provider ?? "google",
        status: "unhealthy",
        authorisedByOperatorId: input.operatorId,
        accountEmail: null,
        accessTokenCiphertext: input.accessTokenCiphertext,
        refreshTokenCiphertext: input.refreshTokenCiphertext,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        syncCursor: null,
        channelId: null,
        channelResourceId: null,
        channelExpiresAt: null,
        lastCheckedAt: null,
        lastSuccessfulReadAt: null,
        unhealthyCode: "selection_required",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: calendarConnections.singletonKey,
        set: {
          provider: "google",
          calendarProvider: input.provider ?? "google",
          status: "unhealthy",
          authorisedByOperatorId: input.operatorId,
          accessTokenCiphertext: input.accessTokenCiphertext,
          refreshTokenCiphertext: input.refreshTokenCiphertext,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          syncCursor: null,
          channelId: null,
          channelResourceId: null,
          channelExpiresAt: null,
          lastCheckedAt: null,
          lastSuccessfulReadAt: null,
          unhealthyCode: "selection_required",
          updatedAt: timestamp,
        },
      }).toSQL();
    await this.binding.batch([
      healthChangeStatement(this.binding, "unhealthy", "selection_required", timestamp),
      this.binding.prepare(write.sql).bind(...write.params),
      this.binding.prepare("DELETE FROM calendar_push_channels"),
      this.binding.prepare("DELETE FROM calendar_busy_intervals"),
      this.binding.prepare("DELETE FROM calendar_busy_read_windows"),
    ]);
  }

  recentHealthChanges() { return recentHealthChanges(this.binding); }

  async replaceSelection(destinationCalendarId: string, conflictCalendarIds: string[], descriptors: Map<string, { conferenceCapable: boolean }>) {
    const timestamp = nowIso();
    const rows: CalendarSelection[] = [
      { calendarId: destinationCalendarId, purpose: "destination", conferenceCapable: descriptors.get(destinationCalendarId)?.conferenceCapable ?? false },
      ...conflictCalendarIds.map((calendarId) => ({ calendarId, purpose: "conflict" as const, conferenceCapable: descriptors.get(calendarId)?.conferenceCapable ?? false })),
    ];
    await this.binding.batch([
      healthChangeStatement(this.binding, "unhealthy", "selection_changed", timestamp),
      this.binding.prepare("DELETE FROM calendar_connection_calendars"),
      ...rows.map((row) => this.binding
        .prepare("INSERT INTO calendar_connection_calendars (id, calendar_id, purpose, conference_capable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(createId(), row.calendarId, row.purpose, row.conferenceCapable ? 1 : 0, timestamp, timestamp)),
      this.binding.prepare("UPDATE calendar_connections SET status = 'unhealthy', last_checked_at = NULL, unhealthy_code = 'selection_changed', updated_at = ? WHERE singleton_key = 'default'")
        .bind(timestamp),
    ]);
  }

  async updateCredentials(input: { accessTokenCiphertext: string; refreshTokenCiphertext: string; accessTokenExpiresAt: string }) {
    await this.db.update(calendarConnections).set({ ...input, updatedAt: nowIso() }).where(eq(calendarConnections.singletonKey, "default"));
  }

  async hasManagedCalendarWork() {
    return Boolean(await this.binding.prepare("SELECT 1 FROM bookings WHERE calendar_required=1 AND state IN ('confirmed','rescheduled') UNION ALL SELECT 1 FROM delivery_outbox WHERE kind IN ('calendar_upsert','calendar_cancel') AND state IN ('pending','processing') UNION ALL SELECT 1 FROM erased_calendar_targets WHERE completed_at IS NULL AND archive_historical=0 LIMIT 1").first());
  }

  async clearCancelledTeamsConference(bookingId: string) {
    await this.binding.prepare("UPDATE bookings SET meeting_url=NULL,meeting_state='not_required' WHERE id=? AND state='cancelled' AND location_type='microsoft_teams'").bind(bookingId).run();
  }

  async managedEventLocation(bookingId: string, occurrenceId: string) {
    return (await this.binding.prepare("SELECT location_type AS type FROM bookings WHERE id=? AND current_occurrence_id=? AND state IN ('confirmed','rescheduled')").bind(bookingId, occurrenceId).first<{ type: string }>())?.type;
  }

  async updateSyncCursor(syncCursor: string) {
    await this.db.update(calendarConnections).set({ syncCursor, updatedAt: nowIso() }).where(eq(calendarConnections.singletonKey, "default"));
  }

  async clearSyncCursor() {
    await this.db.update(calendarConnections).set({ syncCursor: null, updatedAt: nowIso() }).where(eq(calendarConnections.singletonKey, "default"));
  }

  async markHealthy(checkAt: string, successfulRead = false) {
    const timestamp = nowIso();
    await this.binding.batch([
      healthChangeStatement(this.binding, "healthy", "connection_restored", timestamp),
      this.binding.prepare(`UPDATE calendar_connections SET status='healthy', last_checked_at=?,
        last_successful_read_at=CASE WHEN ? THEN ? ELSE last_successful_read_at END,
        unhealthy_code=NULL, updated_at=? WHERE singleton_key='default'`)
        .bind(checkAt, successfulRead ? 1 : 0, checkAt, timestamp),
    ]);
  }

  /** Each healthy check records the destination's current conferencing capability for readiness. */
  async recordConferenceCapability(calendarId: string, conferenceCapable: boolean) {
    await this.db.update(calendarConnectionCalendars).set({ conferenceCapable })
      .where(and(eq(calendarConnectionCalendars.purpose, "destination"), eq(calendarConnectionCalendars.calendarId, calendarId)));
  }

  async markUnhealthy(code: string) {
    const timestamp = nowIso();
    await this.binding.batch([
      healthChangeStatement(this.binding, "unhealthy", code, timestamp),
      this.binding.prepare("UPDATE calendar_connections SET status='unhealthy', unhealthy_code=?, updated_at=? WHERE singleton_key='default'")
        .bind(code, timestamp),
    ]);
  }

  async replaceBusyIntervals(input: {
    calendarIds: string[];
    startsAt: string;
    endsAt: string;
    intervals: Array<{ calendarId: string; startsAt: string; endsAt: string; transparency: "opaque" | "transparent"; deleted: boolean }>;
    observedAt: string;
  }) {
    const calendarIds = [...new Set(input.calendarIds)];
    if (calendarIds.length === 0) return;
    const timestamp = nowIso();
    await this.db.batch([
      this.db.delete(calendarBusyIntervals).where(inArray(calendarBusyIntervals.calendarId, calendarIds)),
      // The interval set is a snapshot per conflict calendar. Retaining an
      // older, wider read window after replacing its intervals with a narrower
      // read would make an uncovered range appear safely empty.
      this.db.delete(calendarBusyReadWindows).where(inArray(calendarBusyReadWindows.calendarId, calendarIds)),
      ...input.intervals.map((interval) => this.db.insert(calendarBusyIntervals).values({
        id: createId(),
        ...interval,
        observedAt: input.observedAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      ...calendarIds.map((calendarId) => this.db.insert(calendarBusyReadWindows).values({
        id: createId(),
        calendarId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        observedAt: input.observedAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    ]);
  }

  async cachedBusyIntervals(calendarIds: string[], startsAt: string, endsAt: string, newerThan: string) {
    const coverage = await this.db
      .select({ calendarId: calendarBusyReadWindows.calendarId, observedAt: calendarBusyReadWindows.observedAt })
      .from(calendarBusyReadWindows)
      .where(and(
        inArray(calendarBusyReadWindows.calendarId, calendarIds),
        lte(calendarBusyReadWindows.startsAt, startsAt),
        gte(calendarBusyReadWindows.endsAt, endsAt),
        gt(calendarBusyReadWindows.observedAt, newerThan),
      ));
    if (new Set(coverage.map((entry) => entry.calendarId)).size !== calendarIds.length) return undefined;
    const observedAt = coverage.map((entry) => entry.observedAt).sort()[0];
    const intervals = await this.db
      .select()
      .from(calendarBusyIntervals)
      .where(and(
        inArray(calendarBusyIntervals.calendarId, calendarIds),
        lt(calendarBusyIntervals.startsAt, endsAt),
        gt(calendarBusyIntervals.endsAt, startsAt),
        eq(calendarBusyIntervals.deleted, false),
        eq(calendarBusyIntervals.transparency, "opaque"),
      ));
    return { observedAt, intervals };
  }

  async invalidateBusyCache() {
    await this.db.delete(calendarBusyReadWindows);
  }

  async replacePushChannels(channels: Array<{ calendarId: string; providerChannelId: string; providerResourceId: string; expiresAt: string }>) {
    const timestamp = nowIso();
    await this.db.batch([
      this.db.delete(calendarPushChannels),
      ...channels.map((channel) => this.db.insert(calendarPushChannels).values({ id: createId(), ...channel, createdAt: timestamp, updatedAt: timestamp })),
    ]);
  }

  async findPushChannel(providerChannelId: string, providerResourceId: string) {
    const [channel] = await this.db
      .select()
      .from(calendarPushChannels)
      .where(and(eq(calendarPushChannels.providerChannelId, providerChannelId), eq(calendarPushChannels.providerResourceId, providerResourceId)));
    return channel;
  }

  async listPushChannels() {
    return this.db.select().from(calendarPushChannels).orderBy(asc(calendarPushChannels.calendarId));
  }

  async recordWebhook(input: { provider: "google_calendar" | "resend"; providerEventId: string; occurredAt?: string; payloadHash: string }) {
    const timestamp = nowIso();
    const result = await this.db
      .insert(providerWebhookEvents)
      .values({ id: createId(), ...input, occurredAt: input.occurredAt ?? null, receivedAt: timestamp, processedAt: null, state: "received" })
      .onConflictDoNothing()
      .run();
    return result.meta.changes === 1;
  }

  async completeWebhook(provider: "google_calendar" | "resend", providerEventId: string, state: "processed" | "ignored") {
    await this.db
      .update(providerWebhookEvents)
      .set({ state, processedAt: nowIso() })
      .where(and(eq(providerWebhookEvents.provider, provider), eq(providerWebhookEvents.providerEventId, providerEventId)));
  }

  async disconnect() {
    const timestamp = nowIso();
    await this.binding.batch([
      healthChangeStatement(this.binding, "disconnected", "disconnected", timestamp),
      this.binding.prepare("DELETE FROM calendar_connection_calendars"),
      this.binding.prepare("DELETE FROM calendar_busy_intervals"),
      this.binding.prepare("DELETE FROM calendar_busy_read_windows"),
      this.binding.prepare("DELETE FROM calendar_push_channels"),
      this.binding.prepare("INSERT INTO calendar_connections (singleton_key, provider, status, authorised_by_operator_id, account_email, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, sync_cursor, channel_id, channel_resource_id, channel_expires_at, last_checked_at, last_successful_read_at, unhealthy_code, created_at, updated_at) VALUES ('default', 'google', 'disconnected', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'disconnected', ?, ?) ON CONFLICT(singleton_key) DO UPDATE SET status = 'disconnected', authorised_by_operator_id = NULL, account_email = NULL, access_token_ciphertext = NULL, refresh_token_ciphertext = NULL, access_token_expires_at = NULL, sync_cursor = NULL, channel_id = NULL, channel_resource_id = NULL, channel_expires_at = NULL, last_checked_at = NULL, last_successful_read_at = NULL, unhealthy_code = 'disconnected', updated_at = excluded.updated_at")
        .bind(timestamp, timestamp),
    ]);
  }
}
