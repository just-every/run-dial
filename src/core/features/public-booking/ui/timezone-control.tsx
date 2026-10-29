import { deviceTimezone } from "../../../shared/timezone-choices";
import { TimezonePicker } from "../../../shared/timezone-picker";

export function TimezoneControl({ timezone, hostTimezone, onChange, disabled = false }: { timezone: string; hostTimezone: string; onChange: (zone: string) => void; disabled?: boolean }) {
  return <section className="dial-timezone-control" aria-label="Displayed timezone">
    <TimezonePicker label="Times in" accessibleLabel="View in timezone" value={timezone} onChange={onChange} deviceZone={deviceTimezone(hostTimezone)} disabled={disabled} />
  </section>;
}
