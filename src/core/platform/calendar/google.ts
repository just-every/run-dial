// @ts-expect-error Base's effects module is portable ESM; the public declaration lives in demo/index.d.mts.
import { fetchDemoRead } from "../../../../modules/demo/effects.mjs";
import { inspectGoogleManagedEvent } from "./google-inspection";
import type {
  CalendarAdapter,
  CalendarCredentials,
  GoogleCalendarDescriptor,
  ManagedCalendarEvent,
  ManagedCalendarEventResult,
  CalendarPushChannel,
} from "./types";
import { ProviderFailure } from "./types";
import { busyReadFromGoogle } from "./google-busy";
import { googleEventPayload, managedResult } from "./google-managed-events";
import { syncGoogleManagedEvents } from "./google-sync";
import { isRecord, requestJsonWithTimeout, requestOptionalJsonWithTimeout, requestWithTimeout } from "./google-wire";

const googleTokenUrl = "https://oauth2.googleapis.com/token";
const calendarApi = "https://www.googleapis.com/calendar/v3";
const calendarScope = "https://www.googleapis.com/auth/calendar";

export type GoogleCalendarConfiguration = { clientId: string; clientSecret: string };

export class GoogleCalendarAdapter implements CalendarAdapter {
  constructor(
    private readonly configuration: GoogleCalendarConfiguration | undefined,
    private readonly request: typeof fetch = fetch,
    private readonly busyReadTimeoutMs = 5_000,
  ) {}

