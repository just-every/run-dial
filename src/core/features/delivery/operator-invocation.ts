import { ProviderFailure } from "../../platform/calendar";
import type { MailSender } from "../../platform/mail";
import { nowIso } from "../../shared/ids";
import { toMailMessage } from "./email-content";
import { operatorMailRevoked } from "./operator-mail";

/** Called only inside the notification singleton's concurrency gate. The caller
 * retains its booking/request coordinator while this invocation completes.
 */
export async function invokeOperatorMail(binding: D1Database, mail: MailSender, outboxId: string, attempt: number) {
  const row = await binding.prepare("SELECT state, attempts, payload_json AS payload FROM delivery_outbox WHERE id = ?")
    .bind(outboxId).first<{ state: string; attempts: number; payload: string }>();
  if (!row || row.state !== "processing" || row.attempts !== attempt || await operatorMailRevoked(binding, outboxId)) {
    throw new ProviderFailure("operator_removed", false);
  }
  const payload = JSON.parse(row.payload);
  const message = toMailMessage(payload.wireMail, payload.wireMail?.idempotencyKey);
  if (!message) throw new ProviderFailure("invalid_delivery_payload", false);
  const unresolved = await binding.prepare("SELECT 1 FROM operator_mail_invocations WHERE provider_key = ? AND state = 'invoking'")
    .bind(message.idempotencyKey).first();
  if (unresolved) throw new ProviderFailure("operator_mail_outcome_unknown", false);
  const accepted = await binding.prepare("SELECT provider_message_id AS id FROM operator_mail_invocations WHERE provider_key = ? AND state = 'succeeded' ORDER BY finished_at DESC LIMIT 1")
    .bind(message.idempotencyKey).first<{ id: string | null }>();
  if (accepted) return accepted.id;
  await binding.prepare("INSERT INTO operator_mail_invocations (outbox_id, attempt_number, provider_key, state, started_at) VALUES (?, ?, ?, 'invoking', ?)")
    .bind(outboxId, attempt, message.idempotencyKey, nowIso()).run();
  // Removal uses this same DO gate. It cannot complete between the read/admission
  // above and this synchronous invocation, even if D1 delays a SELECT response.
  let receipt;
  try {
    receipt = await mail.send(message);
  } catch (error) {
    const failure = error instanceof ProviderFailure ? error : new ProviderFailure("internal_error", false);
    await binding.prepare("UPDATE operator_mail_invocations SET state = 'failed', error_code = ?, finished_at = ? WHERE outbox_id = ? AND attempt_number = ?")
      .bind(failure.code, nowIso(), outboxId, attempt).run();
    throw failure;
  }
  await binding.prepare("UPDATE operator_mail_invocations SET state = 'succeeded', provider_message_id = ?, finished_at = ? WHERE outbox_id = ? AND attempt_number = ?")
    .bind(receipt.providerMessageId, nowIso(), outboxId, attempt).run();
  return receipt.providerMessageId;
}
