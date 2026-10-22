/** Stripe Checkout Session parameters for a payment hold (PAY-001, PAY-003). */
export type CheckoutInput = {
  holdId: string; mode: "payment" | "setup"; amountCents: number; deposit: boolean; saveCard: boolean;
  eventTitle: string; durationMinutes: number; returnUrl: string; customerEmail: string; achEnabled: boolean; expiresAt: number;
};

export function checkoutParams(input: CheckoutInput): Record<string, string> {
  const common = {
    success_url: `${input.returnUrl}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.returnUrl}&canceled=1`,
    expires_at: String(input.expiresAt),
    client_reference_id: input.holdId,
    customer_email: input.customerEmail,
    "metadata[dial_hold_id]": input.holdId,
  };
  // Nothing is due at booking: Checkout in setup mode creates the SetupIntent that saves the consented card.
  if (input.mode === "setup") return { ...common, mode: "setup", currency: "usd", customer_creation: "always", "excluded_payment_method_types[0]": "us_bank_account", "setup_intent_data[metadata][dial_hold_id]": input.holdId };
  const name = `${input.deposit ? "Deposit: " : ""}${input.eventTitle} (${input.durationMinutes} minutes)`;
  return {
    ...common,
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(input.amountCents),
    "line_items[0][price_data][product_data][name]": name.slice(0, 250),
    // Stripe manages Checkout's methods (cards, Apple Pay, Google Pay, Link) from the account's Dashboard and
    // refuses payment_method_types; ACH Direct Debit is excluded unless the host enabled it in Dial, and always when
    // a card is saved for stated fees.
    ...(input.achEnabled && !input.saveCard ? {} : { "excluded_payment_method_types[0]": "us_bank_account" }),
    "payment_intent_data[metadata][dial_hold_id]": input.holdId,
    // The invitee's consent lets Stripe keep the card from this payment for a later off-session fee.
    ...(input.saveCard ? { "payment_intent_data[setup_future_usage]": "off_session", customer_creation: "always" } : {}),
  };
}
