import { Input } from "../../../app/ui/primitives";
import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { SettingReadState, useSettingRead, writeSetting } from "../../../app/ui/autosave-setting";
type Props = { eventId: string; initial?: { guestLimit: number }; onSaved?(): void };
export function GuestSettings(props: Props) {
  const read = useSettingRead<{ guestLimit: number }>(`/api/app/event-types/${props.eventId}/guests`, props.initial);
  return read.value ? <GuestFields {...props} initial={read.value} /> : <SettingReadState error={read.error} retry={read.retry} />;
}
function GuestFields({ eventId, initial, onSaved }: Props & { initial: { guestLimit: number } }) {
  const save = useAutosave(`event:${eventId}:guests`, { guestLimit: String(initial.guestLimit) }, async (next, init) => { await writeSetting(`/api/app/event-types/${eventId}/guests`, { guestLimit: Number(next.guestLimit) }, init); onSaved?.(); });
  return <div role="group" aria-label="Invitee guests" className="grid gap-2"><label className="flex items-center justify-between gap-2 text-sm font-semibold" htmlFor={`guests-${eventId}`}>Maximum guests<SavedMark state={save.state("guestLimit")} /></label><Input id={`guests-${eventId}`} aria-label="Maximum guests" type="number" min={0} max={20} value={save.values.guestLimit} onChange={event => save.type("guestLimit", event.target.value)} onBlur={save.leave} required /><SaveFailed id={`guests-failed-${eventId}`} state={save.state("guestLimit")} what="the guest limit" onRetry={save.retry} /></div>;
}
