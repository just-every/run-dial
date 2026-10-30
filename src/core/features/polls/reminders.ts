import { createId } from "../../shared/ids";
import { hashToken } from "../../platform/auth/tokens";
import { renderBrandedMail } from "../delivery/mail";

/** Durable offsets are relative to closure; no implicit cadence or catch-up after expiry. */
export class PollReminders {
  constructor(private readonly db: D1Database, private readonly secret: string, private readonly origin: string) {}

  async configure(id: string, offsets: number[], now = new Date()) {
    const json = JSON.stringify([...offsets].sort((a, b) => b - a));
    // Once scheduling has started, only disabling is allowed. Reconfiguration
    // cannot reset delivered history and multiply the owner's configured sends.
    return this.db.prepare(`UPDATE meeting_polls SET reminder_offsets_json=?,updated_at=?
      WHERE id=? AND state='open' AND closes_at>?
        AND NOT EXISTS(SELECT 1 FROM json_each(?) WHERE strftime('%Y-%m-%dT%H:%M:%fZ',closes_at,'-'||value||' minutes')<=?)
        AND (?='[]' OR NOT EXISTS(SELECT 1 FROM delivery_outbox d JOIN poll_participants p
          ON p.id=json_extract(d.payload_json,'$.pollParticipantId')
          WHERE p.poll_id=meeting_polls.id AND json_type(d.payload_json,'$.pollReminderOffsetMinutes') IS NOT NULL))
      RETURNING id`).bind(json,now.toISOString(),id,now.toISOString(),json,now.toISOString(),json).first();
  }

  async sweep(now = new Date(), limit = 100) {
    const timestamp = now.toISOString();
    const due = await this.db.prepare(`SELECT m.id AS pollId,m.title,m.closes_at AS closesAt,
        p.id AS participantId,p.email,t.token_hash AS tokenHash,o.value AS offsetMinutes,
        invitation.payload_json AS invitationPayload
      FROM meeting_polls m JOIN json_each(m.reminder_offsets_json) o
      JOIN poll_participants p ON p.poll_id=m.id
      JOIN poll_vote_tokens t ON t.participant_id=p.id
      JOIN delivery_outbox invitation ON invitation.idempotency_key='poll-invitation:'||p.id
      WHERE m.state='open' AND m.closes_at>? AND p.revision=0
        AND NOT EXISTS(SELECT 1 FROM poll_votes WHERE participant_id=p.id)
        AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=p.email)
        AND strftime('%Y-%m-%dT%H:%M:%fZ',m.closes_at,'-'||o.value||' minutes')<=?
        AND NOT EXISTS(SELECT 1 FROM delivery_outbox WHERE idempotency_key='poll-reminder:'||p.id||':'||o.value)
      ORDER BY m.closes_at,o.value DESC,p.id LIMIT ?`).bind(timestamp,timestamp,limit)
      .all<{pollId:string;title:string;closesAt:string;participantId:string;email:string;tokenHash:string;offsetMinutes:number;invitationPayload:string}>();
    let queued = 0;
    for (const item of due.results) {
      const url = await this.liveLink(item.invitationPayload,item.pollId,item.tokenHash);
      if (!url) continue;
      const payload = { to:item.email,subject:`Reminder: ${item.title}`,
        text:`${item.title}\nPlease choose your availability: ${url.href}\nThis personal link expires when the poll closes.`,
        html:renderBrandedMail({businessName:"Dial",heading:item.title,intro:"Please choose your availability before this poll closes.",facts:[{label:"Your personal poll link",value:url.href}]}),
        pollId:item.pollId,pollParticipantId:item.participantId,pollReminderOffsetMinutes:item.offsetMinutes,pollLink:url.href };
      // Recheck eligibility in the INSERT so a vote, erasure, closure or changed
      // configuration between the read and write cannot admit stale work.
      const inserted = await this.db.prepare(`INSERT INTO delivery_outbox
        (id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
        SELECT ?,'mail_send',?,?,'pending',0,?,?,? FROM poll_participants p
        JOIN meeting_polls m ON m.id=p.poll_id JOIN poll_vote_tokens t ON t.participant_id=p.id
        WHERE p.id=? AND p.revision=0 AND m.state='open' AND m.closes_at>?
          AND t.token_hash=? AND NOT EXISTS(SELECT 1 FROM poll_votes WHERE participant_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=p.email)
          AND EXISTS(SELECT 1 FROM json_each(m.reminder_offsets_json) WHERE value=?)
        ON CONFLICT(idempotency_key) DO NOTHING`).bind(createId(),`poll-reminder:${item.participantId}:${item.offsetMinutes}`,
          JSON.stringify(payload),timestamp,timestamp,timestamp,item.participantId,timestamp,item.tokenHash,item.offsetMinutes).run();
      queued += inserted.meta.changes;
    }
    return {queued};
  }

  private async liveLink(invitationPayload: string, pollId: string, tokenHash: string) {
    const invitation = JSON.parse(invitationPayload) as {pollLink?:string;text?:string};
    // Older invitations have only rendered text. A URL in the host's title
    // must neither hide the personal link nor become the reminder's action.
    const candidates = [invitation.pollLink,...(invitation.text?.match(/https?:\/\/\S+/gu) ?? [])];
    for (const candidate of candidates) {
      if (!candidate) continue;
      let url: URL;
      try { url = new URL(candidate); } catch { continue; }
      const token = url.searchParams.get("token");
      if (url.origin === new URL(this.origin).origin && url.pathname === `/poll/${pollId}`
        && !url.username && !url.password && token && await hashToken(token,this.secret) === tokenHash) return url;
    }
  }
}
