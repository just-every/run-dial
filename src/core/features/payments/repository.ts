import { createId, nowIso } from "../../shared/ids";
import type { PriceRow } from "./pricing";

export type PaymentConnectionStatus = "connected" | "deauthorized" | "disconnected";
export type PaymentConnection = { accountId: string | null; status: PaymentConnectionStatus; livemode: boolean; achEnabled: boolean; connectedAt: string | null; statusChangedAt: string };
export type HoldState = "held" | "processing" | "confirmed" | "released" | "unbookable";
export type PaymentHold = {
  id: string; nonceId: string; eventTypeId: string; accountId: string; state: HoldState; kind: "payment" | "setup";
  startAt: string; endAt: string; amountCents: number; currency: "usd";
  checkoutSessionId: string | null; checkoutUrl: string | null; returnExpiresAt: string;
  claimJson: string | null; bookingId: string | null; endedReason: string | null; expiresAt: string; createdAt: string;
};
/** The booking's first payment: the full price or, under PAY-003, a deposit. */
export type BookingPayment = { amountCents: number; currency: "usd"; checkoutSessionId: string; paymentIntentId: string | null; accountId: string; paidAt: string; kind: "payment" | "deposit"; taxCents: number; taxSummary: string | null };

const holdColumns = `id, nonce_id AS nonceId, event_type_id AS eventTypeId, account_id AS accountId, state, kind, start_at AS startAt, end_at AS endAt,
  amount_cents AS amountCents, currency, checkout_session_id AS checkoutSessionId, checkout_url AS checkoutUrl, return_expires_at AS returnExpiresAt,
  claim_json AS claimJson, booking_id AS bookingId, ended_reason AS endedReason, expires_at AS expiresAt, created_at AS createdAt`;

export class PaymentsRepository {
  constructor(private readonly db: D1Database) {}

  async connection(): Promise<PaymentConnection | undefined> {
    const row = await this.db.prepare("SELECT account_id AS accountId, status, livemode, ach_enabled AS achEnabled, connected_at AS connectedAt, status_changed_at AS statusChangedAt FROM payment_connections WHERE singleton_key='default'")
      .first<{ accountId: string | null; status: PaymentConnectionStatus; livemode: number; achEnabled: number; connectedAt: string | null; statusChangedAt: string }>();
    return row ? { ...row, livemode: Boolean(row.livemode), achEnabled: Boolean(row.achEnabled) } : undefined;
  }

  async saveConnection(accountId: string, livemode: boolean, operatorId: string) {
    const now = nowIso();
    await this.db.prepare(`INSERT INTO payment_connections (singleton_key, provider, account_id, status, livemode, ach_enabled, connected_by_operator_id, connected_at, status_changed_at, created_at, updated_at)
      VALUES ('default', 'stripe', ?, 'connected', ?, 0, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton_key) DO UPDATE SET account_id=excluded.account_id, status='connected', livemode=excluded.livemode,
        ach_enabled=CASE WHEN payment_connections.account_id=excluded.account_id THEN payment_connections.ach_enabled ELSE 0 END,
        connected_by_operator_id=excluded.connected_by_operator_id, connected_at=excluded.connected_at, status_changed_at=excluded.status_changed_at, updated_at=excluded.updated_at`)
      .bind(accountId, livemode ? 1 : 0, operatorId, now, now, now, now).run();
  }

  /** Stripe's account.application.deauthorized names the account; only the matching connection changes. */
  async markDeauthorized(accountId: string) {
    const now = nowIso();
    const result = await this.db.prepare("UPDATE payment_connections SET status='deauthorized', status_changed_at=?, updated_at=? WHERE singleton_key='default' AND account_id=? AND status='connected'").bind(now, now, accountId).run();
    return result.meta.changes > 0;
  }

  async markDisconnected() {
    const now = nowIso();
    await this.db.prepare("UPDATE payment_connections SET status='disconnected', status_changed_at=?, updated_at=? WHERE singleton_key='default' AND status<>'disconnected'").bind(now, now).run();
  }

  async setAch(enabled: boolean) {
    const result = await this.db.prepare("UPDATE payment_connections SET ach_enabled=?, updated_at=? WHERE singleton_key='default' AND status='connected'").bind(enabled ? 1 : 0, nowIso()).run();
    return result.meta.changes > 0;
  }

  async createOAuthState(input: { id: string; sessionId: string; operatorId: string; expiresAt: string }) {
    await this.db.prepare("INSERT INTO payment_oauth_states (id, session_id, operator_id, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)").bind(input.id, input.sessionId, input.operatorId, input.expiresAt, nowIso()).run();
  }

  async consumeOAuthState(input: { id: string; sessionId: string; operatorId: string; now: string }) {
    const result = await this.db.prepare("UPDATE payment_oauth_states SET consumed_at=? WHERE id=? AND session_id=? AND operator_id=? AND consumed_at IS NULL AND expires_at>?")
      .bind(input.now, input.id, input.sessionId, input.operatorId, input.now).run();
    return result.meta.changes === 1;
  }

  async prices(eventTypeId: string): Promise<PriceRow[]> {
    return (await this.db.prepare("SELECT duration_minutes AS durationMinutes, amount_cents AS amountCents FROM event_type_prices WHERE event_type_id=? ORDER BY duration_minutes").bind(eventTypeId).all<PriceRow>()).results;
  }

