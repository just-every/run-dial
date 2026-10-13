import { seal, unseal } from "../../platform/crypto/sealed";
import { GoogleCalendarAdapter, ProviderFailure, type CalendarAdapter, type CalendarCredentials, type ManagedCalendarEvent } from "../../platform/calendar";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { googleCalendarConfiguration } from "../../shared/runtime-env";
import { createOpaqueToken } from "../../platform/auth/tokens";
import type { SessionRecord } from "../operators";
import { CalendarBusyReader, type CalendarAvailabilityReader } from "./busy-reader";
import type { CalendarExternalChangeHandler } from "./external-sync";
import { connectionHealth, failureCode, type ProviderHealth } from "./health";
import { payloadHash, sameSecret, signOAuthState, verifyOAuthState } from "./oauth-state";
import { CalendarConnectionRepository } from "./repository";
import type { AdmitCallback } from "../../platform/public-admission";

const oauthStateLifetimeMs = 10 * 60 * 1_000;
/** NOTIFY-007's connection watch (src/core/app/connection-watch.ts), told what the connection's checks see. */
export type ConnectionWatchObservers = {
  /** A healthy connection failed: a new incident. */
  sighting(): Promise<void>;
  /** The connection still fails: confirm it, keeping a pending incident's deadline. */
  stillFailing(): Promise<void>;
  /** A full health check read the connection healthy: the next probe falls 30 s later. */
  checkedHealthy(): Promise<void>;
};
export class CalendarConnectionService implements CalendarAvailabilityReader {
  private readonly calendar: CalendarAdapter;
  private readonly busyReader: CalendarBusyReader;
  private inlineRecoveryAllowed = true;
  setInlineRecoveryAllowed(allowed: boolean) { this.inlineRecoveryAllowed = allowed; }
  private externalChanges: CalendarExternalChangeHandler | undefined;
  private watch: ConnectionWatchObservers | undefined;
  setWatchObservers(observers: ConnectionWatchObservers) { this.watch = observers; }

  constructor(
    private readonly repository: CalendarConnectionRepository,
    private readonly runtime: RuntimeEnvironment,
    calendar?: CalendarAdapter,
  ) {
    const configuration = googleCalendarConfiguration(runtime);
    this.calendar = calendar ?? new GoogleCalendarAdapter(configuration && { clientId: configuration.clientId, clientSecret: configuration.clientSecret });
    this.busyReader = new CalendarBusyReader(
      repository,
      this.calendar,
      () => this.credentials(),
      async () => {
        if (!this.inlineRecoveryAllowed) return { kind: "unavailable" as const, code: "calendar_recovery_required" };
        const result = await this.checkConnection();
        return result.kind === "healthy" ? { kind: "healthy" as const } : { kind: "unavailable" as const, code: result.code };
      },
      (error) => this.markFailure(error),
    );
  }

  setupGuide() { return { redirectUri: callbackUrl(this.runtime), configured: Boolean(googleCalendarConfiguration(this.runtime)?.webhookSecret) }; }

