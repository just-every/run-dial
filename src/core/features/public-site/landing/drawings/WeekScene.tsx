import { Burst } from "../../../../shared/drawing/Burst";
import { Icon, type IconName } from "../../../../shared/drawing/icons";

// The host's week as Dial reads it: busy blocks with no titles (Dial keeps busy times only), and the one golden slot being
// checked again at the moment the invitee confirms. Rows are half hours from 9:00; [day, first row, rows].
const busy: [number, number, number][] = [[1, 1, 3], [1, 9, 2], [2, 3, 2], [2, 12, 4], [3, 0, 1], [3, 4, 3], [3, 13, 2], [4, 2, 4], [4, 14, 2], [5, 3, 1], [5, 7, 3], [5, 13, 2]];
const chosen: [number, number, number] = [3, 11, 1];
const days = [["Mon", 12], ["Tue", 13], ["Wed", 14], ["Thu", 15], ["Fri", 16]] as const;
const rules: [IconName, string][] = [["clock", "Weekly windows"], ["overrides", "Date overrides"], ["buffers", "Buffers"], ["notice", "Minimum notice"], ["limits", "Daily limit"], ["daylight", "Daylight saving"]];

const block = ([day, row, rows]: [number, number, number]) => ({ gridColumn: day, gridRow: `${row + 1} / span ${rows}` });

/** The "checked at the moment it counts" drawing: the week, the golden slot with its check, and the rules Dial applies. */
export function WeekScene() {
  return <div className="scene week-scene" aria-hidden="true">
    <div className="paper-card week-card">
      <div className="week-head"><span>Your calendar</span><span className="week-note">Busy times only</span></div>
      <div className="week-days"><span />{days.map(([day, date]) => <span key={day}>{day}<span className="week-date"> {date}</span></span>)}</div>
      <div className="week-body">
        <div className="week-hours">{["9 AM", "10", "11", "12 PM", "1", "2", "3", "4"].map((hour) => <span key={hour}>{hour}</span>)}</div>
        <div className="week-grid">
          {busy.map((entry) => <span key={entry.join("-")} className="week-busy" style={block(entry)} />)}
          <span className="week-chosen" style={block(chosen)}>
            <b>2:30</b>
            <span className="week-check"><Icon name="check" /></span>
            <svg className="week-burst" viewBox="0 0 80 80" focusable="false"><Burst cx={8} cy={72} radius={18} length={26} degrees={30} spread={22} /></svg>
          </span>
        </div>
      </div>
    </div>
    <ul className="rule-chips">{rules.map(([icon, label]) => <li key={label}><Icon name={icon} />{label}</li>)}</ul>
  </div>;
}
