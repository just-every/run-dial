import { BookingPolicyEditor } from "../booking-policy-editor";
import type { EventBookingPolicy } from "../../../../shared/booking-policy";
export function ChangesAndCancellations({ eventId, policy, hostTimezone, onSaved }: { eventId: string; policy: EventBookingPolicy; hostTimezone: string; onSaved(): void }) {
  return <BookingPolicyEditor eventId={eventId} initial={policy} hostTimezone={hostTimezone} group="changes" onSaved={onSaved} />;
}
