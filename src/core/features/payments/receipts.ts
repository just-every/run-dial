import { operatorRecipientAdmission, renderBrandedMail } from "../delivery/mail";
import { formatUsd } from "../../shared/event-price";
import { createId, nowIso } from "../../shared/ids";

export type ReceiptKind = "payment" | "deposit" | "balance" | "invoice" | "late_cancel_fee" | "no_show_fee";
export type ReceiptPayment = { ref: string; kind: ReceiptKind; amountCents: number; taxCents: number; taxSummary: string | null; paidAt: string };
export type ReceiptBooking = { id: string; inviteeName: string; inviteeEmail: string; eventTitle: string; startAt: string; hostTimezone: string; inviteeTimezone: string; manageUrl?: string };
type Recipient = { to: string; recipientRole: "invitee" | "operator"; operatorAccess?: { id: string; generation: number } };

const labels: Record<ReceiptKind, string> = { payment: "Payment", deposit: "Deposit", balance: "Balance", invoice: "Invoice payment", late_cancel_fee: "Late-cancellation fee", no_show_fee: "No-show fee" };
const instant = (value: string, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));

/** PAY-005: one receipt per payment, carrying the host's business name, the amount, its sales tax and the Stripe
 * reference, to the invitee and the booking's host recipients (NOTIFY-008) only. It is queued in the transaction
 * that records the payment, keyed by the payment reference, so a repeated signed event queues nothing more. */
export function receiptStatements(db: D1Database, booking: ReceiptBooking, payment: ReceiptPayment, businessName: string, operators: Array<{ id: string; email: string; generation: number }>): D1PreparedStatement[] {
  const recipients: Recipient[] = [{ to: booking.inviteeEmail, recipientRole: "invitee" }, ...operators.map(operator => ({ to: operator.email, recipientRole: "operator" as const, operatorAccess: { id: operator.id, generation: operator.generation } }))];
  const now = nowIso();
  return recipients.map(recipient => {
    const zone = recipient.recipientRole === "invitee" ? booking.inviteeTimezone : booking.hostTimezone;
    const amount = `${labels[payment.kind]}: ${formatUsd(payment.amountCents)} paid`;
    const tax = payment.taxCents > 0 ? `Sales tax: ${formatUsd(payment.taxCents)} included${payment.taxSummary ? ` (${payment.taxSummary})` : ""}` : "Sales tax: none";
    const facts = [
      { label: "Business", value: businessName }, { label: labels[payment.kind], value: `${formatUsd(payment.amountCents)} paid` },
      { label: "Sales tax", value: payment.taxCents > 0 ? `${formatUsd(payment.taxCents)} included${payment.taxSummary ? ` (${payment.taxSummary})` : ""}` : "None" },
      { label: "Stripe reference", value: payment.ref }, { label: "Paid", value: instant(payment.paidAt, zone) },
      { label: "Booking", value: `${booking.eventTitle} · ${instant(booking.startAt, zone)}` },
      ...(recipient.recipientRole === "operator" ? [{ label: "Invitee", value: `${booking.inviteeName} <${booking.inviteeEmail}>` }] : []),
    ];
    const manageUrl = recipient.recipientRole === "invitee" ? booking.manageUrl : undefined;
    const text = [`Receipt from ${businessName}`, amount, tax, `Stripe reference: ${payment.ref}`, `Paid: ${instant(payment.paidAt, zone)}`, `Booking: ${booking.eventTitle} · ${instant(booking.startAt, zone)}`,
      ...(recipient.recipientRole === "operator" ? [`Invitee: ${booking.inviteeName} <${booking.inviteeEmail}>`] : []), ...(manageUrl ? [`View your booking: ${manageUrl}`] : [])].join("\n");
    const html = renderBrandedMail({ businessName, heading: "Receipt", intro: `${amount} to ${businessName}.`, facts, actions: manageUrl ? [{ label: "View your booking", href: manageUrl }] : [] });
    // The booking link rides in the body only: a receipt belongs to the booking, not to one of its times, so it is
    // not re-pointed at a later occurrence's capability the way change mails are.
    const email = { messageKind: "receipt", to: recipient.to, recipientRole: recipient.recipientRole, ...(recipient.operatorAccess ? { operatorAccess: recipient.operatorAccess } : {}), subject: `Receipt: ${formatUsd(payment.amountCents)} paid to ${businessName}`, text, html };
    const admission = operatorRecipientAdmission(email);
    return db.prepare(`INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at)
      SELECT ?, 'mail_send', ?, ?, NULL, NULL, ?, 'pending', 0, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?) AND ${admission.sql} ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(createId(), `booking:${booking.id}:receipt:${payment.ref}:${recipient.recipientRole}:${recipient.to.toLowerCase()}`, booking.id, JSON.stringify(email), now, now, now, booking.id, ...admission.params);
  });
}

/** The booking and recipients a later payment's receipt goes to, read when the payment settles. */
export async function receiptAudience(db: D1Database, bookingId: string) {
  const booking = await db.prepare(`SELECT b.id, b.invitee_name AS inviteeName, b.invitee_email AS inviteeEmail, b.event_title AS eventTitle, o.start_at AS startAt, b.host_timezone AS hostTimezone, b.invitee_timezone AS inviteeTimezone
    FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id WHERE b.id = ?`).bind(bookingId).first<ReceiptBooking>();
  if (!booking) return undefined;
  const mail = await db.prepare("SELECT json_extract(payload_json, '$.manageUrl') AS manageUrl FROM delivery_outbox WHERE booking_id = ? AND json_extract(payload_json, '$.recipientRole') = 'invitee' AND json_type(payload_json, '$.manageUrl') = 'text' ORDER BY updated_at DESC LIMIT 1").bind(bookingId).first<{ manageUrl: string }>();
  return { booking: { ...booking, ...(mail ? { manageUrl: mail.manageUrl } : {}) }, operators: await receiptOperators(db) };
}

export async function receiptOperators(db: D1Database) {
  return (await db.prepare("SELECT id, email, access_generation AS generation FROM operators WHERE removed_at IS NULL ORDER BY created_at").all<{ id: string; email: string; generation: number }>()).results;
}
