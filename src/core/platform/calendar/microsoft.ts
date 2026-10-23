import { ProviderFailure, type CalendarAdapter, type CalendarCredentials, type CalendarPushChannel, type ManagedCalendarEvent, type ManagedEventInspection } from "./types";
import { requestJsonWithTimeout } from "./google-wire";
import { graphBase, graphPages, MicrosoftWire, microsoftScopes } from "./microsoft-wire";
import { microsoftBusy, microsoftDescriptor } from "./microsoft-busy";
import { calendarEvents, eventExpansion, findMicrosoftEvent, microsoftChange, microsoftPayload, microsoftResult } from "./microsoft-events";
import { microsoftSync } from "./microsoft-sync";
export type MicrosoftCalendarConfiguration = { clientId: string; clientSecret: string };
const authority = "https://login.microsoftonline.com/common/oauth2/v2.0";
export class MicrosoftCalendarAdapter implements CalendarAdapter {
  private readonly wire: MicrosoftWire;
  constructor(private readonly configuration: MicrosoftCalendarConfiguration | undefined, private readonly request: typeof fetch = fetch) { this.wire = new MicrosoftWire(request); }
  authorizationUrl(redirectUri: string, state: string) {
    if (!this.configuration) throw new ProviderFailure("missing_configuration", false);
    const url = new URL(`${authority}/authorize`);
    for (const [key, value] of Object.entries({ client_id: this.configuration.clientId, redirect_uri: redirectUri, response_type: "code", response_mode: "query", scope: microsoftScopes, state })) url.searchParams.set(key, value);
    return url.toString();
  }
  exchangeAuthorizationCode(code: string, redirectUri: string) { return this.token({ code, redirect_uri: redirectUri, grant_type: "authorization_code" }); }
  refreshAccessToken(refreshToken: string) { return this.token({ refresh_token: refreshToken, grant_type: "refresh_token" }); }
  async listCalendars(token: string) { return (await graphPages(this.wire, token, `${graphBase}/me/calendars`)).map(microsoftDescriptor); }
  async checkDestination(token: string, calendarId: string) { const result = microsoftDescriptor(await this.wire.json(token, `${graphBase}/me/calendars/${encodeURIComponent(calendarId)}`)); if (result.accessRole !== "writer") throw new ProviderFailure("forbidden", false); return result; }
  readBusy(token: string, input: Parameters<CalendarAdapter["readBusy"]>[1]) { return microsoftBusy(this.wire, token, input); }
  async upsertManagedEvent(token: string, calendarId: string, event: ManagedCalendarEvent) {
    const existing = await findMicrosoftEvent(this.wire, token, calendarId, event.bookingId);
    if (existing && (typeof existing.id !== "string" || typeof existing["@odata.etag"] !== "string")) throw new ProviderFailure("invalid_provider_response", false);
    const body = await this.wire.json(token, existing ? `${calendarEvents(calendarId)}/${encodeURIComponent(existing.id as string)}` : calendarEvents(calendarId), {
      method: existing ? "PATCH" : "POST", headers: { "content-type": "application/json", ...(existing ? { "if-match": existing["@odata.etag"] as string } : {}) }, body: JSON.stringify(microsoftPayload(event, Boolean(existing))),
    });
    return microsoftResult(body);
  }
  async inspectManagedEvent(token: string, calendarId: string, input: { bookingId: string; providerEventId: string }): Promise<ManagedEventInspection> {
    const event = await this.wire.optional(token, `${calendarEvents(calendarId)}/${encodeURIComponent(input.providerEventId)}?$expand=${eventExpansion}`);
    if (event && event.id !== input.providerEventId) return { kind: "unresolved", code: "identity_missing" };
    if (event && event.isCancelled !== true) { const fact = microsoftChange(event); return fact?.kind === "changed" && fact.bookingId === input.bookingId ? { kind: "present", event: fact } : { kind: "unresolved", code: "identity_missing" }; }
    // A fresh successful calendar list proves both permission and absence before a tombstone can cancel.
    const replacement = await findMicrosoftEvent(this.wire, token, calendarId, input.bookingId);
    if (!replacement) return { kind: "deleted", providerEventId: input.providerEventId };
    const fact = microsoftChange(replacement);
    return fact?.kind === "changed" && fact.bookingId === input.bookingId ? { kind: "present", event: fact } : { kind: "unresolved", code: "identity_missing" };
  }
  async cancelManagedEvent(token: string, calendarId: string, bookingId: string) {
    const existing = await findMicrosoftEvent(this.wire, token, calendarId, bookingId); if (!existing) return;
    if (typeof existing.id !== "string" || typeof existing["@odata.etag"] !== "string") throw new ProviderFailure("invalid_provider_response", false);
    await this.wire.send(token, `${calendarEvents(calendarId)}/${encodeURIComponent(existing.id)}`, { method: "DELETE", headers: { "if-match": existing["@odata.etag"] } });
  }
  syncManagedEvents(token: string, calendarId: string, cursor?: string) { return microsoftSync(this.wire, token, calendarId, cursor); }
  async watchCalendars(token: string, input: { calendarIds: string[]; callbackUrl: string; channelToken: string }): Promise<CalendarPushChannel[]> {
    return Promise.all(input.calendarIds.map(async calendarId => {
      const resource = "me/events";
      const body = await this.wire.json(token, `${graphBase}/subscriptions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeType: "created,updated,deleted", notificationUrl: input.callbackUrl, resource, expirationDateTime: new Date(Date.now() + 2 * 86400000).toISOString(), clientState: input.channelToken }) });
      if (typeof body.id !== "string" || typeof body.expirationDateTime !== "string" || !Number.isFinite(Date.parse(body.expirationDateTime))) throw new ProviderFailure("invalid_provider_response", false);
      return { calendarId, providerChannelId: body.id, providerResourceId: resource, expiresAt: body.expirationDateTime };
    }));
  }
  async stopWatch(token: string, input: { providerChannelId: string }) { await this.wire.send(token, `${graphBase}/subscriptions/${encodeURIComponent(input.providerChannelId)}`, { method: "DELETE" }); }
  private async token(values: Record<string, string>): Promise<CalendarCredentials> {
    if (!this.configuration) throw new ProviderFailure("missing_configuration", false);
    let value: Record<string, unknown>;
    try { value = await requestJsonWithTimeout(this.request, `${authority}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...values, client_id: this.configuration.clientId, client_secret: this.configuration.clientSecret, scope: microsoftScopes }) }); }
    catch (error) { if (values.grant_type === "refresh_token" && error instanceof ProviderFailure && error.code === "provider_unavailable" && !error.retryable) throw new ProviderFailure("reauthorization_required", false); throw error; }
    if (typeof value.access_token !== "string" || typeof value.expires_in !== "number" || value.expires_in <= 0 || (values.grant_type === "authorization_code" && typeof value.refresh_token !== "string")) throw new ProviderFailure("invalid_provider_response", false);
    return { accessToken: value.access_token, refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : values.refresh_token, expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString() };
  }
}
