import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import type { FieldState } from "../../../app/ui/autosave/use-autosave";
import { useId, useState } from "react";
import { Card, Input, Select } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import type { ChangePolicy } from "../../../shared/change-policy";

type Props = {
  value: ChangePolicy;
  onChange(value: ChangePolicy): void;
  disabled?: boolean;
  compact?: boolean;
  state?(field: keyof ChangePolicy): FieldState;
  onRetry?(): void;
};
type CutoffUnit = "hours" | "days";
const minutesPerUnit: Record<CutoffUnit, number> = { hours: 60, days: 1440 };

export function ChangePolicyFields({ value, onChange, disabled = false, compact = false, state, onRetry }: Props) {
  const capHelpId = useId();
  const Container = compact ? "div" : Card;
  return <Container className={compact ? "grid gap-4" : "p-5 sm:p-6"}>
    {!compact ? <SectionHeading icon="clock" title="Invitee changes" /> : null}
    <fieldset disabled={disabled} className="grid gap-5 border-0 p-0">
      <div className="grid gap-5 sm:grid-cols-2">
        <CutoffField state={state?.("rescheduleCutoffMinutes")} onRetry={onRetry} action="rescheduling" compact={compact} value={value.rescheduleCutoffMinutes} onChange={rescheduleCutoffMinutes => onChange({ ...value, rescheduleCutoffMinutes })} />
        <CutoffField state={state?.("cancellationCutoffMinutes")} onRetry={onRetry} action="cancellation" compact={compact} value={value.cancellationCutoffMinutes} onChange={cancellationCutoffMinutes => onChange({ ...value, cancellationCutoffMinutes })} />
      </div>
      <label className="grid gap-2 text-sm font-[650]"><span className="flex items-center justify-between gap-2">Maximum invitee reschedules per booking{state ? <SavedMark state={state("maxInviteeReschedules")} /> : null}</span>
        <Input aria-label="Maximum invitee reschedules per booking" type="number" min="0" step="1" value={value.maxInviteeReschedules ?? ""} placeholder="Unlimited" aria-describedby={compact ? undefined : capHelpId} onChange={event => onChange({ ...value, maxInviteeReschedules: event.target.value === "" ? null : Number(event.target.value) })} />
      </label>
      {state && onRetry ? <SaveFailed id={`${capHelpId}-failed`} state={state("maxInviteeReschedules")} what="the reschedule limit" onRetry={onRetry} /> : null}
      {!compact ? <p id={capHelpId} className="-mt-3 text-sm leading-6 text-soft">Leave blank for unlimited reschedules.</p> : null}

    </fieldset>
  </Container>;
}

function CutoffField({ action, value, onChange, compact, state, onRetry }: { state?: FieldState; onRetry?(): void; compact: boolean; action: "rescheduling" | "cancellation"; value: number | null; onChange(value: number | null): void }) {
  const helpId = useId();
  const [unit, setUnit] = useState<CutoffUnit>(() => value !== null && value > 0 && value % 1440 === 0 ? "days" : "hours");
  return <div className="grid content-start gap-2">
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-2">
      <label className="grid min-w-0 gap-2 text-sm font-[650]"><span className="flex items-center justify-between gap-2">Block invitee {action} within{state ? <SavedMark state={state} /> : null}</span>
        <Input aria-label={`Block invitee ${action} within`} type="number" min="0" step="any" value={value === null ? "" : value / minutesPerUnit[unit]} placeholder="Default" aria-describedby={compact ? undefined : helpId} onChange={event => onChange(event.target.value === "" ? null : Math.round(Number(event.target.value) * minutesPerUnit[unit]))} />
      </label>
      <label className="grid gap-2 text-sm font-[650]"><span className="sr-only">Invitee {action} cut-off unit</span>
        <Select value={unit} onChange={event => setUnit(event.target.value as CutoffUnit)}><option value="hours">Hours</option><option value="days">Days</option></Select>
      </label>
    </div>
    {state && onRetry ? <SaveFailed id={`${helpId}-failed`} state={state} what={`the ${action} cutoff`} onRetry={onRetry} /> : null}
    {!compact ? <p id={helpId} className="text-sm leading-6 text-soft">Leave blank to use the workspace’s {action} settings.</p> : null}
  </div>;
}
