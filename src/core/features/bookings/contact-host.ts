import { operatorRecipientAdmission } from "../delivery/mail";
import { createId } from "../../shared/ids";
import type { BookingRecord } from "./types";

/** A direct message is separate from booking notices: it neither changes the occurrence nor creates reminders. */
export async function contactHost(binding: D1Database, booking: BookingRecord, key: string, message: string | undefined, now: string) {
  const recipient = await binding.prepare(`SELECT projection.id, account.email, projection.access_generation AS generation
    FROM operator_setup_identity identity JOIN oa_operators account ON account.id=identity.operator_id
    JOIN operators projection ON projection.id=account.id
    WHERE identity.singleton_key='default' AND account.status='active' AND projection.removed_at IS NULL
      AND projection.erased_at IS NULL AND projection.normalized_email=lower(trim(account.email))`)
    .first<{ id: string; email: string; generation: number }>();
  const recipients = recipient ? [recipient] : [];
  if (recipients.length === 0) throw new Error("No active host can receive the message.");
  await binding.batch(recipients.map(recipient => {
    const email = { messageKind: "host_contact", to: recipient.email, recipientRole: "operator" as const, operatorAccess: { id: recipient.id, generation: recipient.generation },
      replyTo: booking.inviteeEmail, subject: `Message about ${booking.eventTitle}`,
      text: `${booking.inviteeName} (${booking.inviteeEmail}) contacted the host about ${booking.eventTitle}.\nBooking: ${booking.id}\n${message || "Please contact me about changing this booking."}` };
    const admission = operatorRecipientAdmission(email);
    return binding.prepare(`INSERT INTO delivery_outbox (id,kind,idempotency_key,booking_id,occurrence_id,request_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
      SELECT ?,'mail_send',?,?,NULL,NULL,?,'pending',0,?,?,? WHERE ${admission.sql}
      ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind(createId(), `booking:${booking.id}:contact:${key}:${recipient.id}`, booking.id, JSON.stringify(email), now, now, now, ...admission.params);
  }));
}
