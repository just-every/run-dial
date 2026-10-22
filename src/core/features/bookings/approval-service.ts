import { PaymentApprovals } from "./payment-approvals";
import { approvalPayment, publicApprovalPayment } from "../payments";
import type { PaymentMailFacts } from "./money-presentation";
import { isPaid } from "../../shared/event-price";
import { cardRequired } from "../../shared/payment-terms";
import { approvalMail, type ApprovalRequest, type ApprovalSettings } from "./approvals";
import type { BookingsRepository } from "./repository";
import type { AvailabilityService } from "../availability";
import type { HostProfileService, ProfileRecord } from "../host-profile";
import type { EventTypesService, EventTypeRecord } from "../event-types";
import type { PaymentsService } from "../payments";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { deriveOpaqueToken } from "../../platform/auth/tokens";
import { nowIso } from "../../shared/ids";
import type { BookingClaim, BookingConfirmation, BookingEmail, BookingRecord, ValidatedInvitee } from "./types";
type ConfirmationInput = {
    profile: ProfileRecord;
    event: EventTypeRecord;
    invitee: ValidatedInvitee;
    startAt: string;
    endAt: string;
    inviteeTimezone: string;
    manageToken: string;
    bookingId: string;
    calendarRequired?: boolean;
    payment?: PaymentMailFacts;
};
type Dependencies = {
    repository: BookingsRepository;
    availability: AvailabilityService;
    profiles: HostProfileService;
    eventTypes: EventTypesService;
    runtime: RuntimeEnvironment;
    payments?: PaymentsService;
    confirmationEmails: (input: ConfirmationInput) => Promise<BookingEmail[]>;
    toConfirmation: (booking: BookingRecord, profile: ProfileRecord, token: string) => Promise<BookingConfirmation>;
};
/** EVENT-008 request lifecycle, separate from confirmed bookings and every payment path. */
export class ApprovalService {
    private readonly payment?: PaymentApprovals;
    constructor(private readonly deps: Dependencies) {
        if (deps.payments) {
            this.payment = new PaymentApprovals({repository:deps.repository.approvals,payments:deps.payments,
                notices:(claim,state,expiresAt,reason)=>this.emails({title:claim.event.title,startAt:claim.selection.startAt,endAt:claim.selection.endAt,inviteeName:claim.invitee.name,inviteeEmail:claim.invitee.email,publicUrl:claim.money!.approval!.url,expiresAt,reason},state),
                available:(request,claim)=>this.available(request,claim),
                confirmationEmails:async(claim,payment)=>{const profile=await deps.profiles.getProfile();if(!profile)throw new Error("Approval host profile missing");const manageToken=new URL(claim.money!.manageUrl!).pathname.split("/").at(-1)!;return deps.confirmationEmails({profile:{...profile,timezone:claim.hostTimezone},event:claim.event,invitee:claim.invitee,startAt:claim.selection.startAt,endAt:claim.selection.endAt,inviteeTimezone:claim.selection.inviteeTimezone,manageToken,bookingId:claim.bookingId,calendarRequired:Boolean(claim.calendarPayload),payment});},
            });
            deps.payments.setApprovalLifecycle({receive:(hold,event)=>this.payment!.receive(hold,event),expire:hold=>this.payment!.expireHold(hold),resume:hold=>this.payment!.resume(hold)});
        }
    }
    private async available(request:ApprovalRequest,claim:BookingClaim) {
        const profile=await this.deps.profiles.getProfile(),event=await this.deps.eventTypes.getEventType(request.eventTypeId);
        if(!profile || !event || event.status!=="published")return false;
        return (await this.deps.availability.verifyResolvedPublicSelection({...profile,timezone:claim.hostTimezone},event,claim.selection.startAt,new Date(),claim.bookingId,(Date.parse(claim.selection.endAt)-Date.parse(claim.selection.startAt))/60000)).kind==="valid";
    }
    token(nonce: string) { return deriveOpaqueToken(nonce, this.deps.runtime.SESSION_SECRET, "booking-approval.v1"); }
    async settings(eventId: string) { return await this.deps.eventTypes.getEventType(eventId) ? this.deps.repository.approvals.settings(eventId) : undefined; }
    async saveSettings(eventId: string, input: ApprovalSettings) {
        const event = await this.deps.eventTypes.getEventType(eventId);
        if (!event)
            return { kind: "not_found" as const };
        if(input.windowHours>168)return {kind:"approval_window_too_long" as const};
        if (input.required && this.deps.payments && isPaid(await this.deps.payments.eventPrice(eventId)) && cardRequired(await this.deps.payments.eventTerms(eventId)))
            return { kind: "approval_price_and_saved_card_conflict" as const };
        await this.deps.repository.approvals.saveSettings(eventId, input);
        return { kind: "saved" as const, settings: input };
    }
    async pending() { return (await this.deps.repository.approvals.pending()).map(request => ({ id: request.id, bookingId: request.bookingId, state: request.state, inviteeName: request.inviteeName, inviteeEmail: request.inviteeEmail, eventTitle: request.eventTitle, startAt: request.startAt, endAt: request.endAt, expiresAt: request.expiresAt,...(request.paymentJson?{payment:publicApprovalPayment(approvalPayment(request.paymentJson))}:{}) })); }
    async due() { return this.deps.repository.approvals.due(); }
    async emails(input: Parameters<typeof approvalMail>[0], state: ApprovalRequest["state"]) {
        return [approvalMail(input, input.inviteeEmail, state), ...(await this.deps.repository.listOperatorRecipients()).map(({ email, id, generation }) => approvalMail({ ...input, hostUrl: new URL("/app/bookings", this.deps.runtime.APP_URL).toString() }, email, state, { id, generation }))];
    }
    async expire(id: string) { const request = await this.deps.repository.approvals.get(id); if(request?.paymentJson){if(!this.payment)throw new Error("Approval payments unavailable");return this.payment.expire(request);} if (!request || request.state !== "pending" || request.expiresAt > nowIso())
        return; await this.deps.repository.approvals.decide(request, "expired", null, "The host did not approve before the deadline.", await this.emails({ title: request.eventTitle, startAt: request.startAt, endAt: request.endAt, inviteeName: request.inviteeName, inviteeEmail: request.inviteeEmail }, "expired")); }
    async decide(id: string, operatorId: string, decision: "approve" | "decline", reason?: string) {
        const request = await this.deps.repository.approvals.get(id);
        if (!request)
            return { kind: "not_found" as const };
        if (request.state !== "pending")
            return { kind: "closed" as const, state: request.state };
        if(request.paymentJson){if(!this.payment)throw new Error("Approval payments unavailable");return this.payment.decide(request,operatorId,decision,reason);}
        if (request.expiresAt <= nowIso()) {
            await this.expire(id);
            return { kind: "closed" as const, state: "expired" };
        }
        if (decision === "decline") {
            await this.deps.repository.approvals.decide(request, "declined", operatorId, reason?.trim() || "The host declined this request.", await this.emails({ title: request.eventTitle, startAt: request.startAt, endAt: request.endAt, inviteeName: request.inviteeName, inviteeEmail: request.inviteeEmail, reason: reason?.trim() }, "declined"));
            return { kind: "declined" as const };
        }
        if (!request.claimJson)
            return { kind: "closed" as const, state: request.state };
        const claim = JSON.parse(request.claimJson) as BookingClaim, profile = await this.deps.profiles.getProfile(), event = await this.deps.eventTypes.getEventType(request.eventTypeId);
        if (!profile || !event || event.status !== "published")
            return { kind: "not_available" as const };
        const verified = await this.deps.availability.verifyResolvedPublicSelection(profile, event, claim.selection.startAt, new Date(), claim.bookingId, (Date.parse(claim.selection.endAt) - Date.parse(claim.selection.startAt)) / 60000);
        if (verified.kind !== "valid")
            return { kind: "not_available" as const };
        const manageUrl = claim.emails.find(email => email.recipientRole === "invitee" && !email.guest)?.manageUrl;
        if (!manageUrl)
            return { kind: "not_available" as const };
        const manageToken = new URL(manageUrl).pathname.split("/").at(-1)!;
        const emails = await this.deps.confirmationEmails({ profile: { ...profile, timezone: claim.hostTimezone }, event: claim.event, invitee: claim.invitee, startAt: claim.selection.startAt, endAt: claim.selection.endAt, inviteeTimezone: claim.selection.inviteeTimezone, manageToken, bookingId: claim.bookingId, calendarRequired: Boolean(claim.calendarPayload) });
        const outcome = await this.deps.repository.claim({ ...claim, emails, now: nowIso() }, undefined, { id, operatorId });
        return outcome === "claimed" ? { kind: "approved" as const, bookingId: claim.bookingId } : { kind: "not_available" as const };
    }
    async confirmation(request: ApprovalRequest, token: string): Promise<{
        kind: "found";
        booking: BookingConfirmation;
    } | {
        kind: "not_found";
    }> {
        const profile = await this.deps.profiles.getProfile();
        if (!profile)
            return { kind: "not_found" };
        if (request.state === "approved" && request.claimJson) {
            const claim = JSON.parse(request.claimJson) as BookingClaim;
            const url = claim.emails.find(email => email.recipientRole === "invitee" && !email.guest)?.manageUrl;
            const booking = await this.deps.repository.getById(request.bookingId);
            if (booking && url) {
                const manage = new URL(url).pathname.split("/").at(-1)!;
                return { kind: "found", booking: await this.deps.toConfirmation(booking, profile, manage) };
            }
        }
        const payment=publicApprovalPayment(approvalPayment(request.paymentJson));
        const state = request.state === "pending" && !payment && request.expiresAt <= nowIso() ? "expired" : request.state;
        return { kind: "found", booking: { approval: { state, expiresAt: request.expiresAt,...(payment?{paymentState:payment.state,amountCents:payment.amountCents,mode:payment.mode}:{}) }, event: { eventTitle: request.eventTitle, durationMinutes: (Date.parse(request.endAt) - Date.parse(request.startAt)) / 60000 }, host: { name: profile.name, timezone: profile.timezone }, occurrence: { startAt: request.startAt, endAt: request.endAt }, inviteeTimezone: "UTC", location: { label: "Shown after approval", state: "pending" }, calendarState: "not_required", meetingState: "not_required", manageUrl: new URL(`/manage/${token}`, this.deps.runtime.APP_URL).toString(), icsUrl: "", state: state === "pending" ? "pending_approval" : state === "approved" ? "expired" : state } };
    }
}
