import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Badge, Card, textLinkClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import type { PlatformHealth } from "../../../platform/health";
import type { HostSetupOverview, ConnectionStatus } from "../steps";
import { operatorTimestamp } from "../../../shared/operator-format";

export function HealthStatus({ state, workspace = "/app" }: { state: HostSetupOverview; workspace?: "/app" | "/setup" }) {
  const [platform, setPlatform] = useState<PlatformHealth & { checkedAt: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const request = new AbortController();
    const stop = () => { active = false; request.abort(); };
    window.addEventListener("dial:auth-lost", stop);
    void api.api.app["platform-health"].$get(undefined, { init: { signal: request.signal } }).then(async (response) => {
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = await response.json(); if (active) setPlatform(result);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Platform health could not be checked."); });
    return () => { stop(); window.removeEventListener("dial:auth-lost", stop); };
  }, []);
  return <Card className="p-5 sm:p-6"><SectionHeading icon="link" title="Integrations and delivery" /><div className="mt-5 grid gap-4">
    <Connection name="Google Calendar" health={state.calendar} href={`${workspace}/settings#calendar-connection`} />
    <a className={`${textLinkClassName} w-fit text-[15px]`} href={`${workspace}/settings#calendar-connection`}>Google setup guide</a>
    <Connection name="Transactional mail" health={state.mail} href={`${workspace}/settings#mail-connection`} />
    {(["database", "storage", "queue"] as const).map((name) => <div key={name}><h3 className="font-bold capitalize">{name}</h3><p className="text-sm text-soft">{platform ? platform.checks[name] === "ok" ? "Healthy" : "Unavailable" : error ? "Check unavailable" : "Not yet checked"}</p><p className="text-[13px] text-muted">{platform ? `Last checked ${operatorTimestamp(platform.checkedAt)}` : "No check time available."}</p></div>)}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
  </div></Card>;
}

function Connection({ name, health, href }: { name: string; health: ConnectionStatus; href: string }) {
  return <div><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold"><a href={href} className="underline decoration-[1.5px] underline-offset-4 hover:decoration-gold-deep">{name}</a></h3><Badge tone={health.state === "healthy" && health.checkedAt ? "success" : "warning"}>{health.checkedAt === null && health.state === "healthy" ? "Not yet checked" : health.state}</Badge></div>{health.reason ? <p className="mt-1 text-sm text-soft">{health.reason.replaceAll("_", " ")}</p> : null}<p className="mt-1 text-[13px] text-muted">{health.checkedAt ? `Last checked ${operatorTimestamp(health.checkedAt)}` : "Not yet checked"}</p></div>;
}
