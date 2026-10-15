// @ts-expect-error Base's portable ESM distribution has no TypeScript declaration.
import { createMailSender } from "../../../../modules/mail/index.mjs";
import { ProviderFailure } from "../calendar/types";

export type BaseMessage = { deliveryId: string; from: string; to: string[]; subject: string; text: string; html?: string; replyTo?: string; headers?: Record<string, string>; attachments?: { filename: string; contentType: string; content: Uint8Array }[] };
export type BaseResult = { status: "accepted" | "development" | "rejected" | "rate_limited" | "uncertain"; provider: string; providerMessageId: string | null; code?: string; retryAfterSeconds?: number };
export type BaseSender = { send(message: BaseMessage): Promise<BaseResult> };
type RelayConfig = { apiKey?: string; relayUrl?: string };

/** Base owns serialization and transport. Keep only safe response metadata for Dial's queue. */
export function managedRelaySender(config: RelayConfig, request: typeof fetch): BaseSender {
  // Validate even when used only for readiness, before any credential can leave.
  createMailSender({ provider: "rer", mode: "production", ...config });
  return { async send(message) {
    let status: number | undefined, retryAfterSeconds: number | undefined;
    const sender = createMailSender({ provider: "rer", mode: "production", ...config }, { fetch: async (url: string, init: RequestInit) => {
      const response = await request(url, init);
      status = response.status;
      const value = response.headers.get("Retry-After");
      if (status === 429 && value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) retryAfterSeconds = Math.min(Number(value), 86_400);
      return response;
    } }) as BaseSender;
    const result = await sender.send(message);
    return { ...result, ...(status === 401 ? { code: "unauthorized" } : {}), ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
  } };
}

/** The relay authenticates and checks hosting before rejecting an empty message.
 * This read-only probe consumes no send allowance and never sends test mail. */
export async function checkManagedRelay(config: RelayConfig, request: typeof fetch) {
  try { managedRelaySender(config, request); }
  catch { throw new ProviderFailure("missing_configuration", false); }
  let response: Response;
  try {
    response = await request(config.relayUrl!, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: "{}" });
  } catch { throw new ProviderFailure("provider_unavailable", true); }
  if (response.status !== 400) throw new ProviderFailure(response.status === 401 ? "unauthorized" : [402, 403].includes(response.status) ? "forbidden" : "provider_unavailable", response.status >= 500);
  return { checkedAt: new Date().toISOString() };
}
