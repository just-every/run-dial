import { createId, nowIso } from "../../shared/ids";
import { foldBookingSearch } from "./search/case-fold.mjs";
import { slotClaimGuard, nonceAdmission } from "./claim-guard";
import { operatorRecipientAdmission, renderBrandedMail } from "../delivery/mail";
import type { BookingClaim, BookingEmail } from "./types";
import { approvalAudit, type ApprovalPayment } from "../payments";
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
    paymentJson: string | null;
    decidedBy: string | null;
    reason: string | null;
    createdAt: string;
    updatedAt: string;
};
const columns = "id,booking_id AS bookingId,event_type_id AS eventTypeId,state,invitee_email AS inviteeEmail,invitee_name AS inviteeName,event_title AS eventTitle,start_at AS startAt,end_at AS endAt,expires_at AS expiresAt,claim_json AS claimJson,payment_json AS paymentJson,decided_by AS decidedBy,reason,created_at AS createdAt,updated_at AS updatedAt";
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
    async due() { return (await this.db.prepare("SELECT id,booking_id AS bookingId FROM booking_approval_requests a WHERE state='pending' AND claim_json IS NOT NULL AND (expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR json_extract(payment_json,'$.state') IN ('setup_pending','capture_pending','void_pending','refund_pending')) AND (payment_json IS NULL OR EXISTS(SELECT 1 FROM payment_holds h WHERE h.id=json_extract(a.payment_json,'$.holdId') AND h.state IN ('held','processing') AND h.claim_json IS NOT NULL)) LIMIT 100").all<{
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
    approvedStatement(id: string, bookingId: string, operatorId: string, now: string) { return this.db.prepare("UPDATE booking_approval_requests SET state='approved',decided_by=?,payment_json=CASE WHEN payment_json IS NULL THEN NULL ELSE json_set(payment_json,'$.state','captured') END,updated_at=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM bookings WHERE id=?)").bind(operatorId, now, id, bookingId); }
    async holdPayment(claim: BookingClaim, payment: ApprovalPayment, emails: BookingEmail[]) {
        const existing = await this.forNonce(claim.nonceId);
        if (existing) return existing;
        const approval = claim.money!.approval!, id = createId(), now = nowIso();
        const expiresAt = payment.state==="setup_pending" ? payment.setupExpiresAt! : new Date(Math.min(Date.parse(claim.selection.startAt), Date.parse(payment.authorizedAt) + approval.windowHours * 3600000)).toISOString();
        await this.db.batch([
            ...[claim.invitee.email, ...claim.invitee.guests ?? []].map(email => this.db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?) THEN 1 ELSE abs(-9223372036854775808) END").bind(foldBookingSearch(email))),
            this.db.prepare("INSERT INTO booking_approval_requests(id,nonce_id,link_id,booking_id,event_type_id,state,invitee_email,invitee_name,event_title,start_at,end_at,occupied_start_at,occupied_end_at,host_date,expires_at,claim_json,payment_json,created_at,updated_at) SELECT ?,?,(SELECT link_id FROM booking_nonces WHERE id=?),?,?,'pending',?,?,?,?,?,?,?,?,?,?,?, ?,? WHERE EXISTS(SELECT 1 FROM payment_holds WHERE id=? AND state IN ('held','processing') AND claim_json IS NOT NULL) ON CONFLICT(nonce_id) DO NOTHING")
                .bind(id, claim.nonceId, claim.nonceId, claim.bookingId, claim.event.id, claim.invitee.email, claim.invitee.name, claim.event.title, claim.selection.startAt, claim.selection.endAt, claim.occupiedStartAt, claim.occupiedEndAt, claim.hostDate, expiresAt, JSON.stringify(claim), JSON.stringify(payment), now, now, payment.holdId),
            this.db.prepare("INSERT INTO booking_approval_tokens(request_id,token_hash,created_at,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM booking_approval_requests WHERE id=?)").bind(id, approval.tokenHash, now, now, id),
            this.db.prepare("UPDATE payment_holds SET state='processing',updated_at=? WHERE id=? AND state='held' AND EXISTS(SELECT 1 FROM booking_approval_requests WHERE id=?)").bind(now, payment.holdId, id),
            approvalAudit(this.db, payment, "authorize", {sql:"EXISTS(SELECT 1 FROM booking_approval_requests WHERE id=?)",params:[id]}),
            ...emails.map(email => this.mail(id, "pending", email, now)),
        ]);
        return this.forNonce(claim.nonceId);
    }
    async paymentCommand(request: ApprovalRequest, payment: ApprovalPayment, capture: boolean) {
        await this.db.prepare(`UPDATE booking_approval_requests SET payment_json=?,decided_by=?,reason=?,updated_at=? WHERE id=? AND state='pending' AND claim_json IS NOT NULL AND json_extract(payment_json,'$.state') IN (${capture ? "'authorized'" : "'setup_pending','authorized','capture_pending'"}) AND EXISTS(SELECT 1 FROM payment_holds h WHERE h.id=? AND h.state IN ('held','processing') AND h.claim_json IS NOT NULL) ${capture ? "AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?)" : ""}`)
            .bind(JSON.stringify(payment), payment.actorId ?? null, payment.voidReason ?? null, nowIso(), request.id, payment.holdId, ...(capture ? [foldBookingSearch(request.inviteeEmail)] : [])).run();
        return this.get(request.id);
    }
    async replacePayment(request: ApprovalRequest, from: ApprovalPayment["state"], payment: ApprovalPayment) {
        await this.db.prepare("UPDATE booking_approval_requests SET payment_json=?,updated_at=? WHERE id=? AND state='pending' AND claim_json IS NOT NULL AND json_extract(payment_json,'$.state')=? AND EXISTS(SELECT 1 FROM payment_holds h WHERE h.id=? AND h.state IN ('held','processing') AND h.claim_json IS NOT NULL)").bind(JSON.stringify(payment), nowIso(), request.id, from, payment.holdId).run();
        return this.get(request.id);
    }
    async readyPayment(request: ApprovalRequest, payment: ApprovalPayment, emails: BookingEmail[]) {
        const now=nowIso(),expiresAt=new Date(Math.min(Date.parse(request.startAt),Date.parse(payment.authorizedAt)+JSON.parse(request.claimJson!).money.approval.windowHours*3600000)).toISOString();
        await this.db.batch([
            this.db.prepare("UPDATE booking_approval_requests SET payment_json=?,expires_at=?,updated_at=? WHERE id=? AND state='pending' AND json_extract(payment_json,'$.state')='setup_pending' AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?)").bind(JSON.stringify(payment),expiresAt,now,request.id,foldBookingSearch(request.inviteeEmail)),
            ...emails.map(email=>this.mail(request.id,"pending",email,now,"authorized")),
        ]);
        return this.get(request.id);
    }
    async paymentFact(payment: ApprovalPayment, action: keyof ApprovalPayment["audit"]) { await approvalAudit(this.db, payment, action).run(); }
    async erasing(email: string) { return Boolean(await this.db.prepare("SELECT 1 FROM person_erasure_locks WHERE email=?").bind(foldBookingSearch(email)).first()); }
    async finishPayment(request: ApprovalRequest, payment: ApprovalPayment, emails: BookingEmail[], actions: Array<keyof ApprovalPayment["audit"]>) {
        const now = nowIso(), state = payment.voidState ?? "expired";
        const condition = {sql:"EXISTS(SELECT 1 FROM booking_approval_requests WHERE id=? AND state=? AND json_extract(payment_json,'$.state')=?)",params:[request.id,state,payment.state]};
        await this.db.batch([
            this.db.prepare("UPDATE booking_approval_requests SET state=?,reason=?,claim_json=NULL,payment_json=?,updated_at=? WHERE id=? AND state='pending' AND claim_json IS NOT NULL AND json_extract(payment_json,'$.state') IN ('void_pending','refund_pending')").bind(state,payment.voidReason ?? null,JSON.stringify(payment),now,request.id),
            this.db.prepare(`UPDATE payment_holds SET state='released',ended_reason=?,claim_json=NULL,invitee_email_folded=NULL,checkout_url=NULL,updated_at=? WHERE id=? AND state IN ('held','processing') AND ${condition.sql}`).bind(`approval_${state}`,now,payment.holdId,...condition.params),
            ...actions.map(action=>approvalAudit(this.db,payment,action,condition)),
            ...emails.map(email=>this.mail(request.id,state,email,now)),
        ]);
    }
    /** Request/decision notices are linked through their structured request id for privacy erasure. */
    private mail(id: string, state: ApprovalRequest['state'], email: BookingEmail, now: string, paymentState?: string) { const admission = operatorRecipientAdmission(email); return this.db.prepare(`INSERT INTO delivery_outbox(id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) SELECT ?,'mail_send',?,?,'pending',0,?,?,? WHERE EXISTS(SELECT 1 FROM booking_approval_requests WHERE id=? AND state=? AND (? IS NULL OR json_extract(payment_json,'$.state')=?)) AND ${admission.sql} ON CONFLICT(idempotency_key) DO NOTHING`).bind(createId(), `approval:${id}:${state}:${email.recipientRole}:${email.operatorAccess?.id ?? "invitee"}`, JSON.stringify({ ...email, approvalRequestId: id }), now, now, now, id, state, paymentState??null,paymentState??null, ...admission.params); }
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
