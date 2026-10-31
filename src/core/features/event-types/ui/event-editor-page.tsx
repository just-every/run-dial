import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { PageHeader } from "../../../app/ui/page-header";
import { useHydrated } from "../../../app/use-hydrated";
import { Button, buttonClassName, noticeClassName, PlainLink } from "../../../app/ui/primitives";
import { hostSetupChanged } from "../../host-setup";
import { EventFields } from "./event-fields";
import { RedirectFields } from "./redirect-fields";
import { QuestionsEditor } from "./questions-editor";
import { defaultEventTypeInput } from "../defaults";
import type { EventTypeInput } from "../repository";

/** The legacy creation form remains until the separate New event type round lands. */
export function EventEditorPage({ workspace = "/app" }: { workspace?: "/app" | "/setup"; priceEditor?: (eventId: string, durations: number[]) => ReactNode }) {
  const hydrated = useHydrated();
  const navigate = useNavigate();
  const busy = useRef(false), slugEdited = useRef(false);
  const [event, setEvent] = useState(defaultEventTypeInput);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  function update<K extends keyof EventTypeInput>(key: K, value: EventTypeInput[K]) {
    if (key === "slug") slugEdited.current = true;
    setEvent(current => ({ ...current, [key]: value, ...(key === "title" && !slugEdited.current ? { slug: String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) } : {}) }));
  }
  async function create(entry: React.FormEvent) {
    entry.preventDefault();
    if (!hydrated || busy.current) return;
    busy.current = true; setSaving(true); setError("");
    try {
      const response = await api.api.app["event-types"].$post({ json: event });
      if (!response.ok) throw new Error(await errorMessage(response));
      const saved = await response.json();
      hostSetupChanged();
      await navigate({ to: `${workspace}/event-types/$id/availability`, params: { id: saved.id } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Creation could not be checked. Your details are kept; check the event list before creating another."); }
    finally { busy.current = false; setSaving(false); }
  }
  return <form className="grid gap-7" onSubmit={create}>
    <PageHeader eyebrow="Event type" title={event.title || "New event type"} description="Configure the guest-facing offer and the rules that govern its availability." actions={<><PlainLink to={`${workspace}/event-types`} className={buttonClassName("secondary")}>Back to event types</PlainLink><Button type="submit" disabled={!hydrated || saving}>{saving ? "Saving…" : "Save changes"}</Button></>} />
    {error ? <p role="alert" className={noticeClassName("error")}>{error}</p> : null}
    <fieldset disabled={!hydrated || saving} className="grid gap-6 border-0 p-0"><EventFields event={event} update={update} /><QuestionsEditor questions={event.questions} onChange={questions => {
      if (event.postBookingRedirect) update("postBookingRedirect", { ...event.postBookingRedirect, fields: event.postBookingRedirect.fields.filter(field => !field.startsWith("answer.") || questions.some(question => question.key === field.slice(7) && !question.private)) });
      update("questions", questions);
    }} /><RedirectFields value={event.postBookingRedirect} questions={event.questions} onChange={value => update("postBookingRedirect", value)} /></fieldset>
  </form>;
}
