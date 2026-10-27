import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { api, errorMessage } from "../../../api/client";
import { FocusDialog } from "../../../app/ui/focus-dialog";
import { Badge, Button, Card, buttonClassName, noticeClassName } from "../../../app/ui/primitives";
import { Tooltip } from "../../../app/ui/tooltip";
import { hostSetupChanged } from "../../host-setup";
import { startingHours, type HoursRead } from "../../availability";
import { defaultEventTypeInput } from "../defaults";
import type { EventLocationOption } from "../locations";
import type { AvailabilityWindowInput, EventTypeRecord } from "../repository";
import { EventTypesPage } from "./event-types-page";
import { StepName } from "./step-name";
import { StepLength } from "./step-length";
import { StepWhere } from "./step-where";
import { StepWhen } from "./step-when";
import "./new-event-steps.css";

export { StepName } from "./step-name";
export { StepLength } from "./step-length";
export { StepWhere } from "./step-where";
export { StepWhen } from "./step-when";

type Draft = { step: number; name: string; description: string; minutes: number; location: EventLocationOption; uses: "yours" | "own"; windows: AvailabilityWindowInput[] | null };
const initial = (): Draft => ({ step: 1, name: "", description: "", minutes: 30, location: { id: "default", type: "fixed_link", label: "Meeting link", value: "" }, uses: "yours", windows: null });
const questions = ["What's it called?", "How long is it?", "Where does it happen?", "When can people book it?"];
const kinds = ["google_meet", "fixed_link", "phone", "invitee_phone", "in_person", "ask_invitee", "custom"];
function readDraft(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Draft | null;
    if (value && Number.isInteger(value.step) && value.step >= 1 && value.step <= 4 && typeof value.name === "string" && typeof value.description === "string" && typeof value.minutes === "number" && kinds.includes(value.location?.type) && typeof value.location.label === "string" && typeof value.location.value === "string" && ["yours", "own"].includes(value.uses) && (value.windows === null || Array.isArray(value.windows) && value.windows.every(window => Number.isInteger(window.weekday) && Number.isInteger(window.startMinute) && Number.isInteger(window.endMinute)))) return value;
  } catch { /* Creation remains available when browser storage is unavailable. */ }
  return initial();
}

