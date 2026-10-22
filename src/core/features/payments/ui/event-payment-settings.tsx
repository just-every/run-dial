import { PaymentTermsEditor } from "./payment-terms-editor";
import { PriceEditor } from "./price-editor";

/** The event editor's payment settings: the price (PAY-001) and the deposit and cancellation policy (PAY-003). */
export function EventPaymentSettings({ eventId, durations }: { eventId: string; durations: number[] }) {
  return <><PriceEditor eventId={eventId} durations={durations} /><PaymentTermsEditor eventId={eventId} /></>;
}
