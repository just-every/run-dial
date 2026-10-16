import { ProviderFailure } from "../calendar/types";

// Only lookup locations survive a request. Every use must obtain fresh provider
// evidence with the current credential; no health result is cached.
// https://www.twilio.com/docs/sendgrid/api-reference/domain-authentication/retrieve-an-authenticated-domain
const domains = new Map<string, number>();

export async function sendGridLookupKey(apiKey: string, from: string) {
  const bytes = new TextEncoder().encode(JSON.stringify([apiKey, from.toLowerCase()]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function rememberSendGridDomain(key: string, id: unknown) {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return;
  if (domains.size >= 64 && !domains.has(key)) domains.delete(domains.keys().next().value!);
  domains.set(key, id);
}

export async function readKnownSendGridDomain(key: string, domain: string, read: (url: string) => Promise<unknown>) {
  const id = domains.get(key);
  if (id === undefined) return undefined;
  try {
    const result = await read(`https://api.sendgrid.com/v3/whitelabel/domains/${id}`);
    if (!result || typeof result !== "object" || Array.isArray(result) || !("domain" in result) || typeof result.domain !== "string" || !("valid" in result) || typeof result.valid !== "boolean") {
      throw new ProviderFailure("invalid_provider_response", false);
    }
    if (result.domain.toLowerCase() !== domain.toLowerCase() || !result.valid) { domains.delete(key); return false; }
    return true;
  } catch (error) {
    domains.delete(key);
    // Fail this check. A later explicit check can discover changed identities;
    // a refused lookup never triggers retries or another credentialed endpoint.
    throw error;
  }
}
