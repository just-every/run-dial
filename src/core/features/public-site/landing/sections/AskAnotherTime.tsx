import { RequestScene } from "../drawings/RequestScene";

/** Alternative requests: invitees send windows that suit them, and nothing is reserved until the host books one. */
export function AskAnotherTime() {
  return <section className="column" id="requests" aria-labelledby="requests-title">
    <h2 id="requests-title" className="stacked"><span>Let them ask</span> <span>for another time.</span></h2>
    <p className="column-lede">When none of the times work, invitees send you the dates and windows that suit them. Nothing is reserved until you book one, and they hear back by email.</p>
    <RequestScene />
  </section>;
}