  async beginAuthorization(session: SessionRecord) {
    if (!googleCalendarConfiguration(this.runtime)) return undefined;
    const stateId = createOpaqueToken();
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + oauthStateLifetimeMs).toISOString();
    const state = await signOAuthState({ id: stateId, sessionId: session.sessionId, operatorId: session.id, issuedAt }, this.runtime.SESSION_SECRET);
    await this.repository.createOAuthState({ id: stateId, sessionId: session.sessionId, operatorId: session.id, expiresAt });
    return this.calendar.authorizationUrl(callbackUrl(this.runtime), state);
  }

  async completeAuthorization(input: { state: string | undefined; code: string | undefined; session: SessionRecord | undefined }) {
    const state = input.state ? await verifyOAuthState(input.state, this.runtime.SESSION_SECRET) : undefined;
    if (!state || !input.session || state.sessionId !== input.session.sessionId || state.operatorId !== input.session.id) return { kind: "invalid_state" as const };
    const issuedAt = Date.parse(state.issuedAt);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > oauthStateLifetimeMs || issuedAt > Date.now() + 60_000) return { kind: "invalid_state" as const };
    const consumed = await this.repository.consumeOAuthState({ id: state.id, sessionId: state.sessionId, operatorId: state.operatorId, now: new Date().toISOString() });
    if (!consumed || !input.code) return { kind: "invalid_state" as const };
    try {
      const credentials = await this.calendar.exchangeAuthorizationCode(input.code, callbackUrl(this.runtime));
      await this.repository.saveCredentials({
        operatorId: input.session.id,
        accessTokenCiphertext: await seal(credentials.accessToken, this.runtime.SESSION_SECRET),
        refreshTokenCiphertext: await seal(credentials.refreshToken, this.runtime.SESSION_SECRET),
        accessTokenExpiresAt: credentials.expiresAt,
      });
      return { kind: "connected" as const };
    } catch (error) {
      return { kind: "provider_failure" as const, code: failureCode(error) };
    }
  }

  async connectionHealth(): Promise<ProviderHealth> {
    return connectionHealth(await this.repository.get());
  }

  async listCalendars() {
    try {
      const credentials = await this.credentials();
      return { kind: "ok" as const, calendars: await this.calendar.listCalendars(credentials.accessToken) };
    } catch (error) {
      await this.markFailure(error);
      return { kind: "unavailable" as const, code: failureCode(error) };
    }
  }

  async selectCalendars(input: { destinationCalendarId: string; conflictCalendarIds: string[] }) {
    const conflictCalendarIds = [...new Set(input.conflictCalendarIds)];
    if (!input.destinationCalendarId || conflictCalendarIds.length === 0 || conflictCalendarIds.length > 10) {
      return { kind: "invalid_selection" as const };
    }
    try {
      const credentials = await this.credentials();
      const available = await this.calendar.listCalendars(credentials.accessToken);
      const byId = new Map(available.map((calendar) => [calendar.id, calendar]));
      const destination = byId.get(input.destinationCalendarId);
      if (!destination || !["writer", "owner"].includes(destination.accessRole)) return { kind: "invalid_selection" as const };
      if (!conflictCalendarIds.every((calendarId) => byId.has(calendarId))) return { kind: "invalid_selection" as const };
      await this.repository.replaceSelection(input.destinationCalendarId, conflictCalendarIds, byId);
      return { kind: "saved" as const, health: await this.connectionHealth() };
    } catch (error) {
      await this.markFailure(error);
      return { kind: "unavailable" as const, code: failureCode(error) };
    }
  }

  async checkConnection() {
    const connection = await this.repository.get();
    if (!connection || connection.status === "disconnected") return { kind: "unavailable" as const, code: "not_connected" };
    if (connection?.unhealthyCode === "reauthorization_required") return { kind: "unavailable" as const, code: "reauthorization_required" };
    const destination = connection?.selection.find((entry) => entry.purpose === "destination");
    const conflicts = connection?.selection.filter((entry) => entry.purpose === "conflict") ?? [];
    if (!destination || conflicts.length === 0) {
      await this.repository.markUnhealthy("selection_required");
      return { kind: "unavailable" as const, code: "selection_required" };
    }
    try {
      const credentials = await this.credentials(connection);
      const descriptor = await this.readHealth(credentials.accessToken, destination.calendarId, conflicts.map((entry) => entry.calendarId));
      await this.ensurePushChannels(credentials, [destination.calendarId, ...conflicts.map((entry) => entry.calendarId)]);
      if (!connection.syncCursor) {
        const sync = await this.syncManagedEvents();
        if (sync.kind === "unavailable") return sync;
      }
      await this.repository.markHealthy(new Date().toISOString());
      if (this.watch) await this.tellWatch("checkedHealthy");
      return { kind: "healthy" as const, conferenceCapable: descriptor.conferenceCapable };
    } catch (error) {
      await this.markFailure(error);
      return { kind: "unavailable" as const, code: failureCode(error) };
    }
  }

  /**
   * NOTIFY-007's probe between scheduled passes: the health check's two provider reads on a healthy connection, the
   * destination lookup and free/busy over the conflict calendars, recording only a failure. An unhealthy connection
   * already has its incident pending or its alert sent, and its re-checks and the scheduled pass announce recovery.
   */
  async probeConnection() {
    const connection = await this.repository.get();
    const destination = connection?.selection.find((entry) => entry.purpose === "destination");
    const conflicts = connection?.selection.filter((entry) => entry.purpose === "conflict") ?? [];
    if (connection?.status !== "healthy" || !destination || conflicts.length === 0) return;
    try {
      const credentials = await this.credentials(connection);
      await this.readHealth(credentials.accessToken, destination.calendarId, conflicts.map((entry) => entry.calendarId));
    } catch (error) {
      await this.markFailure(error);
    }
  }

  /** Every provider failure the health check can see: the destination must be writable and every conflict calendar readable. */
  private async readHealth(accessToken: string, destinationCalendarId: string, conflictCalendarIds: string[]) {
    const descriptor = await this.calendar.checkDestination(accessToken, destinationCalendarId);
    const now = new Date();
    await this.calendar.readBusy(accessToken, {
      calendarIds: conflictCalendarIds,
      startsAt: now.toISOString(),
      endsAt: new Date(now.getTime() + 60_000).toISOString(),
      timeZone: "UTC",
    });
    return descriptor;
  }

  readBusy(input: { startAt: string; endAt: string; freshness: "cached" | "fresh" }) {
    return this.busyReader.readBusy(input);
  }

  async upsertManagedEvent(event: ManagedCalendarEvent) {
    try {
      const connection = await this.repository.get();
      const destination = connection?.selection.find((entry) => entry.purpose === "destination");
      if (!destination) throw new ProviderFailure("missing_configuration", false);
      const credentials = await this.credentials(connection);
      return await this.calendar.upsertManagedEvent(credentials.accessToken, destination.calendarId, event);
    } catch (error) {
      await this.markFailure(error);
      throw error;
    }
  }

  async inspectManagedEvent(input: { bookingId: string; providerEventId: string }) {
    try {
      const connection = await this.repository.get();
      const destination = connection?.selection.find((entry) => entry.purpose === "destination");
      if (!connection || connection.status === "disconnected" || !destination) throw new ProviderFailure("missing_configuration", false);
      return await this.calendar.inspectManagedEvent((await this.credentials(connection)).accessToken, destination.calendarId, input);
    } catch (error) { await this.markFailure(error); throw error; }
  }

  async cancelManagedEvent(bookingId: string) {
    try {
      const connection = await this.repository.get();
      const destination = connection?.selection.find((entry) => entry.purpose === "destination");
      if (!destination) throw new ProviderFailure("missing_configuration", false);
      const credentials = await this.credentials(connection);
      await this.calendar.cancelManagedEvent(credentials.accessToken, destination.calendarId, bookingId);
    } catch (error) {
      await this.markFailure(error);
      throw error;
    }
  }

  async renewExpiringPushChannels() {
    const connection = await this.repository.get();
    if (!connection || connection.status === "disconnected") return { kind: "disconnected" as const };
    const destination = connection.selection.find((entry) => entry.purpose === "destination")?.calendarId;
    const conflicts = connection.selection.filter((entry) => entry.purpose === "conflict").map((entry) => entry.calendarId);
    if (!destination || conflicts.length === 0) return { kind: "unavailable" as const, code: "selection_required" };
    try {
      const ensured = await this.ensurePushChannels(await this.credentials(connection), [destination, ...conflicts]);
      return { kind: ensured ? "renewed" as const : "current" as const };
    } catch (error) {
      await this.markFailure(error);
      return { kind: "unavailable" as const, code: failureCode(error) };
    }
  }

  /** Set during composition after bookings is constructed, avoiding a feature cycle. */
  setExternalChangeHandler(handler: CalendarExternalChangeHandler) {
    this.externalChanges = handler;
  }

  async syncManagedEvents() {
    if (!this.inlineRecoveryAllowed) return { kind: "unavailable" as const, code: "calendar_recovery_required" };
    const connection = await this.repository.get();
    const destination = connection?.selection.find((entry) => entry.purpose === "destination");
    if (!connection || connection.status === "disconnected" || !destination) return { kind: "unavailable" as const, code: "selection_required" };
    try {
      const synced = await this.calendar.syncManagedEvents((await this.credentials(connection)).accessToken, destination.calendarId, connection.syncCursor ?? undefined);
      for (const change of synced.changes) {
        if (!this.externalChanges) throw new ProviderFailure("missing_configuration", false);
        await this.externalChanges.reconcileCalendarChange(change);
      }
      await this.repository.updateSyncCursor(synced.syncCursor);
      return { kind: "synced" as const, changed: synced.changes.length };
    } catch (error) {
      if (failureCode(error) === "invalid_sync_cursor") await this.repository.clearSyncCursor();
      await this.markFailure(error);
      return { kind: "unavailable" as const, code: failureCode(error) };
    }
  }

  async receiveGoogleWebhook(headers: Headers, admit: AdmitCallback) {
    const secret = googleCalendarConfiguration(this.runtime)?.webhookSecret;
    const channelId = headers.get("x-goog-channel-id");
    const resourceId = headers.get("x-goog-resource-id");
    const messageNumber = headers.get("x-goog-message-number");
    if (!secret || !channelId || !resourceId || !messageNumber || !sameSecret(secret, headers.get("x-goog-channel-token"))) return { kind: "unauthorized" as const };
    const channel = await this.repository.findPushChannel(channelId, resourceId);
    if (!channel) return { kind: "unauthorized" as const };
    const admission = await admit();
    if (admission.kind === "limited") return { kind: "rate_limited" as const, retryAfterSeconds: admission.retryAfterSeconds };
    const providerEventId = `${channelId}:${messageNumber}`;
    const recorded = await this.repository.recordWebhook({ provider: "google_calendar", providerEventId, payloadHash: await payloadHash(providerEventId) });
    if (!recorded) return { kind: "duplicate" as const };
    await this.repository.invalidateBusyCache();
    // Availability uses an authenticated full free/busy read, so an invalidated
    // cache forces the next request to resync rather than trust callback order.
    await this.repository.completeWebhook("google_calendar", providerEventId, "processed");
    return { kind: "accepted" as const };
  }

  async disconnect() {
    await this.repository.disconnect();
  }

  private async credentials(connection?: Awaited<ReturnType<CalendarConnectionRepository["get"]>>): Promise<CalendarCredentials> {
    const current = connection ?? await this.repository.get();
    if (current?.unhealthyCode === "reauthorization_required") throw new ProviderFailure("reauthorization_required", false);
    if (!current?.accessTokenCiphertext || !current.refreshTokenCiphertext || !current.accessTokenExpiresAt || current.status === "disconnected") {
      throw new ProviderFailure("missing_configuration", false);
    }
    const credentials = {
      accessToken: await unseal(current.accessTokenCiphertext, this.runtime.SESSION_SECRET),
      refreshToken: await unseal(current.refreshTokenCiphertext, this.runtime.SESSION_SECRET),
      expiresAt: current.accessTokenExpiresAt,
    };
    if (Date.parse(credentials.expiresAt) > Date.now() + 60_000) return credentials;
    const refreshed = await this.calendar.refreshAccessToken(credentials.refreshToken);
    await this.repository.updateCredentials({
      accessTokenCiphertext: await seal(refreshed.accessToken, this.runtime.SESSION_SECRET),
      refreshTokenCiphertext: await seal(refreshed.refreshToken, this.runtime.SESSION_SECRET),
      accessTokenExpiresAt: refreshed.expiresAt,
    });
    return refreshed;
  }

  private async ensurePushChannels(credentials: CalendarCredentials, calendarIds: string[]) {
    const configuration = googleCalendarConfiguration(this.runtime);
    if (!configuration?.webhookSecret) throw new ProviderFailure("missing_configuration", false);
    const uniqueCalendarIds = [...new Set(calendarIds)];
    const existing = await this.repository.listPushChannels();
    const renewalDeadline = Date.now() + 24 * 60 * 60 * 1_000;
    const current = existing.length === uniqueCalendarIds.length
      && uniqueCalendarIds.every((calendarId) => existing.some((channel) => channel.calendarId === calendarId && Date.parse(channel.expiresAt) > renewalDeadline));
    if (current) return false;
    const channels = await this.calendar.watchCalendars(credentials.accessToken, {
      calendarIds: uniqueCalendarIds,
      callbackUrl: new URL("/api/webhooks/google-calendar", this.runtime.APP_URL).toString(),
      channelToken: configuration.webhookSecret,
    });
    await this.repository.replacePushChannels(channels);
    const stopped = await Promise.allSettled(existing.map((channel) =>
      this.calendar.stopWatch(credentials.accessToken, { providerChannelId: channel.providerChannelId, providerResourceId: channel.providerResourceId }),
    ));
    for (const result of stopped) {
      if (result.status === "rejected") {
        // The replacement channel is authoritative in D1. Keep the failure
        // observable without accepting callbacks from the stale channel.
        console.warn("Google Calendar did not stop a replaced push channel", failureCode(result.reason));
      }
    }
    return true;
  }

  private async markFailure(error: unknown) {
    const connection = await this.repository.get();
    if (!connection || connection.status === "disconnected") return;
    await this.repository.markUnhealthy(failureCode(error));
    // The failing request still answers fail-closed; the scheduled pass asks again if scheduling itself failed.
    if (connection.status === "healthy" && this.watch) await this.tellWatch("sighting");
  }

  /** Asks for NOTIFY-007's confirmation check; an incident already pending keeps its deadline. */
  requestConfirmation() {
    return this.tellWatch("stillFailing");
  }

  private async tellWatch(event: keyof ConnectionWatchObservers) {
    try {
      if (!this.watch) throw new Error("no connection watch is attached");
      await this.watch[event]();
    } catch (watching) { console.error(`NOTIFY-007 connection watch was not told: ${event}`, watching); }
  }
}

function callbackUrl(runtime: RuntimeEnvironment) {
  return new URL("/api/calendar/oauth/callback", runtime.APP_URL).toString();
}
