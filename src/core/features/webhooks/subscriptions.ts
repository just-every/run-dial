import { apiHosts } from "../api-credentials";
import { webhookDeliveryScope } from "./scope";
import { createId, nowIso } from "../../shared/ids";
import { createOpaqueToken } from "../../platform/auth/tokens";
import { seal } from "../../platform/crypto/sealed";
import { webhookEndpoint } from "./endpoint";
import { workflowWebhookAuthority } from "../workflows";

export const webhookEventTypes = ["booking.created.v1", "booking.rescheduled.v1", "booking.reschedule-requested.v1", "booking.canceled.v1", "booking.no-show.v1", "booking.attendance.v1", "booking.payment.v1", "routing.submitted.v1", "poll.created.v1", "poll.voted.v1", "poll.closed.v1", "calendar.connection-health-changed.v1", "workflow.action.v1"] as const;
export type SubscriptionInput = { endpoint: string; events: string[]; scope: "workspace" | "host" | "team"; scopeId: string | null };

export class WebhookSubscriptions {
  constructor(private readonly db: D1Database, private readonly secret: string, private readonly transport: typeof fetch) {}

  async status() {
    const [subscriptions, deliveries, host, teams] = await Promise.all([
      this.db.prepare("SELECT id,endpoint,events_json AS eventsJson,scope,scope_id AS scopeId,created_at AS createdAt FROM webhook_subscriptions WHERE enabled=1 ORDER BY created_at,id").all<{ id: string; endpoint: string; eventsJson: string; scope: string; scopeId: string | null; createdAt: string }>(),
      this.db.prepare("SELECT id,event_id AS eventId,event_type AS eventType,subscription_id AS subscriptionId,state,response_code AS responseCode,attempts,next_attempt_at AS nextAttemptAt,created_at AS createdAt FROM webhook_deliveries ORDER BY created_at DESC,id DESC LIMIT 100").all(),
      this.db.prepare("SELECT id FROM host_profiles WHERE singleton_key='default'").first<{ id: string }>(),
      this.db.prepare("SELECT id,name FROM teams ORDER BY name,id").all(),
    ]);
    return { subscriptions: subscriptions.results.map(({ eventsJson, ...row }) => ({ ...row, events: JSON.parse(eventsJson) as string[] })), deliveries: deliveries.results,
      eventTypes: webhookEventTypes.filter(type => type !== "workflow.action.v1"), workflowEventTypes: ["workflow.action.v1"], hostId: host?.id ?? "", teams: teams.results };
  }

  async create(input: SubscriptionInput) {
    if (!input.events.length || input.events.some(event => !webhookEventTypes.includes(event as typeof webhookEventTypes[number]))) return undefined;
    if (input.scope === "workspace" && input.scopeId !== null) return undefined;
    if (input.scope === "host" && !(await apiHosts(this.db)).some(host=>host.id===input.scopeId)) return undefined;
    if (input.scope === "team" && !await this.db.prepare("SELECT id FROM teams WHERE id=?").bind(input.scopeId).first()) return undefined;
    const endpoint = await webhookEndpoint(input.endpoint, this.transport), id = createId(), secret = createOpaqueToken(), now = nowIso();
    await this.db.prepare("INSERT INTO webhook_subscriptions(id,endpoint,events_json,scope,scope_id,secret_ciphertext,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(id, endpoint, JSON.stringify([...new Set(input.events)]), input.scope, input.scopeId, await seal(secret, this.secret), now, now).run();
    return { id, secret };
  }

  async remove(id: string) {
    // Cascading removes queued bodies and signing authority before returning.
    return (await this.db.prepare("DELETE FROM webhook_subscriptions WHERE id=?").bind(id).run()).meta.changes > 0;
  }

  async redeliver(id: string, now = new Date()) {
    return (await this.db.prepare(`UPDATE webhook_deliveries AS d SET state='pending',response_code=NULL,attempts=0,next_attempt_at=?,retry_until=?,lease_id=NULL,lease_until=NULL,last_error=NULL,updated_at=?
      WHERE id=? AND state IN ('delivered','failed') AND EXISTS(SELECT 1 FROM webhook_subscriptions s WHERE s.id=subscription_id AND s.enabled=1 AND s.secret_ciphertext IS NOT NULL)
      AND (booking_id IS NULL OR EXISTS(SELECT 1 FROM bookings b WHERE b.id=booking_id AND NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=b.invitee_email_folded)))
      AND ${workflowWebhookAuthority("d")} AND ${webhookDeliveryScope("d")}`)
      .bind(now.toISOString(), new Date(now.getTime() + 86400000).toISOString(), now.toISOString(), id).run()).meta.changes > 0;
  }
}
