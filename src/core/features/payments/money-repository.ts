import { nowIso } from "../../shared/ids";
import type { TermsSnapshot } from "../../shared/payment-terms";
import type { PaymentTermsInput, TermsRow } from "./terms";

export type CardConsent = { consentTextVersion: string; freeWindowHours: number | null; lateCancelFeeCents: number; noShowFeeCents: number; acceptedAt: string; accountId: string; customerId: string | null; paymentMethodId: string | null };
/** A pending booking's money as the hold carries it until Stripe's signed event confirms the booking. */
export type PendingMoney = { snapshot: TermsSnapshot; consent?: { version: string; acceptedAt: string }; balanceSalt?: string; manageUrl?: string };

const snapshotColumns = "price_cents AS priceCents, deposit_cents AS depositCents, due_now_cents AS dueNowCents, balance_cents AS balanceCents, balance_due_hours AS balanceDueHours, free_window_hours AS freeWindowHours, late_cancel_fee_cents AS lateCancelFeeCents, no_show_fee_cents AS noShowFeeCents, terms_version AS version, tax_cents AS taxCents, tax_summary AS taxSummary";
export type PaymentSettings = { taxEnabled: boolean; businessName: string | null };
const consentColumns = "consent_text_version AS consentTextVersion, free_window_hours AS freeWindowHours, late_cancel_fee_cents AS lateCancelFeeCents, no_show_fee_cents AS noShowFeeCents, accepted_at AS acceptedAt, account_id AS accountId, stripe_customer_id AS customerId, stripe_payment_method_id AS paymentMethodId";

/** PAY-003 terms: an event type's settings, and each booking's snapshot, card consent and balance link. */
export class MoneyRepository {
  constructor(private readonly db: D1Database) {}

  eventTerms(eventTypeId: string) {
    return this.db.prepare("SELECT deposit_kind AS depositKind, deposit_value AS depositValue, balance_due_hours AS balanceDueHours, free_window_hours AS freeWindowHours, late_cancel_fee_cents AS lateCancelFeeCents, no_show_fee_cents AS noShowFeeCents, terms_version AS version FROM event_type_payment_terms WHERE event_type_id=?")
      .bind(eventTypeId).first<TermsRow>();
  }

  /** Each saved change is a new terms version; bookings keep the version they were shown. */
  async saveEventTerms(eventTypeId: string, input: PaymentTermsInput) {
    const now = nowIso();
    const value = input.deposit.kind === "fixed" ? input.deposit.amountCents : input.deposit.kind === "percent" ? input.deposit.percent : 0;
    await this.db.prepare(`INSERT INTO event_type_payment_terms (event_type_id, deposit_kind, deposit_value, balance_due_hours, free_window_hours, late_cancel_fee_cents, no_show_fee_cents, terms_version, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM event_types WHERE id=?)
      ON CONFLICT(event_type_id) DO UPDATE SET deposit_kind=excluded.deposit_kind, deposit_value=excluded.deposit_value, balance_due_hours=excluded.balance_due_hours,
        free_window_hours=excluded.free_window_hours, late_cancel_fee_cents=excluded.late_cancel_fee_cents, no_show_fee_cents=excluded.no_show_fee_cents,
        terms_version=event_type_payment_terms.terms_version + 1, updated_at=excluded.updated_at`)
      .bind(eventTypeId, input.deposit.kind, value, input.balanceDueHours, input.freeWindowHours, input.lateCancelFeeCents, input.noShowFeeCents, now, now, eventTypeId).run();
  }

  cancellationCutoffMinutes(eventTypeId: string) {
    return this.db.prepare("SELECT cancellation_cutoff_minutes AS minutes FROM event_booking_policies WHERE event_type_id=?").bind(eventTypeId).first<{ minutes: number | null }>().then(row => row?.minutes ?? null);
  }

  snapshot(bookingId: string) {
    return this.db.prepare(`SELECT ${snapshotColumns} FROM booking_payment_terms WHERE booking_id=?`).bind(bookingId).first<TermsSnapshot>().then(row => row ?? undefined);
  }

  consent(bookingId: string) {
    return this.db.prepare(`SELECT ${consentColumns} FROM booking_card_consents WHERE booking_id=?`).bind(bookingId).first<CardConsent>().then(row => row ?? undefined);
  }

