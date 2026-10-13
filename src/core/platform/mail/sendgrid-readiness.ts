import { ProviderFailure } from "../calendar/types";

const pageSize = 100;
const maximumDomains = 3_000;
type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);

/** Read-only account evidence: exact Single Sender or exact authenticated domain. */
export async function isSendGridSenderVerified(from: string, domain: string, read: (url: string) => Promise<unknown>) {
  const senders = await read("https://api.sendgrid.com/v3/verified_senders");
  if (!isRecord(senders) || !Array.isArray(senders.results) || !senders.results.every((item) => isRecord(item) && typeof item.from_email === "string" && typeof item.verified === "boolean")) {
    throw new ProviderFailure("invalid_provider_response", false);
  }
  if (senders.results.some((item) => item.from_email.toLowerCase() === from.toLowerCase() && item.verified === true)) return true;

  // SendGrid documents limit/offset pagination and at most 3,000 domains per user:
  // https://www.twilio.com/docs/sendgrid/api-reference/domain-authentication/list-all-authenticated-domains
  const senderDomain = domain.toLowerCase();
  for (let offset = 0; offset < maximumDomains; offset += pageSize) {
    const domains = await read(`https://api.sendgrid.com/v3/whitelabel/domains?limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(domains) || domains.length > pageSize || !domains.every((item) => isRecord(item) && typeof item.domain === "string" && typeof item.valid === "boolean")) {
      throw new ProviderFailure("invalid_provider_response", false);
    }
    if (domains.some((item) => item.domain.toLowerCase() === senderDomain && item.valid === true)) return true;
    if (domains.length < pageSize) return false;
  }
  return false;
}
