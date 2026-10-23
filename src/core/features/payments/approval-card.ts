import type { ApprovalPayment } from "./approval-state";
import type { StripeApi } from "./stripe-api";

/** One SetupIntent for the already confirmed Checkout card and the consent version shown by Dial.
 * Persist its identity before accepting the request; the same key resolves a lost response. */
export async function approvalCardSetup(api: StripeApi, payment: ApprovalPayment) {
  if (!payment.customerId || !payment.paymentMethodId || !payment.consentVersion) throw new Error("approval_saved_card_missing");
  const setup = payment.setupIntentId ? await api.getSetupIntent(payment.accountId,payment.setupIntentId) : await api.createSetupIntent(payment.accountId,{
    customer:payment.customerId,payment_method:payment.paymentMethodId,confirm:"true",usage:"off_session",
    "automatic_payment_methods[enabled]":"true","automatic_payment_methods[allow_redirects]":"never",
    "allowed_payment_method_types[0]":"card","allowed_payment_method_types[1]":"link",
    "metadata[dial_hold_id]":payment.holdId,"metadata[dial_payment_intent_id]":payment.paymentIntentId!,"metadata[dial_consent_version]":payment.consentVersion,
  },`dial-approval-setup-${payment.holdId}`);
  if (setup.customer!==payment.customerId || setup.payment_method!==payment.paymentMethodId) throw new Error("approval_setup_mismatch");
  return setup;
}
/** A pending challenge must be cancelled before detachment, so a late confirmation cannot reattach a card. */
export async function closeApprovalSetup(api: StripeApi, payment: ApprovalPayment) {
  if (!payment.saveCard || payment.setupRefused) return payment;
  let setup=await approvalCardSetup(api,payment);
  if (["requires_payment_method","requires_confirmation","requires_action"].includes(setup.status)) setup=await api.cancelSetupIntent(payment.accountId,setup.id,`dial-approval-setup-cancel-${payment.holdId}`);
  if (!["succeeded","canceled"].includes(setup.status)) throw new Error("approval_setup_unresolved");
  return {...payment,setupIntentId:setup.id};
}