  balanceLink(bookingId: string) {
    return this.db.prepare("SELECT token_salt AS salt FROM payment_link_tokens WHERE booking_id=? AND action='balance'").bind(bookingId).first<{ salt: string }>().then(row => row?.salt);
  }

  bookingForBalanceToken(hash: string) {
    return this.db.prepare("SELECT booking_id AS bookingId FROM payment_link_tokens WHERE token_hash=? AND action='balance'").bind(hash).first<{ bookingId: string }>().then(row => row?.bookingId);
  }

  /** The rows a confirmed booking gains from its hold, written in the same transaction as the booking itself. */
  confirmationStatements(bookingId: string, pending: PendingMoney, card: { accountId: string; customerId: string | null; paymentMethodId: string | null } | undefined, balanceTokenHash: string | undefined, now: string) {
    const exists = "WHERE EXISTS (SELECT 1 FROM bookings WHERE id=?)";
    const { snapshot } = pending;
    return [
      this.db.prepare(`INSERT INTO booking_payment_terms (booking_id, price_cents, deposit_cents, due_now_cents, balance_cents, balance_due_hours, free_window_hours, late_cancel_fee_cents, no_show_fee_cents, terms_version, created_at, tax_cents, tax_summary) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ${exists} ON CONFLICT(booking_id) DO NOTHING`)
        .bind(bookingId, snapshot.priceCents, snapshot.depositCents, snapshot.dueNowCents, snapshot.balanceCents, snapshot.balanceDueHours, snapshot.freeWindowHours, snapshot.lateCancelFeeCents, snapshot.noShowFeeCents, snapshot.version, now, snapshot.taxCents, snapshot.taxSummary, bookingId),
      ...(pending.consent && card ? [this.db.prepare(`INSERT INTO booking_card_consents (booking_id, consent_text_version, free_window_hours, late_cancel_fee_cents, no_show_fee_cents, accepted_at, account_id, stripe_customer_id, stripe_payment_method_id, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ${exists} ON CONFLICT(booking_id) DO NOTHING`)
        .bind(bookingId, pending.consent.version, snapshot.freeWindowHours, snapshot.lateCancelFeeCents, snapshot.noShowFeeCents, pending.consent.acceptedAt, card.accountId, card.customerId, card.paymentMethodId, now, now, bookingId)] : []),
      ...(pending.balanceSalt && balanceTokenHash ? [this.db.prepare(`INSERT INTO payment_link_tokens (booking_id, action, token_salt, token_hash, created_at) SELECT ?, 'balance', ?, ?, ? ${exists} ON CONFLICT DO NOTHING`)
        .bind(bookingId, pending.balanceSalt, balanceTokenHash, now, bookingId)] : []),
    ];
  }

  /** PAY-005: Stripe Tax on or off and the business name receipts and invoices carry (the host's name when unset). */
  async settings(): Promise<PaymentSettings & { hostName: string | null }> {
    const row = await this.db.prepare("SELECT s.tax_enabled AS taxEnabled, s.business_name AS businessName, (SELECT name FROM host_profiles WHERE singleton_key='default') AS hostName FROM (SELECT 1) LEFT JOIN payment_settings s ON s.singleton_key='default'")
      .first<{ taxEnabled: number | null; businessName: string | null; hostName: string | null }>();
    return { taxEnabled: row?.taxEnabled === 1, businessName: row?.businessName ?? null, hostName: row?.hostName ?? null };
  }

  async saveSettings(settings: PaymentSettings) {
    const now = nowIso();
    await this.db.prepare(`INSERT INTO payment_settings (singleton_key, tax_enabled, business_name, created_at, updated_at) VALUES ('default', ?, ?, ?, ?)
      ON CONFLICT(singleton_key) DO UPDATE SET tax_enabled=excluded.tax_enabled, business_name=excluded.business_name, updated_at=excluded.updated_at`).bind(settings.taxEnabled ? 1 : 0, settings.businessName, now, now).run();
  }

  /** Erasure asks Stripe to detach a saved card first; these are the references it needs. */
  savedCard(bookingId: string) {
    return this.db.prepare("SELECT account_id AS accountId, stripe_payment_method_id AS paymentMethodId FROM booking_card_consents WHERE booking_id=? AND stripe_payment_method_id IS NOT NULL").bind(bookingId).first<{ accountId: string; paymentMethodId: string }>().then(row => row ?? undefined);
  }
}
