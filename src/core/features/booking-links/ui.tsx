import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../api/client";
import { Badge, Button, Card, Input, Select } from "../../app/ui/primitives";
import { useHydrated } from "../../app/use-hydrated";
import { operatorDateTime } from "../../shared/operator-format";
import type { EventTypeRecord } from "../event-types";
import type { BookingLinkInput } from "./types";

type ListedLink = { id: string; eventTypeId: string; kind: string; offeredStarts?: string[]; holdUntil?: string | null; expiresAt: string; state: string };
const fieldLabel = "grid min-w-0 content-start gap-2 text-sm font-[650] text-ink";

export function BookingLinksPanel({ events }: { events: EventTypeRecord[] }) {
  const hydrated = useHydrated(), busy = useRef(false);
  const [links, setLinks] = useState<ListedLink[]>([]), [kind, setKind] = useState<BookingLinkInput["kind"]>("single_use");
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [url, setUrl] = useState("");
  const [listError, setListError] = useState(""), [copyNotice, setCopyNotice] = useState("");
  const [locationType, setLocationType] = useState("fixed_link");
  const deviceTimezone = hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  async function load() {
    const response = await api.api.app["booking-links"].$get();
    if (!response.ok) throw new Error(await errorMessage(response));
    setLinks(await response.json()); setListError("");
  }
  useEffect(() => { void load().catch(() => setListError("Your existing links could not be loaded.")); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const form = new FormData(event.currentTarget), expiry = new Date(String(form.get("expiry")));
    if (!Number.isFinite(expiry.getTime())) { setError("Choose a valid expiry date and time."); return; }
    busy.current = true; setPending(true); setError(""); setCopyNotice("");
    const minute = (value: FormDataEntryValue | null) => { const [hour, minute] = String(value).split(":").map(Number); return hour * 60 + minute; };
    const body: BookingLinkInput = { eventTypeId: String(form.get("eventTypeId")), kind, expiresAt: expiry.toISOString(), ...(kind === "one_off" ? { overrides: { durationMinutes: Number(form.get("duration")), locationType: locationType as "fixed_link", locationLabel: String(form.get("locationLabel")), locationValue: String(form.get("locationValue") ?? ""), dates: [{ hostDate: String(form.get("date")), windows: [{ startMinute: minute(form.get("start")), endMinute: minute(form.get("end")) }] }] } } : {}) };
    try {
      const response = await api.api.app["booking-links"].$post({ json: body });
      if (!response.ok) throw new Error(await errorMessage(response));
      setUrl((await response.json()).url);
      void load().catch(() => setListError("Your existing links could not be loaded."));
    } catch (error) { setError(error instanceof Error ? error.message : "The link could not be created. Check your existing links before trying again."); }
    finally { busy.current = false; setPending(false); }
  }
  async function revoke(id: string) {
    if (busy.current) return; busy.current = true; setPending(true); setError("");
    try { const response = await api.api.app["booking-links"][":id"].revoke.$post({ param: { id } }); if (!response.ok) throw new Error(await errorMessage(response)); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : "The link could not be revoked."); }
    finally { busy.current = false; setPending(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopyNotice("Copied."); }
    catch { setCopyNotice("Select and copy the link from the field above."); }
  }
  const available = events.filter(event => event.status !== "disabled" && !event.requestOnly);
  return <Card className="p-5 sm:p-6">
    {available.length ? <form onSubmit={event => void create(event)} className="grid items-start gap-4 sm:grid-cols-2">
      {available.length > 1 ? <label className={fieldLabel}>Event<Select aria-label="Event" name="eventTypeId">{available.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</Select></label> : <div><p className="font-semibold">{available[0].title}</p><input type="hidden" name="eventTypeId" value={available[0].id} /></div>}
      <label className={fieldLabel}>Kind<Select aria-label="Kind" value={kind} onChange={event => setKind(event.target.value as BookingLinkInput["kind"])}><option value="single_use">Single-use link</option><option value="one_off">One-off meeting</option></Select></label>
      <label className={fieldLabel}>Expires · {deviceTimezone}<Input aria-label="Expires" type="datetime-local" name="expiry" required /></label>
      {kind === "one_off" ? <>
        <label className={fieldLabel}>Length (minutes)<Input type="number" name="duration" min={5} max={480} defaultValue={30} required /></label>
        <label className={fieldLabel}>Meeting date (host time)<Input type="date" name="date" required /></label>
        <div className="grid grid-cols-2 items-start gap-3"><label className={fieldLabel}>From<Input name="start" type="time" required /></label><label className={fieldLabel}>Until<Input name="end" type="time" required /></label></div>
        <label className={fieldLabel}>Where<Select aria-label="Where" value={locationType} onChange={event => setLocationType(event.target.value)}><option value="fixed_link">Meeting link</option><option value="google_meet">Google Meet</option><option value="phone">Host phone</option><option value="in_person">In person</option></Select></label>
        <label className={fieldLabel}>Public label<Input name="locationLabel" required maxLength={180} /></label>
        {locationType !== "google_meet" ? <label className={`${fieldLabel} sm:col-span-2`}>Joining details<Input name="locationValue" required maxLength={1000} /></label> : null}
      </> : null}
      <div className="sm:col-span-2"><Button disabled={!hydrated || pending}>{pending ? "Creating…" : "Create link"}</Button></div>
    </form> : <p className="text-sm">Create an event type first.</p>}
    {url ? <div className="mt-5 grid gap-3"><p role="status" className="font-semibold">Link created</p><label className={fieldLabel}>Private link<Input readOnly value={url} onFocus={event => event.target.select()} /></label><div><Button type="button" variant="secondary" onClick={() => void copy()}>Copy link</Button></div>{copyNotice ? <p role="status" className="text-sm text-soft">{copyNotice}</p> : null}</div> : null}
    {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
    <details className="mt-5"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Existing links</summary>
      {listError ? <div><p role="alert" className="text-sm text-danger">{listError}</p><Button type="button" variant="quiet" onClick={() => void load().catch(() => setListError("Your existing links could not be loaded."))}>Retry links</Button></div> : null}
      <ul className="grid gap-3 pt-3">{links.map(link => <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-wash p-3"><div className="min-w-0"><p className="break-words font-semibold">{events.find(event => event.id === link.eventTypeId)?.title ?? "Meeting"} · {link.offeredStarts ? "Offered times" : link.kind === "one_off" ? "One-off" : "Single-use"}</p><p className="text-sm text-soft">Expires {operatorDateTime(link.expiresAt, deviceTimezone)}</p></div><Badge>{link.state}</Badge>{link.state === "active" ? <Button type="button" variant="quiet" disabled={!hydrated || pending} onClick={() => void revoke(link.id)}>Revoke</Button> : null}</li>)}</ul>
    </details>
  </Card>;
}
