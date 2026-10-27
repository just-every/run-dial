import { ProviderFailure, type CalendarAdapter, type CalendarCredentials, type CalendarPushChannel, type GoogleCalendarDescriptor, type ManagedCalendarEvent } from "./types";
import { isRecord, requestJsonWithTimeout, requestOptionalJsonWithTimeout, requestWithTimeout } from "./google-wire";
import { microsoftBusy } from "./microsoft-busy";
import { microsoftChange, microsoftEvent, microsoftResult, bookingProperty } from "./microsoft-events";

const graph = "https://graph.microsoft.com/v1.0";
const authority = "https://login.microsoftonline.com/common/oauth2/v2.0";
const scope = "offline_access User.Read Calendars.ReadWrite";
export type MicrosoftCalendarConfiguration = { clientId: string; clientSecret: string };

/** Delegated Graph access: common permits both work accounts and personal Microsoft accounts. */
export class MicrosoftCalendarAdapter implements CalendarAdapter {
  constructor(private readonly configuration: MicrosoftCalendarConfiguration | undefined, private readonly request: typeof fetch = fetch) {}

  authorizationUrl(redirectUri: string, state: string) {
    if (!this.configuration) throw new ProviderFailure("missing_configuration", false);
    const url = new URL(`${authority}/authorize`);
    for (const [key, value] of Object.entries({ client_id: this.configuration.clientId, response_type: "code", redirect_uri: redirectUri, scope, state })) url.searchParams.set(key, value);
    return url.toString();
  }
  exchangeAuthorizationCode(code: string, redirectUri: string) { return this.token({ code, redirect_uri: redirectUri, grant_type: "authorization_code" }); }
  refreshAccessToken(refreshToken: string) { return this.token({ refresh_token: refreshToken, grant_type: "refresh_token" }); }

