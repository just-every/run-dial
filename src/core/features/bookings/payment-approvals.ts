import { approvalCardSetup } from "../payments";
import { nowIso } from "../../shared/ids";
import { approvalAuditIds, approvalPayment, type ApprovalPayment, type StripeEvent } from "../payments";
import { StripeApiError, type CheckoutSession } from "../payments";
import type { PaymentHold } from "../payments";
import type { PaymentsService, Quote } from "../payments";
import type { WebhookResult } from "../payments";
import type { BookingClaim, BookingEmail } from "./types";
import type { ApprovalRequest, ApprovalsRepository } from "./approvals";
import { paymentMailFacts } from "./money-presentation";
import { ApprovalPaymentCommands } from "./approval-payment-commands";

type Dependencies = {
  repository: ApprovalsRepository; payments: PaymentsService;
  notices(claim: BookingClaim, state: "pending" | "declined" | "expired", expiresAt?: string, reason?: string): Promise<BookingEmail[]>;
  available(request: ApprovalRequest, claim: BookingClaim): Promise<boolean>;
  confirmationEmails(claim: BookingClaim, payment: ReturnType<typeof paymentMailFacts>): Promise<BookingEmail[]>;
};
/** A paid request is an authorization, never a booking. Only the winning signed capture fact converts it. */
export class PaymentApprovals {
  private readonly commands: ApprovalPaymentCommands;
  constructor(private readonly deps: Dependencies) {
    this.commands = new ApprovalPaymentCommands({repository:deps.repository,payments:deps.payments,notices:(request,state,reason)=>deps.notices(JSON.parse(request.claimJson!) as BookingClaim,state,undefined,reason)});
  }
  async receive(hold: PaymentHold, event: StripeEvent): Promise<WebhookResult> {
    if (!hold.claimJson || !["held","processing"].includes(hold.state)) return {kind:"processed"};
    const request = await this.deps.repository.forNonce(hold.nonceId), object = event.data.object;
    if (request) {
      if(approvalPayment(request.paymentJson)?.state==="setup_pending") { await this.prepareCard(request); return {kind:"processed"}; }
      const payment = approvalPayment(request.paymentJson);
      if (!payment || !await this.commands.live(request,payment)) return {kind:"processed"};
      if (event.type==="payment_intent.succeeded") {
        if (object.id!==payment.paymentIntentId || object.currency!=="usd" || object.amount_received!==payment.amountCents) return {kind:"rejected"};
        if (payment.state==="void_pending" || payment.state==="refund_pending") { await this.commands.recover(request); return {kind:"processed"}; }
        if (payment.state!=="capture_pending") return {kind:"rejected"};
        const captured = {...payment,capturedCents:payment.amountCents};
        await this.deps.repository.paymentFact(captured,"capture");
        let confirmed = false;
        try { confirmed = await this.deps.payments.confirmApproval(hold,captured,{id:request.id,operatorId:payment.captureActorId!}); }
        catch { confirmed = (await this.deps.payments.holdForNonce(hold.nonceId))?.state==="confirmed"; }
        if (!confirmed) await this.commands.beginRefund(request,captured);
        return {kind:"processed"};
      }
      if (["refund.created","refund.updated","payment_intent.canceled"].includes(event.type)) { await this.commands.recover(request); return {kind:"processed"}; }
      return {kind:"processed"};
    }
    if (event.type==="checkout.session.completed" || event.type==="payment_intent.amount_capturable_updated") return this.authorize(hold,object,event.type.startsWith("checkout."));
    if (["checkout.session.expired","checkout.session.async_payment_failed","payment_intent.payment_failed"].includes(event.type)) { await this.expireHold(hold); return {kind:"processed"}; }
    return {kind:event.type==="payment_intent.succeeded" ? "rejected" : "ignored"};
  }
  async authorize(hold: PaymentHold, object: Record<string,unknown>, checkout: boolean): Promise<WebhookResult> {
    if (!hold.claimJson || !hold.checkoutSessionId) return {kind:"rejected"};
    if (checkout && object.id!==hold.checkoutSessionId) return {kind:"rejected"};
    const claim = JSON.parse(hold.claimJson) as BookingClaim;
    if (!claim.money?.approval || !claim.emails.length) return {kind:"rejected"};
    const api = this.deps.payments.approvalProcessor();
    let payment: ApprovalPayment;
    if (hold.kind==="setup") {
      if (!checkout || object.mode!=="setup" || object.status!=="complete" || typeof object.setup_intent!=="string" || !claim.money.consent) return {kind:"rejected"};
      const setup = await api.getSetupIntent(hold.accountId,object.setup_intent);
      if (setup.status!=="succeeded" || !setup.customer || !setup.payment_method) return {kind:"rejected"};
      payment={holdId:hold.id,mode:"setup",amountCents:0,accountId:hold.accountId,paymentIntentId:null,setupIntentId:setup.id,customerId:setup.customer,paymentMethodId:setup.payment_method,state:"authorized",authorizedAt:nowIso(),audit:approvalAuditIds()};
    } else {
      const id = checkout ? object.payment_intent : object.id;
      if (typeof id!=="string") return {kind:"rejected"};
      const intent = await api.getPaymentIntent(hold.accountId,id);
      if (intent.id!==id || intent.status!=="requires_capture" || intent.capture_method!=="manual" || intent.amount!==hold.amountCents || intent.amount_capturable!==hold.amountCents || intent.amount_received!==0 || intent.currency!=="usd") return {kind:"rejected"};
      payment={holdId:hold.id,mode:"payment",amountCents:hold.amountCents,accountId:hold.accountId,paymentIntentId:id,setupIntentId:null,customerId:intent.customer,paymentMethodId:intent.payment_method,state:claim.money.consent?"setup_pending":"authorized",saveCard:Boolean(claim.money.consent),consentVersion:claim.money.consent?.version,authorizedAt:nowIso(),audit:approvalAuditIds()};
    }
    const late = hold.expiresAt<=nowIso();
    const expires = new Date(Math.min(Date.parse(claim.selection.startAt),Date.now()+claim.money.approval.windowHours*3600000)).toISOString();
    const request = await this.deps.repository.holdPayment(claim,payment,late || payment.saveCard ? [] : await this.deps.notices(claim,"pending",expires));
    if (!request) return {kind:"rejected"};
    if(payment.saveCard && !late) await this.prepareCard(request);
    if (late) await this.commands.beginVoid(request,approvalPayment(request.paymentJson)!,"expired",null,"The payment authorization window expired.");
    return {kind:"processed"};
  }
  private async prepareCard(request:ApprovalRequest) {
    const payment=approvalPayment(request.paymentJson)!;
    if(payment.state!=="setup_pending" || !await this.commands.live(request,payment))return;
    const hold=await this.commands.live(request,payment);
    if(!hold)return;
    try {
      const setup=await approvalCardSetup(this.deps.payments.approvalProcessor(),payment);
      const next={...payment,setupIntentId:setup.id};
      const saved=await this.deps.repository.replacePayment(request,"setup_pending",next);
      if(!saved || approvalPayment(saved.paymentJson)?.state!=="setup_pending")return;
      if(setup.status!=="succeeded" || hold.expiresAt<=nowIso() || await this.deps.repository.erasing(request.inviteeEmail)) {
        await this.commands.beginVoid(saved,next,"expired",null,setup.status!=="succeeded"?"Saved-card consent could not be completed.":"The payment and consent window expired.");return;
      }
      const ready:ApprovalPayment={...next,state:"authorized",authorizedAt:nowIso()};
      const expires=new Date(Math.min(Date.parse(request.startAt),Date.parse(ready.authorizedAt)+JSON.parse(request.claimJson!).money.approval.windowHours*3600000)).toISOString();
      await this.deps.repository.readyPayment(saved,ready,await this.deps.notices(JSON.parse(request.claimJson!) as BookingClaim,"pending",expires));
    } catch(error) {
      if(error instanceof StripeApiError && error.status>=400 && error.status<500 && ![409,429].includes(error.status)) await this.commands.beginVoid(request,{...payment,setupRefused:true},"expired",null,"Saved-card consent was refused.");
      // Unknown creation remains durable and unapprovable, and is resolved with the original key.
    }
  }
  async decide(request: ApprovalRequest, actorId: string, decision: "approve" | "decline", reason?: string) {
    const payment = approvalPayment(request.paymentJson)!;
    if (!await this.commands.live(request,payment)) return {kind:"closed" as const,state:request.state};
    if (decision==="decline") {
      const current = ["setup_pending","authorized","capture_pending"].includes(payment.state) ? await this.commands.beginVoid(request,payment,"declined",actorId,reason?.trim() || "The host declined this request.") : (await this.commands.recover(request),await this.deps.repository.get(request.id));
      return current?.state==="declined" ? {kind:"declined" as const} : {kind:"void_pending" as const};
    }
    if (payment.state!=="authorized") { await this.commands.recover(request); return {kind:payment.state==="capture_pending" ? "capture_pending" as const : "void_pending" as const}; }
    if (request.expiresAt<=nowIso()) { await this.expire(request); return {kind:"void_pending" as const}; }
    const claim = JSON.parse(request.claimJson!) as BookingClaim;
    if (!await this.deps.available(request,claim)) return {kind:"not_available" as const};
    if (payment.mode==="setup") {
      let confirmed=false;
      try { const hold=await this.commands.live(request,payment); if(hold)confirmed=await this.deps.payments.confirmApproval(hold,payment,{id:request.id,operatorId:actorId}); }
      catch { confirmed=(await this.deps.payments.holdForNonce(claim.nonceId))?.state==="confirmed"; }
      if (confirmed) return {kind:"approved" as const,bookingId:request.bookingId};
      await this.commands.beginVoid(request,payment,"expired",null,"The request could not be confirmed.");
      return {kind:"void_pending" as const};
    }
    const next: ApprovalPayment = {...payment,state:"capture_pending",actorId,captureActorId:actorId};
    const current = await this.deps.repository.paymentCommand(request,next,true);
    if (current && approvalPayment(current.paymentJson)?.state==="capture_pending") { await this.commands.capture(current,approvalPayment(current.paymentJson)!); return {kind:"capture_pending" as const}; }
    return {kind:"not_available" as const};
  }
  async expire(request: ApprovalRequest) {
    const payment = approvalPayment(request.paymentJson)!;
    if(payment.state==="setup_pending") { await this.prepareCard(request); return; }
    if (payment.state==="authorized" && request.expiresAt<=nowIso()) await this.commands.beginVoid(request,payment,"expired",null,"The host did not approve before the deadline.");
    else await this.commands.recover(request);
  }
  async resume(hold: PaymentHold) {
    const claim = JSON.parse(hold.claimJson!) as BookingClaim, money = claim.money!;
    const quote: Quote = {kind:"available",mode:hold.kind,amountCents:hold.amountCents,snapshot:money.snapshot,saveCard:Boolean(money.consent),taxRequired:money.snapshot.taxCents>0,accountId:hold.accountId,achEnabled:false};
    const session = await this.deps.payments.openCheckout({holdId:hold.id,quote,eventTitle:claim.event.title,durationMinutes:(Date.parse(claim.selection.endAt)-Date.parse(claim.selection.startAt))/60000,returnUrl:money.approval!.returnUrl,customerEmail:claim.invitee.email,approval:true,createdAt:hold.createdAt});
    const balanceUrl = money.balanceSalt ? new URL(`/manage/balance/${await this.deps.payments.money.balanceToken(money.balanceSalt)}`,new URL(money.manageUrl!).origin).toString() : undefined;
    const facts = paymentMailFacts({amountCents:hold.amountCents,reference:session.id,snapshot:money.snapshot,businessName:(await this.deps.payments.settings()).effectiveBusinessName,...(balanceUrl?{balanceUrl}:{})},claim.selection.startAt);
    await this.deps.payments.attachCheckout(hold.id,session,{...claim,emails:await this.deps.confirmationEmails(claim,facts)});
    return this.deps.payments.holdForNonce(hold.nonceId);
  }
  async expireHold(initial: PaymentHold) {
    let hold = initial;
    if (!hold.checkoutSessionId) { const resumed = await this.resume(hold); if (!resumed) return; hold=resumed; }
    const request = await this.deps.repository.forNonce(hold.nonceId);
    if (request) return this.expire(request);
    let session: CheckoutSession;
    try { session=await this.deps.payments.approvalProcessor().expireCheckoutSession(hold.accountId,hold.checkoutSessionId!); }
    catch(error) { if (!(error instanceof StripeApiError) || error.status!==400) throw error; session=await this.deps.payments.approvalProcessor().getCheckoutSession(hold.accountId,hold.checkoutSessionId!); }
    if (session.status==="expired") { await this.deps.payments.releaseHold(hold.id,"payment_window_expired"); return; }
    if (session.status==="complete") {
      const result = await this.authorize(hold,session as unknown as Record<string,unknown>,true);
      if (result.kind==="rejected") throw new Error("approval_authorization_unresolved");
    }
  }
}