  authorizationUrl(redirectUri: string, state: string) {
    if (!this.configuration) throw new ProviderFailure("missing_configuration", false);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.configuration.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", calendarScope);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<CalendarCredentials> {
    return this.token({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  }

  async refreshAccessToken(refreshToken: string): Promise<CalendarCredentials> {
    return this.token({ refresh_token: refreshToken, grant_type: "refresh_token" });
  }

  async listCalendars(accessToken: string): Promise<GoogleCalendarDescriptor[]> {
    const body = await this.authorizedJson(accessToken, `${calendarApi}/users/me/calendarList?minAccessRole=freeBusyReader`);
    const items = Array.isArray(body.items) ? body.items : [];
    return items.map(descriptorFrom).filter((value): value is GoogleCalendarDescriptor => value !== undefined);
  }

  async checkDestination(accessToken: string, calendarId: string): Promise<GoogleCalendarDescriptor> {
    const descriptor = descriptorFrom(await this.authorizedJson(accessToken, `${calendarApi}/users/me/calendarList/${encodeURIComponent(calendarId)}`));
    if (!descriptor || !["writer", "owner"].includes(descriptor.accessRole)) throw new ProviderFailure("forbidden", false);
    return descriptor;
  }

  async readBusy(accessToken: string, input: { calendarIds: string[]; startsAt: string; endsAt: string; timeZone: string }) {
    if (input.calendarIds.length === 0) throw new ProviderFailure("invalid_provider_response", false);
    const body = await requestJsonWithTimeout(this.request === globalThis.fetch ? fetchDemoRead : this.request, `${calendarApi}/freeBusy`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        timeMin: input.startsAt,
        timeMax: input.endsAt,
        timeZone: input.timeZone,
        calendarExpansionMax: 50,
        items: input.calendarIds.map((id) => ({ id })),
      }),
    }, this.busyReadTimeoutMs);
    return busyReadFromGoogle(body, input.calendarIds);
  }

  async upsertManagedEvent(accessToken: string, calendarId: string, event: ManagedCalendarEvent): Promise<ManagedCalendarEventResult> {
    const existing = await this.findManagedEvent(accessToken, calendarId, event.bookingId);
    const payload = { ...googleEventPayload(event, Boolean(existing?.conferenceData) && !conferenceFailed(existing?.conferenceData), false), ...(!existing ? { id: await managedEventId(event.bookingId) } : {}) };
    const url = existing
      ? `${calendarApi}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing.id)}?conferenceDataVersion=1&sendUpdates=all`
      : `${calendarApi}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
    const body = await this.authorizedJson(accessToken, url, {
      method: existing ? "PATCH" : "POST",
      headers: { "content-type": "application/json", ...(existing ? { "if-match": existing.etag } : {}) },
      body: JSON.stringify(payload),
    });
    return managedResult(body);
  }

  async inspectManagedEvent(accessToken: string, calendarId: string, input: { bookingId: string; providerEventId: string }) {
    return inspectGoogleManagedEvent({ calendarApi, calendarId, ...input,
      readEvent: (url) => requestOptionalJsonWithTimeout(this.request, url, { headers: { authorization: `Bearer ${accessToken}` } }),
      readList: (url) => this.authorizedJson(accessToken, url),
    });
  }

  async cancelManagedEvent(accessToken: string, calendarId: string, bookingId: string): Promise<void> {
    const existing = await this.findManagedEvent(accessToken, calendarId, bookingId);
    if (!existing) return;
    await this.authorized(
      accessToken,
      `${calendarApi}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing.id)}?sendUpdates=all`,
      { method: "PATCH", headers: { "content-type": "application/json", "if-match": existing.etag }, body: JSON.stringify({ status: "cancelled" }) },
    );
  }

  /**
   * Sync the destination event collection with a Google-issued cursor. Google
   * does not permit privateExtendedProperty with syncToken, so the request
   * asks for a field projection only and discards every non-Dial event before
   * it leaves this adapter.
   */
  async syncManagedEvents(accessToken: string, calendarId: string, syncCursor?: string) {
    return syncGoogleManagedEvents({
      calendarApi,
      calendarId,
      syncCursor,
      readPage: async (url) => this.authorizedJson(accessToken, url.toString()),
    });
  }

  async watchCalendars(accessToken: string, input: { calendarIds: string[]; callbackUrl: string; channelToken: string }): Promise<CalendarPushChannel[]> {
    return Promise.all(input.calendarIds.map(async (calendarId) => {
      const providerChannelId = `dial-${crypto.randomUUID()}`;
      const body = await this.authorizedJson(
        accessToken,
        `${calendarApi}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: providerChannelId, type: "web_hook", address: input.callbackUrl, token: input.channelToken }),
        },
      );
      if (typeof body.resourceId !== "string" || (typeof body.expiration !== "string" && typeof body.expiration !== "number")) {
        throw new ProviderFailure("invalid_provider_response", false);
      }
      const expirationMs = typeof body.expiration === "number" ? body.expiration : Number(body.expiration);
      if (!Number.isFinite(expirationMs)) throw new ProviderFailure("invalid_provider_response", false);
      return { calendarId, providerChannelId, providerResourceId: body.resourceId, expiresAt: new Date(expirationMs).toISOString() };
    }));
  }

  async stopWatch(accessToken: string, input: { providerChannelId: string; providerResourceId: string }): Promise<void> {
    await this.authorized(accessToken, `${calendarApi}/channels/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: input.providerChannelId, resourceId: input.providerResourceId }),
    });
  }

  private async findManagedEvent(accessToken: string, calendarId: string, bookingId: string): Promise<{ id: string; etag: string; conferenceData?: Record<string, unknown> } | undefined> {
    const url = new URL(`${calendarApi}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("privateExtendedProperty", `dial-booking-id=${bookingId}`);
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("maxResults", "2");
    const body = await this.authorizedJson(accessToken, url.toString());
    const items = Array.isArray(body.items) ? body.items : [];
    const events = items.filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === "string");
    if (events.length > 1) throw new ProviderFailure("invalid_provider_response", false);
    const event = events[0];
    if (event && typeof event.etag !== "string") throw new ProviderFailure("invalid_provider_response", false);
    return event ? { id: event.id as string, etag: event.etag as string, conferenceData: isRecord(event.conferenceData) ? event.conferenceData : undefined } : undefined;
  }

  private async token(values: Record<string, string>): Promise<CalendarCredentials> {
    if (!this.configuration) throw new ProviderFailure("missing_configuration", false);
    const body = new URLSearchParams({ ...values, client_id: this.configuration.clientId, client_secret: this.configuration.clientSecret });
    let value: Record<string, unknown>;
    try { value = await requestJsonWithTimeout(this.request, googleTokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }); }
    catch (error) {
      // Google refuses a revoked or expired refresh token with 400 invalid_grant: only the owner's consent can restore it.
      if (values.grant_type === "refresh_token" && error instanceof ProviderFailure && error.code === "provider_unavailable" && !error.retryable) throw new ProviderFailure("reauthorization_required", false);
      throw error;
    }
    if (typeof value.access_token !== "string" || typeof value.expires_in !== "number") throw new ProviderFailure("invalid_provider_response", false);
    if (values.grant_type === "authorization_code" && typeof value.refresh_token !== "string") throw new ProviderFailure("invalid_provider_response", false);
    return {
      accessToken: value.access_token,
      refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : values.refresh_token,
      expiresAt: new Date(Date.now() + value.expires_in * 1_000).toISOString(),
    };
  }

  private async authorized(accessToken: string, input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number) {
    return requestWithTimeout(this.request, input, {
      ...init,
      headers: { ...init?.headers, authorization: `Bearer ${accessToken}` },
    }, timeoutMs);
  }

  private authorizedJson(accessToken: string, input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number) {
    return requestJsonWithTimeout(this.request, input, {
      ...init,
      headers: { ...init?.headers, authorization: `Bearer ${accessToken}` },
    }, timeoutMs);
  }
}

function descriptorFrom(value: unknown): GoogleCalendarDescriptor | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !isAccessRole(value.accessRole)) return undefined;
  const conferenceProperties = isRecord(value.conferenceProperties) ? value.conferenceProperties : undefined;
  const allowedConferenceSolutionTypes = Array.isArray(conferenceProperties?.allowedConferenceSolutionTypes)
    ? conferenceProperties.allowedConferenceSolutionTypes
    : [];
  return {
    id: value.id,
    accessRole: value.accessRole,
    primary: value.primary === true,
    conferenceCapable: allowedConferenceSolutionTypes.includes("hangoutsMeet"),
  };
}

function isAccessRole(value: unknown): value is GoogleCalendarDescriptor["accessRole"] {
  return value === "freeBusyReader" || value === "reader" || value === "writer" || value === "owner" || value === "none";
}

async function managedEventId(bookingId: string) { const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`dial-booking:${bookingId}`))); return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

function conferenceFailed(data: Record<string, unknown> | undefined) { return isRecord(data?.createRequest) && isRecord(data.createRequest.status) && data.createRequest.status.statusCode === "failure"; }
