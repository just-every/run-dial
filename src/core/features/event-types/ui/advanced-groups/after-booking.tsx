import { RedirectFields } from "../redirect-fields";
import { SavedMark, SaveFailed } from "../../../../app/ui/autosave/saved-state";
import type { EventDetailsSave } from "../event-page-context";
export function AfterBooking({ details }: { details: EventDetailsSave }) {
  return <div className="grid gap-3" onBlur={entry => { details.leave(entry.currentTarget.contains(entry.relatedTarget) ? undefined : "postBookingRedirect"); } }><RedirectFields compact value={details.values.postBookingRedirect} questions={details.values.questions} onChange={value => details.type("postBookingRedirect", value)} onChoose={value => details.choose("postBookingRedirect", value)} /><SavedMark state={details.state("postBookingRedirect")} />{details.validation("postBookingRedirect") ? <p className="autosave-failed" role="alert" tabIndex={-1} data-autosave-attention>{details.validation("postBookingRedirect")}</p> : <SaveFailed id="redirect-save-failed" state={details.state("postBookingRedirect")} what="the page after booking" onRetry={details.retry} />}</div>;
}