  async replacePrices(eventTypeId: string, rows: PriceRow[]) {
    const now = nowIso();
    await this.db.batch([
      this.db.prepare("DELETE FROM event_type_prices WHERE event_type_id=?").bind(eventTypeId),
      ...rows.map(row => this.db.prepare("INSERT INTO event_type_prices (event_type_id, duration_minutes, amount_cents, currency, created_at, updated_at) SELECT ?, ?, ?, 'usd', ?, ? WHERE EXISTS (SELECT 1 FROM event_types WHERE id=?)")
        .bind(eventTypeId, row.durationMinutes, row.amountCents, now, now, eventTypeId)),
    ]);
  }

  async hold(id: string) { return this.db.prepare(`SELECT ${holdColumns} FROM payment_holds WHERE id=?`).bind(id).first<PaymentHold>().then(row => row ?? undefined); }
  async holdByNonce(nonceId: string) { return this.db.prepare(`SELECT ${holdColumns} FROM payment_holds WHERE nonce_id=?`).bind(nonceId).first<PaymentHold>().then(row => row ?? undefined); }
  async holdBySession(sessionId: string) { return this.db.prepare(`SELECT ${holdColumns} FROM payment_holds WHERE checkout_session_id=?`).bind(sessionId).first<PaymentHold>().then(row => row ?? undefined); }
  async holdByReturnToken(hash: string) { return this.db.prepare(`SELECT ${holdColumns} FROM payment_holds WHERE return_token_hash=?`).bind(hash).first<PaymentHold>().then(row => row ?? undefined); }

  async attachCheckout(holdId: string, sessionId: string, url: string, claimJson: string) {
    await this.db.prepare("UPDATE payment_holds SET checkout_session_id=?, checkout_url=?, claim_json=?, updated_at=? WHERE id=? AND state='held'").bind(sessionId, url, claimJson, nowIso(), holdId).run();
  }

  async markProcessing(holdId: string) {
    await this.db.prepare("UPDATE payment_holds SET state='processing', updated_at=? WHERE id=? AND state='held'").bind(nowIso(), holdId).run();
  }

  /** Ending a hold frees its slot and drops the pending booking and payer details it carried. */
  async endHold(holdId: string, state: "released" | "unbookable", reason: string) {
    const result = await this.db.prepare(`UPDATE payment_holds SET state=?, ended_reason=?, claim_json=NULL, invitee_email_folded=NULL, checkout_url=NULL, updated_at=? WHERE id=? AND state IN ('held', 'processing')`)
      .bind(state, reason, nowIso(), holdId).run();
    return result.meta.changes > 0;
  }

  async dueHolds(now: string) {
    return (await this.db.prepare(`SELECT ${holdColumns} FROM payment_holds WHERE state='held' AND expires_at<=? ORDER BY expires_at LIMIT 50`).bind(now).all<PaymentHold>()).results;
  }

  async bookingPayment(bookingId: string): Promise<BookingPayment | undefined> {
    return await this.db.prepare("SELECT amount_cents AS amountCents, currency, checkout_session_id AS checkoutSessionId, payment_intent_id AS paymentIntentId, account_id AS accountId, paid_at AS paidAt, kind, tax_cents AS taxCents, tax_summary AS taxSummary FROM booking_payments WHERE booking_id=?")
      .bind(bookingId).first<BookingPayment>() ?? undefined;
  }

  async bookingPayments(bookingIds: string[]): Promise<Map<string, BookingPayment>> {
    if (!bookingIds.length) return new Map();
    const rows = (await this.db.prepare("SELECT booking_id AS bookingId, amount_cents AS amountCents, currency, checkout_session_id AS checkoutSessionId, payment_intent_id AS paymentIntentId, account_id AS accountId, paid_at AS paidAt, kind, tax_cents AS taxCents, tax_summary AS taxSummary FROM booking_payments WHERE booking_id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(bookingIds)).all<BookingPayment & { bookingId: string }>()).results;
    return new Map(rows.map(({ bookingId, ...payment }) => [bookingId, payment]));
  }

  bookingPaymentStatement(input: { bookingId: string; accountId: string; amountCents: number; checkoutSessionId: string; paymentIntentId: string | null; paidAt: string; kind: "payment" | "deposit"; taxCents: number; taxSummary: string | null }) {
    return this.db.prepare("INSERT INTO booking_payments (id, booking_id, provider, account_id, amount_cents, currency, checkout_session_id, payment_intent_id, status, paid_at, created_at, updated_at, kind, tax_cents, tax_summary) SELECT ?, ?, 'stripe', ?, ?, 'usd', ?, ?, 'paid', ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id=?)")
      .bind(createId(), input.bookingId, input.accountId, input.amountCents, input.checkoutSessionId, input.paymentIntentId, input.paidAt, input.paidAt, input.paidAt, input.kind, input.taxCents, input.taxSummary, input.bookingId);
  }

  confirmHoldStatement(holdId: string, bookingId: string, now: string) {
    return this.db.prepare("UPDATE payment_holds SET state='confirmed', booking_id=?, claim_json=NULL, invitee_email_folded=NULL, checkout_url=NULL, ended_reason=NULL, updated_at=? WHERE id=? AND state IN ('held', 'processing') AND EXISTS (SELECT 1 FROM bookings WHERE id=?)")
      .bind(bookingId, now, holdId, bookingId);
  }
}
