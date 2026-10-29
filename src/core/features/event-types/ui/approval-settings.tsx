import { Input } from "../../../app/ui/primitives";
import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { SettingReadState, useSettingRead, writeSetting } from "../../../app/ui/autosave-setting";
type Approval = { required: boolean; windowHours: number };
type Props = { eventId: string; initial?: Approval; onSaved?(): void };
export function ApprovalSettings(props: Props) {
  const read = useSettingRead<Approval>(`/api/app/event-types/${props.eventId}/approval`, props.initial);
  return read.value ? <ApprovalFields {...props} initial={read.value} /> : <SettingReadState error={read.error} retry={read.retry} />;
}
function ApprovalFields({ eventId, initial, onSaved }: Props & { initial: Approval }) {
  const save = useAutosave(`event:${eventId}:approval`, { required: initial.required, windowHours: String(initial.windowHours) }, async (next, init) => { await writeSetting(`/api/app/event-types/${eventId}/approval`, { required: next.required, windowHours: Number(next.windowHours) }, init); onSaved?.(); });
  return <div role="group" aria-label="Host approval" className="grid gap-4"><label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input className="h-5 w-5 accent-ink" type="checkbox" aria-label="Require host approval" checked={save.values.required} onChange={event => save.choose("required", event.target.checked)} />Require host approval<SavedMark state={save.state("required")} /></label><SaveFailed id={`approval-required-${eventId}`} state={save.state("required")} what="host approval" choice onRetry={save.retry} />{save.values.required ? <div className="grid gap-2"><label className="flex items-center justify-between gap-2 text-sm font-semibold" htmlFor={`approval-window-${eventId}`}>Approval window (hours)<SavedMark state={save.state("windowHours")} /></label><Input id={`approval-window-${eventId}`} aria-label="Approval window (hours)" type="number" min={1} max={168} value={save.values.windowHours} onChange={event => save.type("windowHours", event.target.value)} onBlur={save.leave} required /><SaveFailed id={`approval-hours-${eventId}`} state={save.state("windowHours")} what="the approval window" onRetry={save.retry} /></div> : null}</div>;
}
