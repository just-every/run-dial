import type { Answers } from "./answer-retention";
import type { Attribution } from "./link-context";
export type ConfirmationInput = { nonce: string; startAt: string; inviteeTimezone: string; name: string; email: string; answers: Answers; attribution?: Attribution; locationId?: string; locationInput?: string; link?: string; cardConsent?: { accepted: boolean; version: string }; billingAddress?: { line1: string; city: string; state: string; postalCode: string; country: "US" }; shownTaxCents?: number };
/** Keep an uncertain confirmation byte-equivalent even if current questions change. */
export class ConfirmationAttempt {
  private input?: ConfirmationInput;
  private uncertain = false;
  begin(input: ConfirmationInput) {
    this.input ??= structuredClone(input);
    return structuredClone(this.input);
  }
  unknown() { this.uncertain = true; }
  refuse(status: number, code?: string) {
    const knownRefusal = status >= 400 && status < 500 && code !== undefined && ["invalid_duration", "invalid_answers", "card_consent_required", "billing_address_required", "tax_changed", "booking_nonce_not_found", "booking_nonce_expired", "booking_unavailable", "slot_taken", "slot_unavailable", "rate_limited", "invalid_request", "event_not_available"].includes(code);
    if (this.uncertain || !knownRefusal) { this.unknown(); return false; }
    this.input = undefined;
    return true;
  }
  get pending() { return this.input !== undefined; }
}