export function NewEventSteps({ workspace = "/app" }: { workspace?: "/app" | "/setup" }) {
  const navigate = useNavigate();
  const key = `dial:new-event:${workspace}`;
  const [draft, setDraft] = useState<Draft>(initial);
  const [restored, setRestored] = useState(false);
  const [events, setEvents] = useState<EventTypeRecord[]>();
  const empty = !events?.length;
  const [yours, setYours] = useState<AvailabilityWindowInput[]>();
  const [hoursError, setHoursError] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const busy = useRef(false);
  const created = useRef(false);
  const fields = useRef<HTMLDivElement>(null);
  const timezone = useRouteContext({ strict: false }).shell?.profile?.timezone;

  useEffect(() => { setDraft(readDraft(key)); setRestored(true); }, [key]);
  useEffect(() => {
    if (!restored || created.current) return;
    try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch { /* A storage refusal must never block the form. */ }
  }, [key, draft, restored]);
  useEffect(() => {
    if (restored) fields.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
  }, [draft.step, restored]);
  useEffect(() => {
    const controller = new AbortController(); setHoursError("");
    void fetch("/api/app/hours", { signal: controller.signal }).then(async response => {
      if (!response.ok) { if (!controller.signal.aborted) setHoursError(await errorMessage(response)); return; }
      const hours = await response.json() as HoursRead;
      // Before the first event, the schedule is absent. Creation installs these same server defaults.
      if (!controller.signal.aborted) setYours(hours.yours?.windows ?? startingHours);
    }).catch(() => { if (!controller.signal.aborted) setHoursError("Your hours could not be loaded."); });
    return () => controller.abort();
  }, [revision]);
  function patch(value: Partial<Draft>) { setDraft(current => ({ ...current, ...value })); setError(""); }
  async function leave() { await navigate({ to: empty ? workspace : `${workspace}/event-types` }); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !restored) return;
    if (draft.step < 4) { patch({ step: draft.step + 1 }); return; }
    if (!yours) { setHoursError("Read your hours before creating the event."); return; }
    busy.current = true; setCreating(true); setError("");
    try {
      const details = defaultEventTypeInput();
      const baseSlug = draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "event";
      let slug = baseSlug;
      for (let number = 2; events?.some(event => event.slug === slug); number++) {
        const suffix = `-${number}`; slug = baseSlug.slice(0, 80 - suffix.length) + suffix;
      }
      const response = await api.api.app["event-types"].$post({ json: {
        ...details, title: draft.name.trim(), description: draft.description,
        slug,
        durationMinutes: draft.minutes, durationOptionsMinutes: [draft.minutes],
        locationType: draft.location.type, locationLabel: draft.location.label, locationValue: draft.location.value,
        locations: [draft.location], hours: draft.uses === "yours" ? { uses: "yours" } : { uses: "own", windows: draft.windows ?? yours },
      } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      const result = await response.json();
      created.current = true;
      try { sessionStorage.removeItem(key); } catch { /* A successful create does not depend on storage. */ }
      hostSetupChanged();
      await navigate({ to: `${workspace}/event-types/$id`, params: { id: result.id } });
    } catch { setError(created.current ? "Your event was created. Open it from Event types." : "Creation could not be checked. Your answers are kept; check Event types before trying again."); }
    finally { busy.current = false; setCreating(false); }
  }
  return <>
    <div inert aria-hidden="true"><EventTypesPage workspace={workspace} creating onRead={setEvents} /></div>
    <div className="dial-new-event-flow"><FocusDialog title={`New event type · step ${draft.step} of 4`} onClose={() => void leave()}>
      <div className="dial-new-event-layout">
        <Card className="dial-new-event-panel p-5 sm:p-7">
          <div className="mb-5 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-soft">New event type · step {draft.step} of 4</p><Tooltip label="Close"><Button type="button" variant="secondary" className="h-11 w-11 !p-0" onClick={() => void leave()}>×</Button></Tooltip></div>
          <h1 className="mb-5 text-[27px] font-[750] tracking-[-.025em]">{questions[draft.step - 1]}</h1>
          <form onSubmit={submit} className="grid gap-5">
            <div ref={fields} data-step-fields className="min-w-0">
              {draft.step === 1 ? <StepName name={draft.name} description={draft.description} onName={name => patch({ name })} onDescription={description => patch({ description })} /> : null}
              {draft.step === 2 ? <StepLength minutes={draft.minutes} onChange={minutes => patch({ minutes })} /> : null}
              {draft.step === 3 ? <StepWhere location={draft.location} onChange={location => patch({ location })} /> : null}
              {draft.step === 4 ? <><StepWhen uses={draft.uses} windows={draft.windows ?? yours ?? []} yours={yours} loading={!yours && !hoursError} error={hoursError} onRetry={() => setRevision(value => value + 1)} onUses={uses => patch({ uses })} onWindows={windows => patch({ windows })} />{timezone ? <p className="mt-3 text-sm text-soft">Times in {timezone.replaceAll("_", " ")}</p> : null}</> : null}
            </div>
            {error ? <p role="alert" className={noticeClassName("error")}>{error}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link className={buttonClassName("quiet")} to={empty ? workspace : `${workspace}/event-types`}>{empty ? "‹ Workspace" : "‹ Event types"}</Link>
              <div className="flex items-center gap-3">{draft.step > 1 ? <Button type="button" variant="quiet" onClick={() => patch({ step: draft.step - 1 })}>Back</Button> : null}<Button type="submit" disabled={!restored || creating || draft.step === 4 && !yours}>{draft.step === 4 ? creating ? "Creating…" : "Create" : "Continue"}</Button></div>
            </div>
          </form>
        </Card>
        <Card className="dial-new-event-preview p-5 sm:p-7">
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-soft">As invitees see it</p>
          <div className="rounded-[18px] bg-gold-wash p-5"><h2 className="break-words text-[23px] font-[750] tracking-[-.02em]">{draft.name || "Your event"}</h2>{draft.description ? <p className="dial-new-event-description mt-3 whitespace-pre-wrap break-words text-[15px] leading-6 text-soft">{draft.description}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><Badge>{draft.minutes} minutes</Badge><Badge>{draft.location.label}</Badge></div></div>
        </Card>
      </div>
    </FocusDialog></div>
  </>;
}
