// Older connection/request commands predate recipientRole. Their server-owned
// keys distinguish operator notices from an independent invitee at the same address.
// Explicit retries retain the original provider key and frozen message.
const mailKey = "COALESCE(json_extract(d.payload_json, '$.providerIdempotencyKey'), d.idempotency_key)";
const operatorMail = `(json_extract(d.payload_json, '$.recipientRole') = 'operator' OR
  (json_extract(d.payload_json, '$.recipientRole') IS NULL AND
    ((substr(${mailKey}, 1, 11) = 'connection:' AND instr(${mailKey}, ':operator:') > 11) OR
     (substr(${mailKey}, 1, length('request:' || d.request_id || ':operator:')) = 'request:' || d.request_id || ':operator:'
       AND substr(${mailKey}, -10) = ':submitted'))))`;
const recipient = "lower(trim(COALESCE(json_extract(d.payload_json, '$.wireMail.to'), json_extract(d.payload_json, '$.to'))))";

/** Include this in the access-change transaction, while the identity is removed.
 * Annotate authority separately from frozen provider bytes and attempt history.
 * Completed/failed delivery history stays intact, including late bounce handling;
 * reinviting an identity must never revive its former notifications.
 */
export function revokeOperatorMail(binding: D1Database, identity: { id: string; removedAt: string } | { email: string; actorId: string }, now: string) {
  const guard = "id" in identity ? "o.id = ? AND o.removed_at = ?"
    : "o.normalized_email = ? AND EXISTS (SELECT 1 FROM operators actor WHERE actor.id = ? AND actor.removed_at IS NULL) AND EXISTS (SELECT 1 FROM operator_setup_identity)";
  const values = "id" in identity ? [identity.id, identity.removedAt] : [identity.email, identity.actorId];
  return binding.prepare(`UPDATE delivery_outbox AS d
    SET payload_json = json_set(payload_json, '$.operatorAccessRevoked', json('true')),
      state = CASE WHEN state IN ('pending', 'processing') THEN 'failed' ELSE state END,
      last_error_code = CASE WHEN state IN ('pending', 'processing') THEN 'operator_removed' ELSE last_error_code END,
      updated_at = ?
    WHERE d.kind IN ('mail_send', 'reminder')
      AND ${operatorMail}
      AND EXISTS (SELECT 1 FROM operators o WHERE ${guard} AND o.removed_at IS NOT NULL
        AND o.normalized_email = ${recipient})`).bind(now, ...values);
}

/** Check authority inside the shared notification/removal invocation gate. */
export async function operatorMailRevoked(binding: D1Database, outboxId: string) {
  return Boolean(await binding.prepare(`SELECT 1 FROM delivery_outbox d WHERE d.id = ?
    AND d.kind IN ('mail_send', 'reminder') AND ${operatorMail}
    AND (json_extract(d.payload_json, '$.operatorAccessRevoked') = 1 OR d.last_error_code = 'operator_removed' OR NOT EXISTS
      (SELECT 1 FROM operators o JOIN oa_operators authority ON authority.id=o.id WHERE o.removed_at IS NULL AND authority.status='active' AND authority.role='owner' AND o.normalized_email = ${recipient}
        AND ((json_type(d.payload_json, '$.operatorAccess') IS NULL AND o.access_generation = 0)
          OR (o.id = json_extract(d.payload_json, '$.operatorAccess.id')
            AND o.access_generation = json_extract(d.payload_json, '$.operatorAccess.generation')))))`)
    .bind(outboxId).first());
}

/** Mirrors the durable predicate for selecting the invocation boundary. */
export function isOperatorNotification(record: { idempotencyKey: string; requestId: string | null }, payload: Record<string, unknown>) {
  if (payload.recipientRole === "operator") return true;
  if (payload.recipientRole != null) return false;
  const key = typeof payload.providerIdempotencyKey === "string" ? payload.providerIdempotencyKey : record.idempotencyKey;
  return (key.startsWith("connection:") && key.indexOf(":operator:") >= 11)
    || (record.requestId !== null && key.startsWith(`request:${record.requestId}:operator:`) && key.endsWith(":submitted"));
}

/** Revalidate a selected operator in the same statement that stores its private
 * recipient bytes. Removal or a new identity at the address must omit this
 * command without aborting the surrounding booking/request transaction.
 */
export function operatorRecipientAdmission(recipient: {
  to: string;
  recipientRole: "operator" | "invitee";
  operatorAccess?: { id: string; generation: number };
}): { sql: string; params: (string | number)[] } {
  if (recipient.recipientRole === "invitee") return { sql: "1", params: [] };
  if (!recipient.operatorAccess) throw new Error("Operator mail is missing its recipient admission");
  return {
    sql: `EXISTS (SELECT 1 FROM operators recipient
      JOIN oa_operators authority ON authority.id = recipient.id
      WHERE recipient.id = ? AND recipient.access_generation = ?
        AND recipient.normalized_email = ? AND recipient.removed_at IS NULL
        AND recipient.erased_at IS NULL AND authority.status = 'active' AND authority.role='owner'
        AND lower(trim(authority.email)) = recipient.normalized_email)`,
    params: [recipient.operatorAccess.id, recipient.operatorAccess.generation, recipient.to.trim().toLowerCase()],
  };
}
