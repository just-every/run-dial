import { Icon } from "../../../../shared/drawing/icons";
import { MiniDial } from "../../../../shared/drawing/MiniDial";

// What an invitee sees on Dial's choose-time step, drawn small: a row of seven days, up to five suggested times that each give
// the reason they were picked, and the other times that day. The suggestions are in ranking order and their reasons are the
// ones the recommendation ranking gives (availability/recommendations.ts): inside both working days first, then more
// uninterrupted free time, then the earliest start.
const days = [["Mon", "12"], ["Tue", "13"], ["Wed", "14"], ["Thu", "15"], ["Fri", "16"], ["Sat", "17"], ["Sun", "18"]];
const suggested = [["9:30 AM", "Inside both working days"], ["11:00 AM", "Inside both working days"], ["8:00 AM", "More uninterrupted free time"], ["7:30 AM", "Earliest available time"]];
const others = ["12:00 PM", "12:30 PM", "1:30 PM", "2:00 PM", "3:30 PM", "4:00 PM"];

/** The invitees' section drawing: the day-first picker, the two timezones and the private link for changes. */
export function PickerScene() {
  return <div className="scene picker-scene" aria-hidden="true">
    <div className="paper-card picker-card">
      <div className="picker-head"><span>Intro call · 30 minutes</span><span className="picker-zone">Times in America/New_York</span></div>
      <div className="picker-days">{days.map(([weekday, date], index) => <span key={date} className={index === 2 ? "picker-day is-chosen" : "picker-day"}><small>{weekday}</small>{date}</span>)}</div>
      <div className="picker-body">
        <div>
          <p className="picker-label">Suggested times</p>
          <ul className="picker-suggested">{suggested.map(([time, reason], index) => <li key={time} className={index === 0 ? "is-chosen" : undefined}><span className="picker-dot" /><span><b>{time}</b><small>{reason}</small></span></li>)}</ul>
        </div>
        <div>
          <p className="picker-label">Other times</p>
          <ul className="picker-others">{others.map((time) => <li key={time}>{time}</li>)}</ul>
        </div>
      </div>
    </div>
    <div className="paper-card zone-card">
      <MiniDial chosen={3} />
      <p><small>Your time</small><b>9:30 AM</b><small>Host: 2:30 PM, Europe/London</small></p>
    </div>
    <div className="paper-card change-card">
      <span className="change-icon"><Icon name="link" /></span>
      <p><b>Plans changed?</b><small>Reschedule or cancel with your private link</small></p>
    </div>
  </div>;
}
