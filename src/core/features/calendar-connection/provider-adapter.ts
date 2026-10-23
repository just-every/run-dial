import { GoogleCalendarAdapter, MicrosoftCalendarAdapter, ProviderFailure, type CalendarAdapter } from "../../platform/calendar";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { googleCalendarConfiguration } from "../../shared/runtime-env";
import type { CalendarConnectionRepository } from "./repository";
export type OAuthCalendarProvider = "google" | "microsoft";
export function providerAdapter(runtime: RuntimeEnvironment, provider: OAuthCalendarProvider, override?: CalendarAdapter) {
  if (override) return override;
  if (provider === "microsoft") { const { MICROSOFT_OAUTH_CLIENT_ID: clientId, MICROSOFT_OAUTH_CLIENT_SECRET: clientSecret } = runtime; return new MicrosoftCalendarAdapter(clientId && clientSecret ? { clientId, clientSecret } : undefined); }
  return new GoogleCalendarAdapter(googleCalendarConfiguration(runtime));
}
/** Every operation reads the durable provider: a reconnect cannot leave a cached Google adapter active. */
export function connectedAdapter(repository: CalendarConnectionRepository, runtime: RuntimeEnvironment, override?: CalendarAdapter): CalendarAdapter {
  const resolve = async () => { const provider = (await repository.get())?.provider ?? "google"; if (provider === "caldav") throw new ProviderFailure("missing_configuration", false); return providerAdapter(runtime, provider, override); };
  return {
    authorizationUrl: () => { throw new Error("OAuth requires an explicit provider"); },
    exchangeAuthorizationCode: async (...args) => (await resolve()).exchangeAuthorizationCode(...args),
    refreshAccessToken: async (...args) => (await resolve()).refreshAccessToken(...args),
    listCalendars: async (...args) => (await resolve()).listCalendars(...args),
    checkDestination: async (...args) => (await resolve()).checkDestination(...args),
    readBusy: async (...args) => (await resolve()).readBusy(...args),
    upsertManagedEvent: async (...args) => (await resolve()).upsertManagedEvent(...args),
    inspectManagedEvent: async (...args) => (await resolve()).inspectManagedEvent(...args),
    cancelManagedEvent: async (...args) => (await resolve()).cancelManagedEvent(...args),
    syncManagedEvents: async (...args) => (await resolve()).syncManagedEvents(...args),
    watchCalendars: async (...args) => (await resolve()).watchCalendars(...args),
    stopWatch: async (...args) => (await resolve()).stopWatch(...args),
  };
}
export function providerConfigured(runtime: RuntimeEnvironment, provider: OAuthCalendarProvider) {
  return provider === "microsoft" ? Boolean(runtime.MICROSOFT_OAUTH_CLIENT_ID && runtime.MICROSOFT_OAUTH_CLIENT_SECRET) : Boolean(googleCalendarConfiguration(runtime));
}
