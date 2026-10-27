import { PaymentTermsEditor } from "./payment-terms-editor";
import { PriceEditor } from "./price-editor";
import type { EventPrice } from "../../../shared/event-price";
import type { PaymentTerms } from "../../../shared/payment-terms";
import { Link } from "@tanstack/react-router";

/** The event's price and payment terms keep each other’s pending confirmations independent. */
export function EventPaymentSettings({ eventId, durations, price, terms, eventTitle, onSaved }: { eventId: string; durations: number[]; price?: EventPrice; terms?: PaymentTerms; eventTitle?: string; onSaved?(): void }) {
  return <div className="grid gap-5"><PriceEditor eventId={eventId} durations={durations} initial={price} eventTitle={eventTitle} onSaved={onSaved} /><PaymentTermsEditor eventId={eventId} initial={terms} onSaved={onSaved} /><p className="text-sm text-soft">Paid through your Stripe account. <Link to="/app/settings" className="underline">Connect Stripe</Link> to take payments.</p></div>;
}
