// Base mail has a JavaScript public API; this integration supplies the edition types.
// @ts-expect-error Base's portable ESM distribution has no TypeScript declaration.
import { createMailSender } from "../../../../modules/mail/index.mjs";
import { type MailSender as AuthMailSender } from "../../../../modules/operator-auth/index.mjs";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { ProviderFailure } from "../calendar/types";
import type { MailMessage, MailSender, MailSendResult } from "./types";
import { developmentOutbox, isLocalOutboxEnabled } from "./development";
import { checkMailProvider } from "./connection";

type BaseMessage = { deliveryId: string; from: string; to: string[]; subject: string; text: string; html?: string; replyTo?: string; headers?: Record<string, string>; attachments?: { filename: string; contentType: string; content: Uint8Array }[] };
type BaseResult = { status: "accepted" | "development" | "rejected" | "rate_limited" | "uncertain"; provider: string; providerMessageId: string | null; code?: string };
type BaseSender = { send(message: BaseMessage): Promise<BaseResult> };

type MailRuntime = Pick<RuntimeEnvironment, "MAIL_PROVIDER" | "MAIL_API_KEY" | "MAIL_FROM" | "MAIL_WEBHOOK_KEY" | "RESEND_API_KEY" | "RESEND_FROM_EMAIL"> & Partial<Pick<RuntimeEnvironment, "ENVIRONMENT" | "APP_URL">>;
export function mailConfiguration(runtime: MailRuntime) {
  if (runtime.MAIL_PROVIDER) return { provider: runtime.MAIL_PROVIDER, apiKey: runtime.MAIL_API_KEY, from: runtime.MAIL_FROM };
  // Existing installed Resend configuration retains its provider and delivery identities.
  return { provider: "resend" as const, apiKey: runtime.RESEND_API_KEY, from: runtime.RESEND_FROM_EMAIL };
}

export function createAuthenticationMail(db: D1Database, runtime: RuntimeEnvironment): AuthMailSender | undefined {
  if (isLocalOutboxEnabled(runtime)) {
    return createMailSender({ provider: "development", mode: "development" }, { outbox: developmentOutbox(db, runtime) }) as BaseSender;
  }
  if (runtime.MAIL_PROVIDER === "development") throw new Error("Development mail is unavailable outside a loopback development install");
  const config = mailConfiguration(runtime);
  if (!config.apiKey || !config.from) return undefined;
  return createMailSender({ provider: config.provider, apiKey: config.apiKey, mode: "production" }) as BaseSender;
}

export class BaseMailSender implements MailSender {
  constructor(private readonly db: D1Database | undefined, private readonly runtime: MailRuntime, private readonly request: typeof fetch = fetch) {}
  async checkConnection() {
    if (this.runtime.MAIL_PROVIDER === "sendgrid" && !this.runtime.MAIL_WEBHOOK_KEY) throw new ProviderFailure("missing_configuration", false);
    const config = mailConfiguration(this.runtime);
    if (config.provider === "development") {
      if (!this.db) throw new ProviderFailure("missing_configuration", false);
      await developmentOutbox(this.db, this.runtime).list();
      return { checkedAt: new Date().toISOString() };
    }
    return checkMailProvider(config as { provider: "resend" | "sendgrid"; apiKey?: string; from?: string }, this.request);
  }
  async send(message: MailMessage): Promise<MailSendResult> {
    const config = mailConfiguration(this.runtime);
    if ((!config.apiKey && config.provider !== "development") || !config.from) throw new ProviderFailure("missing_configuration", false);
    if (!/^no-?reply@/i.test(config.from)) throw new ProviderFailure("invalid_delivery_payload", false);
    const sender = config.provider === "development"
      ? createMailSender({ provider: "development", mode: "development" }, { outbox: developmentOutbox(this.db!, this.runtime) }) as BaseSender
      : createMailSender({ provider: config.provider, mode: "production", apiKey: config.apiKey }, { fetch: this.request }) as BaseSender;
    const wire: BaseMessage = { deliveryId: message.idempotencyKey, from: config.from, to: [message.to], subject: message.subject, text: message.text,
      ...(message.html ? { html: message.html } : {}), ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments.map((attachment) => ({ filename: attachment.filename,
        contentType: attachment.contentType ?? "application/octet-stream", content: Uint8Array.from(atob(attachment.contentBase64), (char) => char.charCodeAt(0)) })) } : {}) };
    if (config.provider === "sendgrid") return this.sendOnce(sender, wire);
    const result = await sender.send(wire);
    if (result.status === "development" && isLocalOutboxEnabled(this.runtime)) return { providerMessageId: null };
    return checkedResult(result, true);
  }

  /** SendGrid has no idempotency facility. A durable admission precedes invocation;
   * unknown outcomes and process loss never become an automatic second send. */
  private async sendOnce(sender: BaseSender, wire: BaseMessage): Promise<MailSendResult> {
    if (!this.db) throw new ProviderFailure("missing_configuration", false);
    const bytes = new TextEncoder().encode(JSON.stringify(wire, (_key, value) => value instanceof Uint8Array ? Array.from(value) : value));
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const now = new Date().toISOString();
    const inserted = await this.db.prepare("INSERT INTO base_mail_dispatch(delivery_id,payload_hash,state,updated_at) VALUES(?,?,'invoking',?) ON CONFLICT(delivery_id) DO UPDATE SET state='invoking',updated_at=excluded.updated_at WHERE base_mail_dispatch.state='rate_limited' AND base_mail_dispatch.payload_hash=excluded.payload_hash RETURNING delivery_id")
      .bind(wire.deliveryId, fingerprint, now).all();
    if (!inserted.results.length) {
      const old = await this.db.prepare("SELECT payload_hash,state,provider_message_id FROM base_mail_dispatch WHERE delivery_id=?").bind(wire.deliveryId).first<{ payload_hash: string; state: string; provider_message_id: string | null }>();
      if (old?.payload_hash !== fingerprint) throw new ProviderFailure("invalid_delivery_payload", false);
      if (old.state === "accepted") return { providerMessageId: old.provider_message_id };
      throw new ProviderFailure(old.state === "rejected" ? "permanent_delivery_failure" : "mail_outcome_unknown", false);
    }
    let result: BaseResult;
    try { result = await sender.send(wire); }
    catch { throw new ProviderFailure("mail_outcome_unknown", false); }
    await this.db.prepare("UPDATE base_mail_dispatch SET state=?,provider_message_id=?,updated_at=? WHERE delivery_id=?")
      .bind(result.status, result.providerMessageId, new Date().toISOString(), wire.deliveryId).run();
    return checkedResult(result, false);
  }
}
function checkedResult(result: BaseResult, idempotent: boolean): MailSendResult {
  if (result.status === "accepted") return { providerMessageId: result.providerMessageId };
  if (result.status === "rate_limited") throw new ProviderFailure("quota_exhausted", true);
  if (result.status === "uncertain") throw new ProviderFailure(idempotent ? "provider_unavailable" : "mail_outcome_unknown", idempotent);
  throw new ProviderFailure("permanent_delivery_failure", false);
}
