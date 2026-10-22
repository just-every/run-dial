import { createId, nowIso } from "../../shared/ids";

export type MovementKind = "balance" | "invoice" | "refund" | "late_cancel_fee" | "no_show_fee";
export type MovementActor = "invitee" | "operator" | "policy";
export type Movement = {
  id: string; bookingId: string; kind: MovementKind; amountCents: number; status: "pending" | "succeeded" | "failed";
  actorType: MovementActor; actorId: string | null; reason: string; accountId: string;
  sourceRef: string | null; processorRef: string | null; checkoutSessionId: string | null; checkoutUrl: string | null; checkoutAttempt: number;
  failureCode: string | null; idempotencyKey: string; createdAt: string; updatedAt: string;
  /** PAY-005: the tax a balance or invoice charged, or a refund's proportional share, and the invoice it belongs to. */
  taxCents: number; taxSummary: string | null; invoiceId: string | null; invoiceNumber: string | null; invoiceUrl: string | null;
};
export type NewMovement = Pick<Movement, "bookingId" | "kind" | "amountCents" | "actorType" | "actorId" | "reason" | "accountId" | "sourceRef" | "idempotencyKey"> & { taxCents?: number; taxSummary?: string | null };

const columns = `id, booking_id AS bookingId, kind, amount_cents AS amountCents, status, actor_type AS actorType, actor_id AS actorId, reason, account_id AS accountId,
  source_ref AS sourceRef, processor_ref AS processorRef, checkout_session_id AS checkoutSessionId, checkout_url AS checkoutUrl, checkout_attempt AS checkoutAttempt, failure_code AS failureCode,
  idempotency_key AS idempotencyKey, created_at AS createdAt, updated_at AS updatedAt, tax_cents AS taxCents, tax_summary AS taxSummary,
  invoice_id AS invoiceId, invoice_number AS invoiceNumber, invoice_url AS invoiceUrl`;

/** PAY-003 money movements: each row is written pending before Stripe is called and settles exactly once. */
export class MovementsRepository {
  constructor(private readonly db: D1Database) {}

  forBooking(bookingId: string) {
    return this.db.prepare(`SELECT ${columns} FROM payment_movements WHERE booking_id=? ORDER BY created_at, id`).bind(bookingId).all<Movement>().then(result => result.results);
  }

  forBookings(bookingIds: string[]) {
    if (!bookingIds.length) return Promise.resolve([] as Movement[]);
    return this.db.prepare(`SELECT ${columns} FROM payment_movements WHERE booking_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, id`).bind(JSON.stringify(bookingIds)).all<Movement>().then(result => result.results);
  }

  get(id: string) { return this.db.prepare(`SELECT ${columns} FROM payment_movements WHERE id=?`).bind(id).first<Movement>().then(row => row ?? undefined); }
  byKey(key: string) { return this.db.prepare(`SELECT ${columns} FROM payment_movements WHERE idempotency_key=?`).bind(key).first<Movement>().then(row => row ?? undefined); }

  /** A pending movement, unless its idempotency key (or a fee's once-per-booking rule) already holds one. The
   * condition lets a caller tie the insert to its own transaction, for example to a cancellation that just won. */
  insertStatement(movement: NewMovement, now: string, condition = { sql: "1", params: [] as unknown[] }) {
    return this.db.prepare(`INSERT INTO payment_movements (id, booking_id, kind, amount_cents, currency, status, actor_type, actor_id, reason, account_id, source_ref, processor_ref, checkout_session_id, checkout_url, failure_code, idempotency_key, created_at, updated_at, tax_cents, tax_summary)
      SELECT ?, ?, ?, ?, 'usd', 'pending', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ? WHERE ${condition.sql} ON CONFLICT DO NOTHING`)
      .bind(createId(), movement.bookingId, movement.kind, movement.amountCents, movement.actorType, movement.actorId, movement.reason, movement.accountId, movement.sourceRef, movement.idempotencyKey, now, now, movement.taxCents ?? 0, movement.taxSummary ?? null, ...condition.params);
  }

  async insert(movements: NewMovement[]) {
    if (!movements.length) return;
    const now = nowIso();
    await this.db.batch(movements.map(movement => this.insertStatement(movement, now)));
  }

  pendingFor(bookingId: string) {
    return this.db.prepare(`SELECT ${columns} FROM payment_movements WHERE booking_id=? AND status='pending' AND kind NOT IN ('balance', 'invoice') ORDER BY created_at, id`).bind(bookingId).all<Movement>().then(result => result.results);
  }

