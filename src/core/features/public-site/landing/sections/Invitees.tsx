import { PickerScene } from "../drawings/PickerScene";

/** For invitees: the booking flow without an account, in their own timezone, with a private link for changes. */
export function Invitees() {
  return <section className="split split--invitees" id="invitees" aria-labelledby="invitees-title">
    <div className="split-copy">
      <h2 id="invitees-title" className="stacked"><span>For invitees:</span> <span>No accounts.</span> <span>No back-and-forth.</span></h2>
      <p className="section-lede">Invitees pick a day, see up to five suggested times, each with the reason it was picked, and book in their own timezone without an account. If&nbsp;plans change, the private link in their confirmation lets them reschedule or cancel.</p>
    </div>
    <PickerScene />
  </section>;
}
