import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { api, errorMessage } from "../../../api/client";
import { Badge, Button, noticeClassName } from "../../../app/ui/primitives";
import { Tooltip } from "../../../app/ui/tooltip";
import { InlineConfirm } from "../../../app/ui/autosave/inline-confirm";
import { saveBeforeLeaving } from "../../../app/ui/autosave/leave-guard";
import { ReadinessPanel } from "../../../app/ui/readiness-panel";
import { readinessFix } from "../readiness";
import type { EventTypeRecord } from "../repository";
import "./event-page.css";

export type EventReadiness = { ready: boolean; missing: string[]; requests?: { ready: boolean; missing: string[] } };
type Action = "pause" | "delete" | "requests" | "publish";
export function EventActions({ event, workspace, readiness, checking, onChange, onSaved }: { event: EventTypeRecord; workspace: "/app" | "/setup"; readiness?: EventReadiness; checking: boolean; onChange(event: EventTypeRecord): void; onSaved(): void }) {
  const navigate = useNavigate();
  const opener = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false), [asking, setAsking] = useState<Action>();
  const [working, setWorking] = useState(false), [error, setError] = useState("");
  const [requirements, setRequirements] = useState<{ missing: string[]; readiness?: EventReadiness }>();
  const latestReadiness = useRef(readiness);
  useEffect(() => { latestReadiness.current = readiness; if (requirements && requirements.readiness !== readiness) { setRequirements(undefined); setError(""); } }, [readiness, requirements]);
  const currentRequirements = requirements?.readiness === readiness ? requirements?.missing ?? readiness?.missing : readiness?.missing;
  const live = event.status === "published";
  const liveMissing = event.requestOnly ? readiness?.requests?.missing.filter(code => code !== "event_already_published") : readiness?.missing;
  const state = event.status === "draft" ? "Draft" : event.status === "disabled" ? "Paused" : event.requestOnly ? "Requests only" : "Live";
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (entry: PointerEvent) => { if (!menu.current?.contains(entry.target as Node) && !opener.current?.contains(entry.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  function choose(action: Action) {
    setOpen(false); setError(""); setRequirements(undefined);
    if (action === "publish" || action === "delete" || live && (action === "pause" || action === "requests" && event.alternativeRequestsEnabled)) setAsking(action);
    else void act(action);
  }
  async function act(action: Action | "duplicate" | "resume" | "open-requests") {
    if (inFlight.current) return;
    inFlight.current = true; setWorking(true);
    if (!await saveBeforeLeaving()) { inFlight.current = false; setWorking(false); return; }
    setError("");
    try {
      const endpoint = api.api.app["event-types"][":id"];
      const param = { id: event.id };
      const response = action === "duplicate" ? await endpoint.duplicate.$post({ param })
        : action === "delete" ? await endpoint.$delete({ param })
        : action === "pause" ? await endpoint.disable.$post({ param })
        : action === "requests" ? await endpoint["alternative-requests"].$patch({ param, json: { enabled: !event.alternativeRequestsEnabled } })
        : action === "open-requests" || action === "resume" && event.requestOnly ? await endpoint["open-requests"].$post({ param })
        : await endpoint.publish.$post({ param });
      if (!response.ok && !(action === "delete" && response.status === 404)) {
        const failure = await response.clone().json().catch(() => undefined) as { error?: { details?: string[] } } | undefined;
        setRequirements(failure?.error?.details ? { missing: failure.error.details, readiness: latestReadiness.current } : undefined); throw new Error(await errorMessage(response));
      }
      setAsking(undefined); setOpen(false);
      if (action === "delete") { await navigate({ to: `${workspace}/event-types` }); return; }
      const record = await response.json() as EventTypeRecord;
      if (action === "duplicate") { await navigate({ to: `${workspace}/event-types/$id`, params: { id: record.id } }); return; }
      onChange(record); onSaved();
      requestAnimationFrame(() => document.getElementById("event-actions-button")?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The action could not be checked. Try again."); }
    finally { inFlight.current = false; setWorking(false); }
  }
  return <header className="grid gap-4">
    <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-4"><div className="min-w-0"><h1 className="break-words text-[34px] font-extrabold leading-[1.1] tracking-[-.02em] sm:text-[40px]">{event.title}</h1><div className="mt-3"><Badge tone={live ? "success" : "warning"}>{state}</Badge></div></div>
      <div className="event-action-anchor flex items-center gap-2">
        {event.status === "draft" || live && event.requestOnly ? <Button type="button" onClick={() => choose("publish")} disabled={working}>Publish</Button> : null}
        <Tooltip label="Event actions"><Button id="event-actions-button" ref={opener} type="button" variant="secondary" className="h-11 w-11 p-0 text-2xl" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</Button></Tooltip>
        {open ? <div ref={menu} role="menu" tabIndex={-1} aria-label="Event actions" className="event-actions-menu" onKeyDown={entry => {
          const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (entry.key === "Escape") { entry.preventDefault(); setOpen(false); opener.current?.focus(); }
          else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(entry.key)) { entry.preventDefault(); buttons[entry.key === "Home" ? 0 : entry.key === "End" ? buttons.length - 1 : (index + (entry.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
        }}>
          <button role="menuitem" type="button" onClick={() => void act("duplicate")}>Duplicate</button>
          <button role="menuitem" type="button" onClick={() => event.status === "disabled" ? void act("resume") : choose("pause")}>{event.status === "disabled" ? "Resume" : "Pause"}</button>
          <button role="menuitem" type="button" onClick={() => choose("requests")}>{event.alternativeRequestsEnabled ? "Turn off alternative requests" : "Allow alternative requests"}</button>
          <button role="menuitem" type="button" className="text-danger" onClick={() => choose("delete")}>Delete</button>
        </div> : null}
      </div>
    </div>
    {live && liveMissing?.length ? <p className="text-sm text-soft">Needs attention: {liveMissing.map((code, index) => { const fix = readinessFix(code, event.id); return <span key={code}>{index ? " · " : ""}<Link to={fix.href.replace(/\/availability$/, "/hours").replace(/^\/app/, workspace)} className="font-semibold underline underline-offset-4">{fix.label}</Link></span>; })}</p> : null}
    {asking === "publish" ? <section aria-label="Publish event" className="grid gap-4 rounded-[18px] bg-gold-wash p-5"><ReadinessPanel workspace={workspace} eventId={event.id} missing={currentRequirements} checking={checking} /><p className="text-sm text-soft">Publishing turns on real bookings. Without a connected calendar, Dial does not check external calendar conflicts.</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={working || checking || (currentRequirements ?? []).length > 0} onClick={() => void act("publish")}>Publish event</Button>{readiness?.requests?.ready ? <Button type="button" variant="secondary" disabled={working} onClick={() => void act("open-requests")}>Open requests</Button> : null}<Button type="button" variant="secondary" onClick={() => setAsking(undefined)}>{live && event.requestOnly ? "Keep requests only" : "Keep draft"}</Button></div></section> : asking ? <InlineConfirm question={asking === "pause" ? `Pause ${event.title}?` : asking === "delete" ? `Delete ${event.title}?` : `Turn off alternative requests for ${event.title}?`} detail={asking === "delete" ? "Its booking link and availability will be removed. This cannot be undone." : "Bookings already made stay as they are."} action={asking === "pause" ? "Pause event" : asking === "delete" ? "Delete event" : "Turn off alternative requests"} keep={asking === "pause" ? "Keep it live" : asking === "delete" ? "Keep event" : "Keep requests on"} onAction={() => { if (!working) void act(asking); }} onKeep={() => setAsking(undefined)} /> : null}
    {error ? <p role="alert" className={noticeClassName("error")}>{error}</p> : null}
  </header>;
}
