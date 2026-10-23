import { ProviderFailure } from "./types";
import { isRecord, requestJsonWithTimeout, requestOptionalJsonWithTimeout, requestWithTimeout } from "./google-wire";
export { isRecord };
export const graphBase = "https://graph.microsoft.com/v1.0";
export const microsoftScopes = "offline_access Calendars.ReadWrite OnlineMeetings.ReadWrite User.Read";

/** Opaque next/delta links may carry secrets: only send the bearer to Graph. */
export function graphUrl(value: string) {
  const url = new URL(value);
  if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/") || url.username || url.password || url.hash) throw new ProviderFailure("invalid_provider_response", false);
  return url.toString();
}
export class MicrosoftWire {
  constructor(readonly request: typeof fetch) {}
  json(token: string, url: string, init?: RequestInit) { return requestJsonWithTimeout(this.request, graphUrl(url), this.authorized(token, init)); }
  optional(token: string, url: string) { return requestOptionalJsonWithTimeout(this.request, graphUrl(url), this.authorized(token)); }
  send(token: string, url: string, init: RequestInit) { return requestWithTimeout(this.request, graphUrl(url), this.authorized(token, init)); }
  private authorized(token: string, init?: RequestInit): RequestInit {
    const headers = new Headers(init?.headers); headers.set("authorization", `Bearer ${token}`); headers.set("Prefer", 'outlook.timezone="UTC", IdType="ImmutableId"');
    return { ...init, headers };
  }
}
export async function graphPages(wire: MicrosoftWire, token: string, url: string) {
  const values: unknown[] = [], seen = new Set<string>();
  let next: string | undefined = url;
  while (next) {
    if (seen.has(next) || seen.size >= 100) throw new ProviderFailure("invalid_provider_response", false);
    seen.add(next); const body = await wire.json(token, next);
    if (!Array.isArray(body.value)) throw new ProviderFailure("invalid_provider_response", false);
    values.push(...body.value); next = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : undefined;
  }
  return values;
}
export function graphInstant(value: unknown) {
  if (!isRecord(value) || typeof value.dateTime !== "string" || typeof value.timeZone !== "string") throw new ProviderFailure("invalid_provider_response", false);
  // All reads request UTC. Never interpret an unzoned provider time in the Worker's local zone.
  if (!["UTC", "Etc/UTC"].includes(value.timeZone)) throw new ProviderFailure("invalid_provider_response", false);
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value.dateTime) ? value.dateTime : `${value.dateTime}Z`);
  if (!Number.isFinite(date.valueOf())) throw new ProviderFailure("invalid_provider_response", false);
  return date.toISOString();
}
