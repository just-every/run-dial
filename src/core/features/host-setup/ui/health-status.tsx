import { Badge, Card, phoneTapClassName, textLinkClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { usePlatformHealth } from "./platform-health";
import type { HostSetupOverview, ConnectionStatus } from "../steps";
import { operatorTimestamp } from "../../../shared/operator-format";

export function HealthStatus({ state, workspace = "/app" }: { state: HostSetupOverview; workspace?: "/app" | "/setup" }) {
  const { platform, error } = usePlatformHealth();
  return <Card className="p-5 sm:p-6"><SectionHeading icon="link" title="Integrations and delivery" /><p className="mt-2 text-sm text-soft">Times shown in {state.hostTimezone ?? "UTC"}.</p><div className="mt-5 grid gap-4">
    {workspace === "/app" && state.completedAt && state.availabilityReady && state.calendar.state === "disconnected" ? <div><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Dial availability</h3><Badge tone="success">Active</Badge></div><p className="mt-1 text-sm text-soft">Saved hours and confirmed bookings determine your open times.</p><a className={`${textLinkClassName} ${phoneTapClassName} mt-2 inline-block text-[15px]`} href={`${workspace}/settings#calendar-connection`}>Connect an optional Google Calendar</a></div> : <><Connection name="Google Calendar" health={state.calendar} timezone={state.hostTimezone} href={`${workspace}/settings#calendar-connection`} /><a className={`${textLinkClassName} ${phoneTapClassName} w-fit text-[15px]`} href={`${workspace}/settings#calendar-connection`}>Google setup guide</a></>}
    <Connection name="Transactional mail" health={state.mail} timezone={state.hostTimezone} href={`${workspace}/settings#mail-connection`} />
    {(["database", "storage", "queue"] as const).map((name) => <div key={name}><h3 className="font-bold capitalize">{name}</h3><p className="text-sm text-soft">{platform ? platform.checks[name] === "ok" ? "Healthy" : "Unavailable" : error ? "Check unavailable" : "Not yet checked"}</p><p className="text-[13px] text-muted">{platform ? `Last checked ${operatorTimestamp(platform.checkedAt, state.hostTimezone ?? "UTC")}` : "No check time available."}</p></div>)}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
  </div></Card>;
}

function Connection({ name, health, href, timezone }: { name: string; health: ConnectionStatus; href: string; timezone: string | null }) {
  return <div><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold"><a href={href} className={`${phoneTapClassName} underline decoration-[1.5px] underline-offset-4 hover:decoration-gold-deep`}>{name}</a></h3><Badge tone={health.state === "healthy" && health.checkedAt ? "success" : "warning"}>{health.state === "unchecked" || health.checkedAt === null && health.state === "healthy" ? "Not yet checked" : health.state}</Badge></div>{health.reason ? <p className="mt-1 text-sm text-soft">{health.reason.replaceAll("_", " ")}</p> : null}<p className="mt-1 text-[13px] text-muted">{health.checkedAt ? `Last checked ${operatorTimestamp(health.checkedAt, timezone ?? "UTC")}` : "Not yet checked"}</p></div>;
}
