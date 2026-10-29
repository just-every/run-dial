import { useEventPage } from "../event-page-context";
import type { EventPrice } from "../../../../shared/event-price";
import type { PaymentTerms } from "../../../../shared/payment-terms";
import type { EventTypeRecord } from "../../repository";
export function PriceAndPayment({ event, price, terms, onSaved }: { event: EventTypeRecord; price: EventPrice; terms: PaymentTerms; onSaved(): void }) {
  const { paymentEditor } = useEventPage();
  return paymentEditor({ eventId: event.id, durations: event.durationOptionsMinutes?.length ? event.durationOptionsMinutes : [event.durationMinutes], price, terms, eventTitle: event.title, onSaved });
}
