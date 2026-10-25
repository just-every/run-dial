import { Fragment } from "react";
import { Card } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { CopyBookingLink } from "./copy-booking-link";
import { useHostSetup } from "./use-host-setup";

export function EventSharing({ eventId, workspace = "/app" }: { eventId: string; workspace?: "/app" | "/setup" }) {
  const { state, error } = useHostSetup();
  const link = state?.links.find((candidate) => candidate.eventTypeId === eventId);
  return <Card className="p-5 sm:p-6"><SectionHeading icon="link" title="Share this event" />{error ? <p role="alert">{error}</p> : link ? <><p className="my-3 font-mono text-[13px] leading-6 [overflow-wrap:anywhere]"><a href={link.url} className="text-ink underline decoration-[1.5px] underline-offset-4 hover:decoration-gold-deep"><BreakableUrl url={link.url} /></a></p><CopyBookingLink link={link} /><p className="mt-3 text-sm"><a href={`${workspace}/settings?event=${encodeURIComponent(eventId)}#embed-settings`} className="font-semibold text-ink underline decoration-[1.5px] underline-offset-4 hover:decoration-gold-deep">Embed on your website</a></p></> : <p className="mt-3 text-sm text-soft">Publish this event or Open requests to share its live link.</p>}</Card>;
}

/** A URL that wraps after its slashes, so a long link breaks between path parts instead of inside a word. */
function BreakableUrl({ url }: { url: string }) {
  const parts = url.split(/(?<=[^/:]\/)/);
  return <>{parts.map((part, index) => <Fragment key={index}>{part}{index < parts.length - 1 ? <wbr /> : null}</Fragment>)}</>;
}
