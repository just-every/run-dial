import type { ReactNode } from "react";
import { PublicFooter, PublicHeader, PublicTheme, SessionSidebar } from "./public-shell";
import type { PublicEventPayload } from "./types";

export function FlowShell({ data, children, embedded, step }: { data: PublicEventPayload; children: ReactNode; embedded: boolean; step?: 1 | 2 }) { return <PublicTheme><PublicHeader profilePath={embedded || data.eventType.requestOnly ? undefined : `/book/${data.profile.handle}`} embedded={embedded} step={step} /><main className="pb-event-page"><div className="pb-mobile-session"><SessionSidebar profile={data.profile} eventType={data.eventType} compact /></div><div className="pb-event-layout"><SessionSidebar profile={data.profile} eventType={data.eventType} /><section className="pb-event-flow">{children}</section></div></main><PublicFooter embedded={embedded} /></PublicTheme>; }
export function format(value: string, timezone: string) { return new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "longOffset" }).format(new Date(value)); }
export function formatTime(value: string, timezone: string) { return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "longOffset" }).format(new Date(value)); }
