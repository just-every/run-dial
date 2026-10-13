import { WeekScene } from "../drawings/WeekScene";

/** For the host: the final calendar check at confirmation, one booking per time, and the scheduling rules. */
export function CheckedForYou() {
  return <section className="split split--host" id="host" aria-labelledby="host-title">
    <WeekScene />
    <div className="split-copy">
      <h2 id="host-title" className="stacked"><span>For you:</span> <span>Checked at the moment it counts.</span></h2>
      <p className="section-lede">When someone confirms, Dial reads your calendar again and books the time only if it is still free, and each time can be booked only once. If your calendar can’t be read, Dial offers no times rather than guess. Weekly windows, date overrides, buffers, minimum notice, a daily limit and daylight saving are all handled for you.</p>
    </div>
  </section>;
}
