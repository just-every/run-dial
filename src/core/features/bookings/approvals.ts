import { createId, nowIso } from "../../shared/ids";
import { foldBookingSearch } from "./search/case-fold.mjs";
import { slotClaimGuard, nonceAdmission } from "./claim-guard";
import { operatorRecipientAdmission, renderBrandedMail } from "../delivery/mail";
import type { BookingClaim, BookingEmail } from "./types";
export type ApprovalSettings = {
    required: boolean;
    windowHours: number;
};
export type ApprovalRequest = {
    id: string;
    bookingId: string;
    eventTypeId: string;
    state: "pending" | "approved" | "declined" | "expired";
    inviteeEmail: string;
    inviteeName: string;
    eventTitle: string;
    startAt: string;
    endAt: string;
    expiresAt: string;
    claimJson: string | null;
    decidedBy: string | null;
    reason: string | null;
    createdAt: string;
    updatedAt: string;
};
const columns = "id,booking_id AS bookingId,event_type_id AS eventTypeId,state,invitee_email AS inviteeEmail,invitee_name AS inviteeName,event_title AS eventTitle,start_at AS startAt,end_at AS endAt,expires_at AS expiresAt,claim_json AS claimJson,decided_by AS decidedBy,reason,created_at AS createdAt,updated_at AS updatedAt";
export class ApprovalsRepository {
    constructor(private readonly db: D1Database) { }
    async settings(eventId: string): Promise<ApprovalSettings> { const row = await this.db.prepare("SELECT approval_required AS required,approval_window_hours AS windowHours FROM event_types WHERE id=?").bind(eventId).first<{
        required: number;
        windowHours: number;
    }>(); return { required: row?.required === 1, windowHours: row?.windowHours ?? 24 }; }
    async saveSettings(eventId: string, input: ApprovalSettings) { return (await this.db.prepare("UPDATE event_types SET approval_required=?,approval_window_hours=?,updated_at=? WHERE id=?").bind(input.required ? 1 : 0, input.windowHours, nowIso(), eventId).run()).meta.changes > 0; }
    async get(id: string) { return await this.db.prepare(`SELECT ${columns} FROM booking_approval_requests WHERE id=?`).bind(id).first<ApprovalRequest>() ?? undefined; }
    async forNonce(id: string) { return await this.db.prepare(`SELECT ${columns} FROM booking_approval_requests WHERE nonce_id=?`).bind(id).first<ApprovalRequest>() ?? undefined; }
    async byToken(hash: string) { return await this.db.prepare(`SELECT ${columns} FROM booking_approval_requests WHERE id=(SELECT request_id FROM booking_approval_tokens WHERE token_hash=?)`).bind(hash).first<ApprovalRequest>() ?? undefined; }
    async pending() { return (await this.db.prepare(`SELECT ${columns} FROM booking_approval_requests WHERE state='pending' ORDER BY created_at LIMIT 100`).all<ApprovalRequest>()).results; }
    async due() { return (await this.db.prepare("SELECT id,booking_id AS bookingId FROM booking_approval_requests WHERE state='pending' AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 100").all<{
        id: string;
        bookingId: string;
    }>()).results; }
    async hold(claim: BookingClaim, tokenHash: string, windowHours: number, emails: BookingEmail[]) {
        const id = createId(), now = nowIso(), expiresAt = new Date(Math.min(Date.parse(claim.selection.startAt), Date.now() + windowHours * 3600000)).toISOString();
        const nonce = await this.db.prepare("SELECT link_id AS linkId FROM booking_nonces WHERE id=?").bind(claim.nonceId).first<{
            linkId: string | null;
        }>();
        const guard = await slotClaimGuard(this.db, claim, nonceAdmission(claim.nonceId, claim.nonceHash, now), nonce?.linkId);
        const statements = [...[claim.invitee.email, ...claim.invitee.guests ?? []].map(email => this.db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?) THEN 1 ELSE abs(-9223372036854775808) END").bind(foldBookingSearch(email))),
            this.db.prepare(`INSERT INTO booking_approval_requests(id,nonce_id,link_id,booking_id,event_type_id,state,invitee_email,invitee_name,event_title,start_at,end_at,occupied_start_at,occupied_end_at,host_date,expires_at,claim_json,created_at,updated_at) SELECT ?,?,?,?,?, 'pending',?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql} AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM booking_approval_requests other WHERE other.link_id=? AND other.state='pending' AND other.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) )`).bind(id, claim.nonceId, nonce?.linkId ?? null, claim.bookingId, claim.event.id, claim.invitee.email, claim.invitee.name, claim.event.title, claim.selection.startAt, claim.selection.endAt, claim.occupiedStartAt, claim.occupiedEndAt, claim.hostDate, expiresAt, JSON.stringify(claim), now, now, ...guard.params, nonce?.linkId ?? null, nonce?.linkId ?? null),
            this.db.prepare("INSERT INTO booking_approval_tokens(request_id,token_hash,created_at,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM booking_approval_requests WHERE id=?)").bind(id, tokenHash, now, now, id),
            this.db.prepare("UPDATE booking_nonces SET consumed_at=?,payload_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM booking_approval_requests WHERE id=?)").bind(now, claim.payloadHash, claim.nonceId, id),
            ...emails.map(email => this.mail(id, "pending", email, now))];
        await this.db.batch(statements);
        return this.get(id);
    }
    async decide(request: ApprovalRequest, state: "declined" | "expired", operatorId: string | null, reason: string, emails: BookingEmail[]) {
        const now = nowIso();
        await this.db.batch([this.db.prepare("UPDATE booking_approval_requests SET state=?,decided_by=?,reason=?,claim_json=NULL,updated_at=? WHERE id=? AND state='pending'").bind(state, operatorId, reason, now, request.id), ...emails.map(email => this.mail(request.id, state, email, now))]);
    }
    approvedStatement(id: string, bookingId: string, operatorId: string, now: string) { return this.db.prepare("UPDATE booking_approval_requests SET state='approved',decided_by=?,updated_at=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM bookings WHERE id=?)").bind(operatorId, now, id, bookingId); }
    /** Request/decision notices are linked through their structured request id for privacy erasure. */
    private mail(id: string, state: ApprovalRequest['state'], email: BookingEmail, now: string) { const admission = operatorRecipientAdmission(email); return this.db.prepare(`INSERT INTO delivery_outbox(id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) SELECT ?,'mail_send',?,?,'pending',0,?,?,? WHERE EXISTS(SELECT 1 FROM booking_approval_requests WHERE id=? AND state=?) AND ${admission.sql} ON CONFLICT(idempotency_key) DO NOTHING`).bind(createId(), `approval:${id}:${state}:${email.recipientRole}:${email.operatorAccess?.id ?? "invitee"}`, JSON.stringify({ ...email, approvalRequestId: id }), now, now, now, id, state, ...admission.params); }
}
export function approvalMail(input: {
    title: string;
    startAt: string;
    endAt: string;
    expiresAt?: string;
    inviteeName: string;
    inviteeEmail: string;
    hostUrl?: string;
    publicUrl?: string;
    reason?: string;
}, to: string, state: ApprovalRequest['state'], operator?: {
    id: string;
    generation: number;
}): BookingEmail {
    const heading = state === 'pending' ? 'Booking approval requested' : state === 'declined' ? 'Booking request declined' : state === 'expired' ? 'Booking request expired' : 'Booking request approved';
    const facts = [{ label: 'Event', value: input.title }, { label: 'Time (UTC)', value: `${input.startAt} – ${input.endAt}` }, ...(input.expiresAt ? [{ label: 'Approval deadline', value: input.expiresAt }] : []), ...(operator ? [{ label: 'Invitee', value: `${input.inviteeName} <${input.inviteeEmail}>` }] : [])];
    const url = operator ? input.hostUrl : input.publicUrl;
    return { to, recipientRole: operator ? 'operator' : 'invitee', ...(operator ? { operatorAccess: operator } : {}), subject: `${heading}: ${input.title}`, text: [heading, ...facts.map(f => `${f.label}: ${f.value}`), ...(input.reason ? [`Reason: ${input.reason}`] : []), ...(url ? [`View request: ${url}`] : [])].join('\n'), html: renderBrandedMail({ businessName: 'Dial', heading, facts, paragraphs: input.reason ? [input.reason] : [], actions: url ? [{ label: 'View request', href: url }] : [] }) };
}
