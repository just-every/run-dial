import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { createId } from "../../shared/ids";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { renderBrandedMail } from "../delivery/mail";
import { invitationBookingId } from "./invitation-capability";
import { BookingsRepository } from "./repository";

const lifetime = 90 * 24 * 60 * 60 * 1000;
export const replacementLinkNotice = "Your earlier manage link no longer works. Use the replacement link in this email.";

export class InvitationManageService {
  constructor(private readonly db: D1Database, private readonly runtime: RuntimeEnvironment) {}

  async access(token: string) {
    const id = await invitationBookingId(token, this.runtime);
    const booking = id ? await new BookingsRepository(this.db).getById(id) : undefined;
    if (!booking) return { kind: "not_found" as const };
    const expiresAt = new Date(Date.parse(booking.occurrence.startAt) + lifetime).toISOString();
    if (booking.state === "cancelled" || expiresAt <= new Date().toISOString()) return { kind: "expired" as const };
    return { kind: "available" as const, booking, expiresAt };
  }

  /** The coordinator serializes this transaction with changes, delivery and erasure. */
  async emailReplacement(token: string) {
    const access = await this.access(token);
    if (access.kind !== "available") return access.kind;
    const { booking, expiresAt } = access;
    const now = new Date().toISOString(), id = createId();
    const manageToken = createOpaqueToken(), tokenHash = await hashToken(manageToken, this.runtime.SESSION_SECRET);
    const manageUrl = new URL(`/manage/${manageToken}`, this.runtime.APP_URL).toString();
    const subject = "Your replacement booking manage link";
    const email = { to: booking.inviteeEmail, recipientRole: "invitee", messageKind: "invitation_manage", manageUrl, subject,
      text: `A replacement manage link was requested from your calendar invitation.\n\n${replacementLinkNotice}\n\nManage this booking: ${manageUrl}`,
      html: renderBrandedMail({ businessName: "Dial", heading: subject, paragraphs: ["A replacement manage link was requested from your calendar invitation.", replacementLinkNotice], actions: [{ label: "Manage booking", href: manageUrl }] }) };
    const admitted = "EXISTS (SELECT 1 FROM booking_request_history WHERE id=?)";
    await this.db.batch([
      // A shared calendar must not become a mail flood. Repeated clicks acknowledge
      // the pending request without rotating again or exposing delivery state.
      this.db.prepare(`INSERT INTO booking_request_history(id,booking_id,occurrence_id,action,actor_type,reason,created_at)
        SELECT ?,id,current_occurrence_id,'manage_link_rotated','system','Replacement link requested from calendar invitation; earlier manage links no longer work.',? FROM bookings WHERE id=? AND state IN ('confirmed','rescheduled')
        AND current_occurrence_id=? AND NOT EXISTS (SELECT 1 FROM booking_request_history WHERE booking_id=? AND action='manage_link_rotated' AND created_at>?)`)
        .bind(id, now, booking.id, booking.occurrence.id, booking.id, new Date(Date.parse(now)-60_000).toISOString()),
      this.db.prepare(`UPDATE booking_manage_tokens SET rotated_at=?,updated_at=? WHERE booking_id=? AND rotated_at IS NULL AND invalidated_at IS NULL AND ${admitted}`).bind(now,now,booking.id,id),
      this.db.prepare(`INSERT INTO booking_manage_tokens(id,booking_id,token_hash,expires_at,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE ${admitted}`).bind(id,booking.id,tokenHash,expiresAt,now,now,id),
      this.db.prepare(`UPDATE delivery_outbox SET payload_json=json_set(payload_json,'$.manageUrl',?),updated_at=? WHERE booking_id=? AND json_extract(payload_json,'$.recipientRole')='invitee' AND ${admitted}`).bind(manageUrl,now,booking.id,id),
      this.db.prepare(`INSERT INTO delivery_outbox(id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
        SELECT ?,'mail_send',?,?,?,?, 'pending',0,?,?,? WHERE ${admitted}`)
        .bind(createId(),`booking:${booking.id}:invitation-manage:${id}`,booking.id,booking.occurrence.id,JSON.stringify(email),now,now,now,id),
    ]);
    return "accepted" as const;
  }
}
