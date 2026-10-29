import { CopyBookingLink } from "./copy-booking-link";
import { useHostSetup } from "./use-host-setup";

/** The preview carries sharing; embed controls have their home in Settings. */
export function EventSharing({ eventId }: { eventId: string; workspace?: "/app" | "/setup" }) {
  const { state, error } = useHostSetup();
  const link = state?.links.find(candidate => candidate.eventTypeId === eventId);
  return <section aria-label="Booking link" className="grid min-w-0 gap-3"><h3 className="text-sm font-semibold">Booking link</h3>{error ? <p role="alert" className="text-sm">{error}</p> : link ? <><a href={link.url} className="min-h-11 content-center break-all font-mono text-[13px] leading-6 underline underline-offset-4">{new URL(link.url).pathname}</a><CopyBookingLink link={link} label="Copy link" /></> : <p className="text-sm text-soft">Publish to share its booking link.</p>}</section>;
}
