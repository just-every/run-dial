import { RedirectFields } from "../redirect-fields";
import { SavedMark, SaveFailed } from "../../../../app/ui/autosave/saved-state";
import type { EventDetailsSave } from "../event-page-context";
export function AfterBooking({ details }: { details: EventDetailsSave }) {
  return <div className="grid gap-3" onBlur={details.leave}><RedirectFields compact value={details.values.postBookingRedirect} questions={details.values.questions} onChange={value => details.type("postBookingRedirect", value)} onChoose={value => details.choose("postBookingRedirect", value)} /><SavedMark state={details.state("postBookingRedirect")} /><SaveFailed id="redirect-save-failed" state={details.state("postBookingRedirect")} what="the page after booking" onRetry={details.retry} /></div>;
}
