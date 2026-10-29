import { GuestSettings } from "../guest-settings";
import { ApprovalSettings } from "../approval-settings";
export function GuestsAndApproval({ eventId, guests, approval, onSaved }: { eventId: string; guests: { guestLimit: number }; approval: { required: boolean; windowHours: number }; onSaved(): void }) {
  return <div className="grid gap-5"><GuestSettings eventId={eventId} initial={guests} onSaved={onSaved} /><ApprovalSettings eventId={eventId} initial={approval} onSaved={onSaved} /></div>;
}