  /** Movements whose Stripe call may have been cut off (for example by a Worker restart) before they settled. */
  stalePending(before: string) {
    return this.db.prepare(`SELECT ${columns} FROM payment_movements WHERE status='pending' AND kind NOT IN ('balance', 'invoice') AND updated_at<=? ORDER BY updated_at LIMIT 50`).bind(before).all<Movement>().then(result => result.results);
  }

  async succeed(id: string, processorRef: string, also: D1PreparedStatement[] = []) {
    const [result] = await this.db.batch([this.succeedStatement(id, processorRef), ...also]);
    return result.meta.changes > 0;
  }

  /** Settling a movement and queueing its receipt commit together, so a receipt is queued once per payment. */
  succeedStatement(id: string, processorRef: string) {
    return this.db.prepare("UPDATE payment_movements SET status='succeeded', processor_ref=?, checkout_url=NULL, failure_code=NULL, updated_at=? WHERE id=? AND status='pending'").bind(processorRef, nowIso(), id);
  }

  /** D4: cancelling closes the booking's open balance and invoice in the cancellation's own transaction. Each is then
   * voided at Stripe (`voided`), or Stripe refuses because it already took or closed the payment (`void_refused`). */
  voidOpenStatement(bookingId: string, now: string, condition: { sql: string; params: unknown[] }) {
    return this.db.prepare(`UPDATE payment_movements SET status='failed', failure_code='void_pending', checkout_url=NULL, updated_at=? WHERE booking_id=? AND kind IN ('balance', 'invoice') AND status='pending' AND ${condition.sql}`).bind(now, bookingId, ...condition.params);
  }

  voidsPending(bookingId: string) {
    return this.db.prepare(`SELECT ${columns} FROM payment_movements WHERE booking_id=? AND status='failed' AND failure_code='void_pending'`).bind(bookingId).all<Movement>().then(result => result.results);
  }

  staleVoids(before: string) {
    return this.db.prepare(`SELECT ${columns} FROM payment_movements WHERE status='failed' AND failure_code='void_pending' AND updated_at<=? ORDER BY updated_at LIMIT 50`).bind(before).all<Movement>().then(result => result.results);
  }

  async markVoid(id: string, code: "voided" | "void_refused") {
    await this.db.prepare("UPDATE payment_movements SET failure_code=?, updated_at=? WHERE id=? AND status='failed' AND failure_code='void_pending'").bind(code, nowIso(), id).run();
  }

  /** A payment Stripe captured although its booking was cancelled settles its movement, open or voided. */
  succeedLateStatement(id: string, processorRef: string) {
    return this.db.prepare("UPDATE payment_movements SET status='succeeded', processor_ref=?, checkout_url=NULL, failure_code=NULL, updated_at=? WHERE id=? AND (status='pending' OR (status='failed' AND failure_code IN ('void_pending', 'voided', 'void_refused')))").bind(processorRef, nowIso(), id);
  }

  async attachInvoice(id: string, invoice: { id: string; number: string | null; url: string }) {
    await this.db.prepare("UPDATE payment_movements SET invoice_id=?, invoice_number=?, invoice_url=?, updated_at=? WHERE id=? AND status='pending' AND invoice_id IS NULL").bind(invoice.id, invoice.number, invoice.url, nowIso(), id).run();
  }

  async fail(id: string, code: string) {
    const result = await this.db.prepare("UPDATE payment_movements SET status='failed', failure_code=?, checkout_url=NULL, updated_at=? WHERE id=? AND status='pending'").bind(code, nowIso(), id).run();
    return result.meta.changes > 0;
  }

  /** Only one open Checkout serves a balance: an attach that finds another session already attached loses. */
  async attachCheckout(id: string, sessionId: string, url: string) {
    const result = await this.db.prepare("UPDATE payment_movements SET checkout_session_id=?, checkout_url=?, updated_at=? WHERE id=? AND status='pending' AND checkout_session_id IS NULL").bind(sessionId, url, nowIso(), id).run();
    return result.meta.changes > 0;
  }

  /** An expired or failed balance Checkout leaves the balance due; the next visit opens a new session. */
  async clearCheckout(id: string, sessionId: string) {
    await this.db.prepare("UPDATE payment_movements SET checkout_session_id=NULL, checkout_url=NULL, checkout_attempt=checkout_attempt + 1, updated_at=? WHERE id=? AND status='pending' AND checkout_session_id=?").bind(nowIso(), id, sessionId).run();
  }
}
