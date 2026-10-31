import { hashToken } from "../../platform/auth/tokens";
import type { DeliveryOutboxRecord } from "./repository";

/** Dispatch the complete due reminder batch during its final eligible Cron minute. */
export async function duePollReminderIds(db: D1Database, now: string) {
  const rows = await db.prepare(`SELECT id FROM delivery_outbox
    WHERE state='pending' AND next_attempt_at<=?
      AND CASE WHEN json_valid(payload_json) THEN json_type(payload_json,'$.pollReminderOffsetMinutes') END IS NOT NULL
      AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.archiveHistorical') END IS NOT 1`)
    .bind(now).all<{id:string}>();
  return rows.results.map(row => row.id);
}

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
