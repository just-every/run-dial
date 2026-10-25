import type { ReactNode } from "react";
import { PublicFooter, PublicHeader, PublicTheme, SessionSidebar } from "./public-shell";
import type { PublicEventPayload } from "./types";

export function FlowShell({ data, children, embedded, step }: { data: PublicEventPayload; children: ReactNode; embedded: boolean; step?: 1 | 2 }) { return <PublicTheme><PublicHeader profilePath={embedded || data.eventType.requestOnly ? undefined : `/book/${data.profile.handle}`} embedded={embedded} step={step} /><main className="pb-event-page"><div className="pb-mobile-session"><SessionSidebar profile={data.profile} eventType={data.eventType} compact /></div><div className="pb-event-layout"><SessionSidebar profile={data.profile} eventType={data.eventType} /><section className="pb-event-flow">{children}</section></div></main><PublicFooter embedded={embedded} /></PublicTheme>; }
export { format, formatRange } from "./invitee-time";
