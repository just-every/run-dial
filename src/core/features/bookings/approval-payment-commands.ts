import { approvalPayment, type ApprovalPayment } from "../payments";
import { pendingRefundKey, pendingRefundParams } from "../payments";
import { StripeApiError } from "../payments";
import type { PaymentsService } from "../payments";
import type { PaymentHold } from "../payments";
import type { ApprovalsRepository, ApprovalRequest } from "./approvals";
import type { BookingClaim, BookingEmail } from "./types";

export type ApprovalCommandDependencies = {
  repository: ApprovalsRepository; payments: PaymentsService;
  notices(request: ApprovalRequest, state: "declined" | "expired", reason: string): Promise<BookingEmail[]>;
};
/** Commands are durable before the processor call. Unknown outcomes keep both the claim and its occupied slot. */
export class ApprovalPaymentCommands {
  constructor(private readonly deps: ApprovalCommandDependencies) {}
  async live(request: ApprovalRequest, payment: ApprovalPayment): Promise<PaymentHold | undefined> {
    if (!request.claimJson || request.state !== "pending") return undefined;
    const claim = JSON.parse(request.claimJson) as BookingClaim, hold = await this.deps.payments.holdForNonce(claim.nonceId);
    return hold && hold.id === payment.holdId && hold.claimJson && ["held", "processing"].includes(hold.state) && hold.accountId === payment.accountId && hold.amountCents === payment.amountCents && hold.kind === payment.mode ? hold : undefined;
  }
  async capture(request: ApprovalRequest, payment: ApprovalPayment) {
    if (!await this.live(request,payment) || await this.deps.repository.erasing(request.inviteeEmail)) return;
    try { await this.deps.payments.approvalProcessor().capturePaymentIntent(payment.accountId,payment.paymentIntentId!,payment.amountCents,`dial-approval-capture-${request.id}`); }
    catch(error) {
      await this.failed(request,payment,error);
      if (error instanceof StripeApiError && error.status===400) {
        const intent = await this.deps.payments.approvalProcessor().getPaymentIntent(payment.accountId,payment.paymentIntentId!);
        if(intent.status==="canceled") await this.beginVoid(request,payment,"expired",null,"The card authorization ended before capture.");
      }
    }
    // Even a successful synchronous response waits for payment_intent.succeeded's signature.
  }
  async beginVoid(request: ApprovalRequest, payment: ApprovalPayment, state: "declined" | "expired", actorId: string | null, reason: string) {
    const next: ApprovalPayment = {...payment,state:"void_pending",actorId,voidState:state,voidReason:reason};
    const current = await this.deps.repository.paymentCommand(request,next,false);
    if (current) await this.recover(current);
    return this.deps.repository.get(request.id);
  }
  async recover(request: ApprovalRequest) {
    const payment = approvalPayment(request.paymentJson);
    if (!payment || !await this.live(request,payment)) return;
    if (payment.state === "capture_pending") return this.capture(request,payment);
    if (payment.state === "refund_pending") return this.refund(request,payment);
    if (payment.state !== "void_pending") return;
    const api = this.deps.payments.approvalProcessor();
    try {
      if (payment.mode === "setup") {
        if (!payment.paymentMethodId) throw new Error("approval_saved_card_missing");
        try { await api.detachPaymentMethod(payment.accountId,payment.paymentMethodId); }
        catch(error) { if (!(error instanceof StripeApiError) || error.status!==400 || !["resource_missing","payment_method_unexpected_state"].includes(error.code)) throw error; }
        await this.finish(request,{...payment,state:"voided"},["detach"]);
        return;
      }
      const intent = await api.getPaymentIntent(payment.accountId,payment.paymentIntentId!);
      if (intent.id!==payment.paymentIntentId || intent.currency!=="usd") throw new Error("approval_intent_mismatch");
      if (intent.status === "succeeded") {
        if (!Number.isSafeInteger(intent.amount_received) || intent.amount_received<=0) throw new Error("approval_capture_unresolved");
        const captured = {...payment,capturedCents:intent.amount_received};
        await this.deps.repository.paymentFact(captured,"capture");
        return this.beginRefund(request,captured);
      }
      if (intent.status === "requires_capture") {
        const canceled = await api.cancelPaymentIntent(payment.accountId,intent.id,`dial-approval-void-${payment.holdId}`);
        if (canceled.id!==intent.id || canceled.status!=="canceled") throw new Error("approval_void_unresolved");
      } else if (intent.status!=="canceled" && !(intent.status==="requires_payment_method" && intent.amount_received===0 && intent.amount_capturable===0)) throw new Error("approval_void_unresolved");
      await this.finish(request,{...payment,state:"voided"},["void"]);
    } catch(error) { await this.failed(request,payment,error); }
  }
  async beginRefund(request: ApprovalRequest, payment: ApprovalPayment) {
    const next: ApprovalPayment = {...payment,state:"refund_pending",actorId:payment.voidState ? payment.actorId : null,voidState:payment.voidState ?? "expired",voidReason:payment.voidReason ?? "The request could not be confirmed. Its payment is refunded."};
    const current = await this.deps.repository.replacePayment(request,payment.state,next);
    if (current && approvalPayment(current.paymentJson)?.state==="refund_pending") await this.refund(current,approvalPayment(current.paymentJson)!);
  }
  private async refund(request: ApprovalRequest, payment: ApprovalPayment) {
    if (!await this.live(request,payment)) return;
    try {
      const api = this.deps.payments.approvalProcessor(), amount = payment.capturedCents ?? payment.amountCents;
      const refund = payment.refundId ? await api.getRefund(payment.accountId,payment.refundId) : await api.createRefund(payment.accountId,pendingRefundParams(payment.paymentIntentId!,amount),pendingRefundKey(payment.holdId));
      const next = {...payment,refundId:refund.id};
      await this.deps.repository.replacePayment(request,"refund_pending",next);
      if (refund.payment_intent!==payment.paymentIntentId || refund.amount!==amount) throw new Error("approval_refund_mismatch");
      if (refund.status!=="succeeded") { await this.failed(request,next,new Error("approval_refund_pending")); return; }
      await this.finish(request,{...next,state:"refunded"},["refund"]);
    } catch(error) { await this.failed(request,payment,error); }
  }
  private async finish(request: ApprovalRequest, payment: ApprovalPayment, actions: Array<keyof ApprovalPayment["audit"]>) {
    await this.deps.repository.finishPayment(request,payment,await this.deps.notices(request,payment.voidState ?? "expired",payment.voidReason ?? "The request expired."),actions);
  }
  private async failed(request: ApprovalRequest, payment: ApprovalPayment, error: unknown) {
    const current = await this.deps.repository.get(request.id), saved = approvalPayment(current?.paymentJson ?? null);
    if (!current || !saved || !["capture_pending","void_pending","refund_pending"].includes(saved.state)) return;
    await this.deps.repository.replacePayment(current,saved.state,{...saved,lastError:error instanceof StripeApiError ? error.code : error instanceof Error && /^approval_[a-z_]+$/.test(error.message) ? error.message : "processor_unavailable"});
  }
}
