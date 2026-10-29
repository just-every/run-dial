import { Input } from "../../../../app/ui/primitives";
import { SavedMark, SaveFailed } from "../../../../app/ui/autosave/saved-state";
import { InlineConfirm } from "../../../../app/ui/autosave/inline-confirm";
import type { EventDetailsSave } from "../event-page-context";
export function AddressAndListing({ details, live = false }: { details: EventDetailsSave; live?: boolean }) {
  return <div className="grid gap-4" onBlur={details.leave}>
    <div className="grid gap-2"><label className="flex items-center justify-between gap-2 text-sm font-semibold" htmlFor="event-address">Address<SavedMark state={details.state("slug")} /></label><Input id="event-address" aria-label="Address" value={details.values.slug} maxLength={80} onChange={event => details.type("slug", event.target.value)} onBlur={() => details.leave("slug")} aria-describedby={details.validation("slug") || details.state("slug").failed ? "address-save-failed" : undefined} />
      <SaveFailed id="address-save-failed" state={details.state("slug")} what="the address" problem={details.validation("slug")} onRetry={details.retry} />
      {live && details.state("slug").asking ? <InlineConfirm question="Change this event’s booking address?" detail="The old address will stop working." action="Change the address" keep="Keep current address" onAction={() => details.confirm("slug")} onKeep={() => details.keep("slug")} /> : null}
    </div>
    <div className="grid gap-2"><label className="flex items-center justify-between gap-2 text-sm font-semibold" htmlFor="event-colour">Colour<SavedMark state={details.state("color")} /></label><Input type="color" className="h-11 p-1" id="event-colour" aria-label="Colour" value={details.values.color} onChange={event => details.type("color", event.target.value)} /><SaveFailed id="colour-save-failed" state={details.state("color")} what="the colour" onRetry={details.retry} /></div>
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" aria-label="List on the public profile" className="h-5 w-5 accent-ink" checked={details.values.listed} onChange={event => details.choose("listed", event.target.checked)} />List on the public profile<SavedMark state={details.state("listed")} /></label><SaveFailed id="listing-save-failed" state={details.state("listed")} what="the listing" choice onRetry={details.retry} />
  </div>;
}
