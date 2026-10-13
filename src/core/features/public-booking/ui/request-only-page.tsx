import { useRouterState } from "@tanstack/react-router";
import { FlowShell } from "./flow-shell";
import { bookingPath } from "./navigation";
import type { PublicEventPayload } from "./types";

export function RequestOnlyPage({ data, embedded }: { data: PublicEventPayload; embedded: boolean }) {
  const search = useRouterState({ select: state => state.location.searchStr });
  return <FlowShell data={data} embedded={embedded}>
    <div className="pb-event-heading"><div>
      <p className="pb-eyebrow">Requests only</p>
      <h1>Request a time with {data.profile.name}.</h1>
      <h2>{data.eventType.title}</h2>
      <p>Automatic booking is not open. Calendar availability has not been verified for this event. Your request goes to the host for review; it does not reserve a time or create a booking.</p>
    </div></div>
    <a className="pb-primary-button" href={bookingPath(data.profile.handle, data.eventType.slug, "/request", embedded, {}, search)}>Send another request</a>
  </FlowShell>;
}
