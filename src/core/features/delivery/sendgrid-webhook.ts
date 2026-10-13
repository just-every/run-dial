// @ts-expect-error Base's portable ESM distribution has no TypeScript declaration.
import { verifyWebhook } from "../../../../modules/mail/index.mjs";
import type { AdmitCallback } from "../../platform/public-admission";
import { createId, nowIso } from "../../shared/ids";

/** Authenticated provider facts only; no inbound-mail application workflow. */
export class SendGridWebhookReceiver {
  constructor(private readonly db: D1Database, private readonly key?: string) {}
  async receive(request: Request, admit: AdmitCallback) {
    if (!this.key) return { kind: "unauthorized" as const };
    const rawBody = new Uint8Array(await request.arrayBuffer());
    if (!await verifyWebhook({ provider: "sendgrid", rawBody, headers: request.headers, key: this.key, now: Date.now() })) return { kind: "unauthorized" as const };
    const admission = await admit();
    if (admission.kind === "limited") return { kind: "rate_limited" as const, retryAfterSeconds: admission.retryAfterSeconds };
    let events: unknown;
    try { events = JSON.parse(new TextDecoder().decode(rawBody)); } catch { return { kind: "ignored" as const }; }
    if (!Array.isArray(events)) return { kind: "ignored" as const };
    for (const event of events) {
      if (!event || typeof event !== "object" || typeof event.sg_event_id !== "string" || event.sg_event_id.length > 1024) continue;
      const failure = event.event === "bounce" ? "bounced" : ["dropped", "spamreport"].includes(event.event) ? "permanent_delivery_failure" : null;
      const key = typeof event.rer_delivery_id === "string" && event.rer_delivery_id.length <= 512 ? event.rer_delivery_id : null;
      const id = createId(), now = nowIso();
      // Receipt and failed-state transition commit together, including nullable
      // SendGrid acceptance IDs. Correlation comes from our signed custom argument.
      await this.db.batch([
        this.db.prepare("INSERT INTO provider_webhook_events(id,provider,provider_event_id,received_at,processed_at,state,payload_hash,delivery_id) SELECT ?,'sendgrid',?,?,?,'processed','',? WHERE EXISTS(SELECT 1 FROM delivery_outbox WHERE COALESCE(json_extract(payload_json,'$.providerIdempotencyKey'),idempotency_key)=?) ON CONFLICT DO NOTHING").bind(id, event.sg_event_id, now, now, key, key),
        this.db.prepare(`UPDATE delivery_outbox SET state='failed',last_error_code=?,updated_at=? WHERE ? IS NOT NULL AND state IN ('pending','processing','succeeded')
          AND EXISTS(SELECT 1 FROM provider_webhook_events WHERE id=?)
          AND COALESCE(json_extract(payload_json,'$.providerIdempotencyKey'),idempotency_key)=?
          AND EXISTS(SELECT 1 FROM base_mail_dispatch WHERE delivery_id=? AND state IN ('invoking','accepted','uncertain'))`)
          .bind(failure, now, failure, id, key, key),
      ]);
    }
    return { kind: "accepted" as const };
  }
}
