// Direct sender fixtures still need the durable command that authorizes the
// effect. Retain its recipient and exact wire bytes through the real repository.
export async function admitMailSource(db, repository, message) {
  const timestamp = new Date().toISOString();
  const id = `source:${message.idempotencyKey}`;
  await db.prepare("INSERT INTO delivery_outbox (id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) VALUES (?,'mail_send',?,?,'processing',1,?,?,?)")
    .bind(id, message.idempotencyKey, JSON.stringify({ to: message.to, subject: message.subject, text: message.text }), timestamp, timestamp, timestamp).run();
  await repository.freezeMail({ id }, message);
}
