import { hashToken } from "../../platform/auth/tokens";
import type { DeliveryOutboxRecord } from "./repository";

/** Reminders revalidate live participation even when a retry has frozen mail bytes. */
export async function pollReminderAuthorized(db: D1Database, record: DeliveryOutboxRecord, now: string, secret: string) {
  const payload = JSON.parse(record.payloadJson) as Record<string, unknown>;
  if (payload.pollReminderOffsetMinutes === undefined) return true;
  if (typeof payload.pollParticipantId !== "string" || typeof payload.pollId !== "string"
    || typeof payload.pollReminderOffsetMinutes !== "number" || typeof payload.pollLink !== "string") return false;
  let token: string | null;
  try {
    const link = new URL(payload.pollLink);
    if (link.pathname !== `/poll/${payload.pollId}`) return false;
    token = link.searchParams.get("token");
  } catch { return false; }
  if (!token) return false;
  return Boolean(await db.prepare(`SELECT 1 FROM poll_participants p
    JOIN meeting_polls m ON m.id=p.poll_id JOIN poll_vote_tokens t ON t.participant_id=p.id
    JOIN delivery_outbox d ON d.id=? AND d.state='processing' AND d.attempts=?
    WHERE p.id=? AND p.poll_id=? AND p.email=? AND p.revision=0 AND m.state='open' AND m.closes_at>?
      AND t.token_hash=? AND NOT EXISTS(SELECT 1 FROM poll_votes WHERE participant_id=p.id)
      AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=p.email)
      AND EXISTS(SELECT 1 FROM json_each(m.reminder_offsets_json)
        WHERE value=? AND strftime('%Y-%m-%dT%H:%M:%fZ',m.closes_at,'-'||value||' minutes')<=?)`)
    .bind(record.id,record.attempts,payload.pollParticipantId,payload.pollId,payload.to,now,
      await hashToken(token,secret),payload.pollReminderOffsetMinutes,now).first());
}
