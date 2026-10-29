import { createId } from "../../shared/ids";
import { unseal } from "../../platform/crypto/sealed";
import { webhookEndpoint, webhookSignature } from "./endpoint";

type Delivery = { id: string; subscription_id: string; event_id: string; body_json: string; attempts: number; retry_until: string; endpoint: string; secret_ciphertext: string };
export function isWebhookJob(value: unknown): value is { channel: "webhook"; deliveryId: string } {
  return Boolean(value && typeof value === "object" && "channel" in value && value.channel === "webhook" && "deliveryId" in value && typeof value.deliveryId === "string");
}

export class WebhookDelivery {
  constructor(private readonly db: D1Database, private readonly secret: string, private readonly transport: typeof fetch) {}

  async due(now = new Date()) {
    const at = now.toISOString();
    await this.db.prepare("UPDATE webhook_deliveries SET state='pending',lease_id=NULL,lease_until=NULL WHERE state='sending' AND lease_until<=?").bind(at).run();
    return (await this.db.prepare("SELECT id FROM webhook_deliveries WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 25").bind(at).all<{ id: string }>()).results.map(row => row.id);
  }
  async enqueue(queue: Queue, now = new Date()) {
    const ids = await this.due(now);
    if (ids.length) await queue.sendBatch(ids.map(deliveryId => ({ body: { channel: "webhook", deliveryId } })));
  }

  async process(id: string, now = new Date()) {
    const at = now.toISOString(), lease = createId();
    const claimed = await this.db.prepare(`UPDATE webhook_deliveries SET state='sending',attempts=attempts+1,lease_id=?,lease_until=?,updated_at=?
      WHERE id=? AND state='pending' AND next_attempt_at<=? AND EXISTS(SELECT 1 FROM webhook_subscriptions s WHERE s.id=subscription_id AND s.enabled=1 AND s.secret_ciphertext IS NOT NULL)
      AND (booking_id IS NULL OR EXISTS(SELECT 1 FROM bookings b WHERE b.id=booking_id AND NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=b.invitee_email_folded)))`)
      .bind(lease, new Date(now.getTime() + 60000).toISOString(), at, id, at).run();
    if (!claimed.meta.changes) return "not_due";
    const row = await this.db.prepare(`SELECT d.*,s.endpoint,s.secret_ciphertext FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id AND s.enabled=1 WHERE d.id=? AND d.lease_id=?`).bind(id, lease).first<Delivery>();
    if (!row) return "unavailable";
    if (at > row.retry_until) { await this.finish(id, lease, "failed", null, "retry_window_ended", at, at); return "failed"; }
    let code: number | null = null, reason = "receiver_unavailable";
    try {
      const endpoint = await webhookEndpoint(row.endpoint, this.transport);
      const signature = await webhookSignature(await unseal(row.secret_ciphertext, this.secret), Math.floor(now.getTime() / 1000), row.body_json);
      // DNS and key operations can yield while an owner deletes or erases.
      // Re-read authority at the last boundary before starting the HTTP request.
      const active = await this.db.prepare(`SELECT d.id FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id
        WHERE d.id=? AND d.lease_id=? AND d.state='sending' AND s.enabled=1 AND s.secret_ciphertext IS NOT NULL
        AND (d.booking_id IS NULL OR EXISTS(SELECT 1 FROM bookings b WHERE b.id=d.booking_id AND NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=b.invitee_email_folded)))`).bind(id, lease).first();
      if (!active) return "unavailable";
      const response = await this.transport(endpoint, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application" + "/json", "Dial-Signature": signature, "Dial-Event-Id": row.event_id }, body: row.body_json });
      code = response.status;
      await response.body?.cancel();
      if (response.ok) { await this.finish(id, lease, "delivered", code, null, at, at); return "delivered"; }
      reason = "receiver_rejected";
    } catch { /* The persisted attempt is retried with the same event identity and body. */ }
    const retryAt = Math.min(Date.parse(row.retry_until), now.getTime() + Math.min(3600000, 60000 * 2 ** Math.min(row.attempts - 1, 6)));
    const retry = retryAt > now.getTime();
    await this.finish(id, lease, retry ? "pending" : "failed", code, reason, new Date(retryAt).toISOString(), at);
    return retry ? "retrying" : "failed";
  }

  private async finish(id: string, lease: string, state: string, code: number | null, reason: string | null, next: string, at: string) {
    await this.db.prepare("UPDATE webhook_deliveries SET state=?,response_code=?,last_error=?,next_attempt_at=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=?")
      .bind(state, code, reason, next, at, id, lease).run();
  }
}
