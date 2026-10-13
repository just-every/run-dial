import { Button, Input, Select } from "../../../app/ui/primitives";
import type { DateAvailabilityWindowInput } from "../repository";
import { timeInput, timeMinutes } from "./window-time";

export type OverrideDraft = {
  hostDate: string;
  mode: "open" | "closed";
  windows: DateAvailabilityWindowInput[];
};

export function OverrideForm({ draft, saving, onChange, onCancel, onSave }: { draft: OverrideDraft; saving: boolean; onChange: (next: Partial<OverrideDraft>) => void; onCancel: () => void; onSave: (event: React.FormEvent) => Promise<void> }) {
  const saveBlocked = draft.mode === "open" && draft.windows.length === 0;
  return <form className="mt-5 rounded-[18px] bg-row p-5" onSubmit={(event) => void onSave(event)}><fieldset disabled={saving} className="border-0 p-0"><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-[650]"><span>Host date</span><Input type="date" value={draft.hostDate} onChange={(event) => onChange({ hostDate: event.target.value })} required /></label><label className="grid gap-1.5 text-sm font-[650]"><span>Schedule for this date</span><Select value={draft.mode} onChange={(event) => onChange({ mode: event.target.value as OverrideDraft["mode"], windows: event.target.value === "closed" ? [] : draft.windows })}><option value="closed">Closed all day</option><option value="open">Open during selected windows</option></Select></label></div>{draft.mode === "open" ? <OverrideWindows windows={draft.windows} onChange={(windows) => onChange({ windows })} /> : <p className="mt-4 text-sm text-muted">This date will be closed; recurring windows will not apply.</p>}<div className="mt-5 flex flex-wrap gap-2"><Button type="submit" disabled={saving || saveBlocked} title={saveBlocked ? "Add at least one open window before saving." : undefined}>{saving ? "Saving…" : "Save date override"}</Button><Button type="button" variant="quiet" disabled={saving} onClick={onCancel}>Cancel</Button></div></fieldset></form>;
}

function OverrideWindows({ windows, onChange }: { windows: DateAvailabilityWindowInput[]; onChange: (windows: DateAvailabilityWindowInput[]) => void }) {
  return <div className="mt-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-[650]">Open windows</p><Button type="button" variant="secondary" onClick={() => onChange([...windows, { startMinute: 540, endMinute: 1020 }])}>Add window</Button></div>{windows.length === 0 ? <p className="mt-3 text-sm text-muted">Add a window to make this date available.</p> : <div className="mt-3 grid gap-2">{windows.map((window, index) => <div className="grid gap-2 sm:grid-cols-[10rem_10rem_auto]" key={index}><Input type="time" aria-label={`Date override window ${index + 1} start time`} required value={timeInput(window.startMinute)} onChange={(event) => onChange(replaceWindow(windows, index, { ...window, startMinute: timeMinutes(event.target.value) }))} /><Input type="time" aria-label={`Date override window ${index + 1} end time`} required value={timeInput(window.endMinute)} onChange={(event) => onChange(replaceWindow(windows, index, { ...window, endMinute: timeMinutes(event.target.value, true) }))} /><Button type="button" variant="quiet" aria-label={`Remove date override window ${index + 1}`} onClick={() => onChange(windows.filter((_, position) => position !== index))}>Remove</Button></div>)}</div>}</div>;
}

function replaceWindow(windows: DateAvailabilityWindowInput[], index: number, next: DateAvailabilityWindowInput) { return windows.map((window, position) => position === index ? next : window); }
