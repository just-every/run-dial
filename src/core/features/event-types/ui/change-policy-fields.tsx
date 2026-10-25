import { useId, useState } from "react";
import { Card, Input, Select } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import type { ChangePolicy } from "../../../shared/change-policy";

type Props = {
  value: ChangePolicy;
  onChange(value: ChangePolicy): void;
  disabled?: boolean;
};
type CutoffUnit = "hours" | "days";
const minutesPerUnit: Record<CutoffUnit, number> = { hours: 60, days: 1440 };

export function ChangePolicyFields({ value, onChange, disabled = false }: Props) {
  const capHelpId = useId();
  return <Card className="p-5 sm:p-6">
    <SectionHeading icon="clock" title="Invitee changes" description="Set separate rescheduling and cancellation cut-offs for this event type." />
    <fieldset disabled={disabled} className="mt-5 grid gap-5 border-0 p-0">
      <div className="grid gap-5 sm:grid-cols-2">
        <CutoffField action="rescheduling" value={value.rescheduleCutoffMinutes} onChange={rescheduleCutoffMinutes => onChange({ ...value, rescheduleCutoffMinutes })} />
        <CutoffField action="cancellation" value={value.cancellationCutoffMinutes} onChange={cancellationCutoffMinutes => onChange({ ...value, cancellationCutoffMinutes })} />
      </div>
      <label className="grid gap-2 text-sm font-[650]">Maximum invitee reschedules per booking
        <Input type="number" min="0" step="1" value={value.maxInviteeReschedules ?? ""} placeholder="Unlimited" aria-describedby={capHelpId} onChange={event => onChange({ ...value, maxInviteeReschedules: event.target.value === "" ? null : Number(event.target.value) })} />
      </label>
      <p id={capHelpId} className="-mt-3 text-sm leading-6 text-soft">Leave blank for unlimited reschedules. Zero prevents all invitee reschedules. Only successful invitee reschedules count.</p>
      <p className="text-sm leading-6 text-soft">These rules apply to invitee changes. Hosts can still change bookings.</p>
    </fieldset>
  </Card>;
}

function CutoffField({ action, value, onChange }: { action: "rescheduling" | "cancellation"; value: number | null; onChange(value: number | null): void }) {
  const helpId = useId();
  const [unit, setUnit] = useState<CutoffUnit>(() => value !== null && value > 0 && value % 1440 === 0 ? "days" : "hours");
  return <div className="grid content-start gap-2">
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-2">
      <label className="grid min-w-0 gap-2 text-sm font-[650]">Block invitee {action} within
        <Input type="number" min="0" step="any" value={value === null ? "" : value / minutesPerUnit[unit]} placeholder="Workspace default" aria-describedby={helpId} onChange={event => onChange(event.target.value === "" ? null : Math.round(Number(event.target.value) * minutesPerUnit[unit]))} />
      </label>
      <label className="grid gap-2 text-sm font-[650]"><span className="sr-only">Invitee {action} cut-off unit</span>
        <Select value={unit} onChange={event => setUnit(event.target.value as CutoffUnit)}><option value="hours">Hours</option><option value="days">Days</option></Select>
      </label>
    </div>
    <p id={helpId} className="text-sm leading-6 text-soft">Before the start. Leave blank to use the workspace’s {action} settings. Zero allows changes until the start. Hours or days are stored to the nearest minute.</p>
  </div>;
}
