import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import { eventBookingPolicySchema, type EventBookingPolicy } from "../../../shared/booking-policy";
import { LockedZoneFields } from "./locked-zone-fields";
import { ChangePolicyFields } from "./change-policy-fields";
import { SettingReadState, useSettingRead, writeSetting } from "../../../app/ui/autosave-setting";
type Props = { eventId: string; hostTimezone: string; onSaved(): void; initial?: EventBookingPolicy; group?: "changes" | "timezone" };
export function BookingPolicyEditor(props: Props) {
  const read = useSettingRead<EventBookingPolicy>(`/api/app/event-types/${props.eventId}/booking-policy`, props.initial);
  return read.value ? <PolicyFields {...props} initial={read.value} /> : <SettingReadState error={read.error} retry={read.retry} />;
}
function PolicyFields({ eventId, hostTimezone, onSaved, initial, group }: Props & { initial: EventBookingPolicy }) {
  const save = useAutosave(`event:${eventId}:booking-policy`, initial, async (next, init) => { const parsed = eventBookingPolicySchema.safeParse(next); if (!parsed.success) throw new Error(parsed.error.issues.some(issue => issue.path[0] === "lockedTimezone") ? "Choose a time zone from the list." : "Use a whole number, or leave this blank."); await writeSetting(`/api/app/event-types/${eventId}/booking-policy`, parsed.data, init); onSaved(); });
  return <div aria-label="Booking controls" className="grid gap-3" onBlur={save.leave}>
    {group !== "changes" ? <LockedZoneFields state={save.state("lockedTimezone")} onRetry={save.retry} value={save.values.lockedTimezone} hostTimezone={hostTimezone} compact onDraftChange={zone => save.type("lockedTimezone", zone)} onChange={zone => save.choose("lockedTimezone", zone)} /> : null}
    {group !== "timezone" ? <ChangePolicyFields state={save.state} onRetry={save.retry} value={save.values} compact onChange={next => { for (const key of ["rescheduleCutoffMinutes", "cancellationCutoffMinutes", "maxInviteeReschedules"] as const) if (next[key] !== save.values[key]) save.type(key, next[key]); }} /> : null}
  </div>;
}
