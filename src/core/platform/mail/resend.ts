import type { MailMessage, MailSender } from "./types";
import { checkMailProvider } from "./connection";
import { BaseMailSender } from "./base-mail";
import { ProviderFailure } from "../calendar/types";
// @ts-expect-error Base portable ESM has no declaration file.
import { verifyWebhook } from "../../../../modules/mail/index.mjs";
export type ResendConfiguration = { apiKey: string; fromEmail: string };

/** Existing product adapter signature delegates transport entirely to Base mail. */
export class ResendMailSender implements MailSender {
  constructor(private readonly configuration: ResendConfiguration | undefined, private readonly request: typeof fetch = fetch, private readonly timeoutMs = 10_000) {}
  async checkConnection() {
    return checkMailProvider({ provider: "resend", apiKey: this.configuration?.apiKey, from: this.configuration?.fromEmail }, this.request);
  }
  async send(message: MailMessage) {
    const state = { timedOut: false };
    const sender = new BaseMailSender(undefined, { RESEND_API_KEY: this.configuration?.apiKey, RESEND_FROM_EMAIL: this.configuration?.fromEmail }, boundedFetch(this.request, this.timeoutMs, state));
    try { return await sender.send(message); }
    catch (error) { if (state.timedOut) throw new ProviderFailure("provider_timeout", true); throw error; }
  }
}

/** Preserve Dial's bounded response-body deadline as well as Base's transport bound. */
function boundedFetch(request: typeof fetch, timeoutMs: number, state: { timedOut: boolean }): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => { state.timedOut = true; controller.abort(); reject(new ProviderFailure("provider_timeout", true)); }, timeoutMs); });
    try {
      return await Promise.race([expired, (async () => {
        const response = await request(input, { ...init, signal: controller.signal });
        const body = await Promise.race([response.arrayBuffer(), expired]);
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      })()]);
    } finally { clearTimeout(timer); }
  };
}
export async function verifyResendWebhook(rawBody: Uint8Array, headers: Headers, webhookSecret: string | undefined, now = Date.now()) {
  if (!webhookSecret) return false;
  return verifyWebhook({ provider: "resend", rawBody, headers, key: webhookSecret, now }) as Promise<boolean>;
}