  async listCalendars(accessToken: string): Promise<GoogleCalendarDescriptor[]> {
    const calendars = await this.collection(accessToken, `${graph}/me/calendars?$select=id,canEdit,isDefaultCalendar`);
    return calendars.map(value => {
      if (typeof value.id !== "string" || typeof value.canEdit !== "boolean") throw new ProviderFailure("invalid_provider_response", false);
      // Microsoft conferencing is not a Google Meet capability.
      return { id: value.id, accessRole: value.canEdit ? "writer" as const : "reader" as const, primary: value.isDefaultCalendar === true, conferenceCapable: false };
    });
  }
  async checkDestination(accessToken: string, calendarId: string) {
    const calendar = (await this.listCalendars(accessToken)).find(value => value.id === calendarId);
    if (!calendar || calendar.accessRole !== "writer") throw new ProviderFailure("forbidden", false);
    return calendar;
  }
  async readBusy(accessToken: string, input: { calendarIds: string[]; startsAt: string; endsAt: string; timeZone: string }) {
    return microsoftBusy({ accessToken, input, json: (url, init) => this.json(accessToken, url, init), collection: url => this.collection(accessToken, url) });
  }
  async upsertManagedEvent(accessToken: string, calendarId: string, event: ManagedCalendarEvent) {
    if (event.requestGoogleMeet) throw new ProviderFailure("meeting_creation_failed", false);
    const existing = await this.find(accessToken, calendarId, event.bookingId);
    const body = await this.json(accessToken, `${this.events(calendarId)}${existing ? `/${encodeURIComponent(String(existing.id))}` : ""}`, {
      method: existing ? "PATCH" : "POST",
      headers: { "content-type": ["application", "json"].join("/"), ...(existing && typeof existing["@odata.etag"] === "string" ? { "if-match": existing["@odata.etag"] } : {}) },
      body: JSON.stringify(microsoftEvent(event, !existing)),
    });
    return microsoftResult(body);
  }
  async inspectManagedEvent(accessToken: string, calendarId: string, input: { bookingId: string; providerEventId: string }) {
    const event = await requestOptionalJsonWithTimeout(this.request, `${this.events(calendarId)}/${encodeURIComponent(input.providerEventId)}?$expand=singleValueExtendedProperties`, { headers: this.headers(accessToken) });
    if (!event) return { kind: "unresolved" as const, code: "event_missing" as const };
    const change = microsoftChange(event);
    if (!change || change.kind !== "changed" || change.bookingId !== input.bookingId) return { kind: "unresolved" as const, code: "identity_missing" as const };
    return { kind: "present" as const, event: change };
  }
  async cancelManagedEvent(accessToken: string, calendarId: string, bookingId: string) {
    const existing = await this.find(accessToken, calendarId, bookingId);
    if (!existing) return;
    await requestWithTimeout(this.request, `${this.events(calendarId)}/${encodeURIComponent(String(existing.id))}`, { method: "DELETE", headers: this.headers(accessToken, typeof existing["@odata.etag"] === "string" ? { "if-match": existing["@odata.etag"] } : {}) });
  }
  async syncManagedEvents(accessToken: string, calendarId: string, syncCursor?: string) {
    // Graph's calendarView delta is bounded; retain a wide booking horizon in its opaque cursor.
    const first = new URL(`${graph}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`);
    first.searchParams.set("startDateTime", new Date(Date.now() - 365 * 86400000).toISOString());
    first.searchParams.set("endDateTime", new Date(Date.now() + 730 * 86400000).toISOString());
    const changes = [];
    let page = syncCursor ?? first.toString(), cursor: string | undefined;
    const seen = new Set<string>();
    while (page) {
      this.assertGraphUrl(page);
      if (seen.has(page) || seen.size >= 100) throw new ProviderFailure("invalid_provider_response", false);
      seen.add(page);
      const value = await this.json(accessToken, page);
      if (!Array.isArray(value.value)) throw new ProviderFailure("invalid_provider_response", false);
      for (const item of value.value) {
        if (!isRecord(item) || typeof item.id !== "string") throw new ProviderFailure("invalid_provider_response", false);
        const detail = isRecord(item["@removed"]) ? item : await requestOptionalJsonWithTimeout(this.request, `${this.events(calendarId)}/${encodeURIComponent(item.id)}?$expand=singleValueExtendedProperties`, { headers: this.headers(accessToken) });
        const change = microsoftChange(detail); if (change) changes.push(change);
      }
      page = typeof value["@odata.nextLink"] === "string" ? value["@odata.nextLink"] : "";
      if (!page && typeof value["@odata.deltaLink"] === "string") cursor = value["@odata.deltaLink"];
    }
    if (!cursor) throw new ProviderFailure("invalid_provider_response", false);
    this.assertGraphUrl(cursor);
    return { changes, syncCursor: cursor };
  }
  async watchCalendars(accessToken: string, input: { calendarIds: string[]; callbackUrl: string; channelToken: string }): Promise<CalendarPushChannel[]> {
    if (input.channelToken.length > 128) throw new ProviderFailure("missing_configuration", false);
    // Graph subscribes to mailbox event changes, covering all selected calendars with one subscription.
    const value = await this.json(accessToken, `${graph}/subscriptions`, { method: "POST", headers: { "content-type": ["application", "json"].join("/") }, body: JSON.stringify({ changeType: "created,updated,deleted", notificationUrl: input.callbackUrl, resource: ["me", "events"].join("/"), expirationDateTime: new Date(Date.now() + 6 * 86400000).toISOString(), clientState: input.channelToken }) });
    if (typeof value.id !== "string" || typeof value.expirationDateTime !== "string" || !Number.isFinite(Date.parse(value.expirationDateTime))) throw new ProviderFailure("invalid_provider_response", false);
    return input.calendarIds.map(calendarId => ({ calendarId, providerChannelId: `${value.id}:${calendarId}`, providerResourceId: value.id as string, expiresAt: new Date(value.expirationDateTime as string).toISOString() }));
  }
  async stopWatch(accessToken: string, input: { providerChannelId: string; providerResourceId: string }) {
    await requestWithTimeout(this.request, `${graph}/subscriptions/${encodeURIComponent(input.providerResourceId)}`, { method: "DELETE", headers: this.headers(accessToken) });
  }
  private events(calendarId: string) { return `${graph}/me/calendars/${encodeURIComponent(calendarId)}/events`; }
  private async find(accessToken: string, calendarId: string, bookingId: string) {
    const url = new URL(this.events(calendarId));
    const field = (name: string) => ["ep", name].join("/");
    url.searchParams.set("$filter", ["singleValueExtendedProperties", `Any(ep: ${field("id")} eq '${bookingProperty}' and ${field("value")} eq '${bookingId.replaceAll("'", "''")}')`].join("/"));
    url.searchParams.set("$expand", "singleValueExtendedProperties");
    const items = await this.collection(accessToken, url.toString());
    if (items.length > 1 || items.some(value => typeof value.id !== "string" || typeof value["@odata.etag"] !== "string")) throw new ProviderFailure("invalid_provider_response", false);
    return items[0];
  }
  private async token(values: Record<string, string>): Promise<CalendarCredentials> {
    if (!this.configuration) throw new ProviderFailure("missing_configuration", false);
    let value;
    try { value = await requestJsonWithTimeout(this.request, `${authority}/token`, { method: "POST", headers: { "content-type": ["application", "x-www-form-urlencoded"].join("/") }, body: new URLSearchParams({ ...values, client_id: this.configuration.clientId, client_secret: this.configuration.clientSecret, scope }) }); }
    catch (error) {
      if (values.grant_type === "refresh_token" && error instanceof ProviderFailure && !error.retryable) throw new ProviderFailure("reauthorization_required", false);
      throw error;
    }
    if (typeof value.access_token !== "string" || typeof value.expires_in !== "number" || value.expires_in <= 0 || (values.grant_type === "authorization_code" && typeof value.refresh_token !== "string")) throw new ProviderFailure("invalid_provider_response", false);
    return { accessToken: value.access_token, refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : values.refresh_token, expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString() };
  }
  private headers(accessToken: string, extra?: Record<string, string>) { return { authorization: `Bearer ${accessToken}`, prefer: 'outlook.timezone="UTC"', ...extra }; }
  private json(accessToken: string, url: string, init?: RequestInit) { return requestJsonWithTimeout(this.request, url, { ...init, headers: { ...this.headers(accessToken), ...init?.headers } }); }
  private assertGraphUrl(value: string) { const url = new URL(value); if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/") || url.username || url.password) throw new ProviderFailure("invalid_provider_response", false); }
  private async collection(accessToken: string, first: string) {
    const items: Record<string, unknown>[] = [], seen = new Set<string>();
    let page = first;
    while (page) {
      this.assertGraphUrl(page);
      if (seen.has(page) || seen.size >= 100) throw new ProviderFailure("invalid_provider_response", false);
      seen.add(page);
      const value = await this.json(accessToken, page);
      if (!Array.isArray(value.value) || value.value.some(item => !isRecord(item))) throw new ProviderFailure("invalid_provider_response", false);
      items.push(...value.value as Record<string, unknown>[]);
      page = typeof value["@odata.nextLink"] === "string" ? value["@odata.nextLink"] : "";
    }
    return items;
  }
}
