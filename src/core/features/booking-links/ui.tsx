import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../api/client";
import { Badge, Button, Card, Input, Select } from "../../app/ui/primitives";
import { useHydrated } from "../../app/use-hydrated";
import type { EventTypeRecord } from "../event-types";
import type { BookingLinkInput } from "./types";
type ListedLink = { id:string; eventTypeId:string; kind:string; expiresAt:string; state:string };

export function BookingLinksPanel({ events }: {events:EventTypeRecord[]}) {
  const hydrated = useHydrated(), busy = useRef(false);
  const [links,setLinks] = useState<ListedLink[]>([]), [kind,setKind] = useState<BookingLinkInput["kind"]>("single_use");
  const [pending,setPending] = useState(false), [error,setError] = useState(""), [url,setUrl] = useState("");
  const [locationType,setLocationType] = useState("fixed_link");
  async function load() {
    const response = await api.api.app["booking-links"].$get();
    if (!response.ok) throw new Error(await errorMessage(response));
    setLinks(await response.json());
  }
  useEffect(() => { void load().catch(error => setError(error.message)); },[]);
  async function create(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return;
    const form = new FormData(event.currentTarget), expiry = new Date(String(form.get("expiry")));
    if (!Number.isFinite(expiry.getTime())) { setError("Choose a valid expiry date and time."); return; }
    busy.current=true; setPending(true); setError(""); setUrl("");
    const minute = (value:FormDataEntryValue|null) => { const [hour,minute] = String(value).split(":").map(Number); return hour*60+minute; };
    const body:BookingLinkInput = { eventTypeId:String(form.get("eventTypeId")),kind,expiresAt:expiry.toISOString(), ...(kind === "one_off" ? { overrides:{ durationMinutes:Number(form.get("duration")), locationType:locationType as "fixed_link",locationLabel:String(form.get("locationLabel")),locationValue:String(form.get("locationValue") ?? ""),dates:[{hostDate:String(form.get("date")),windows:[{startMinute:minute(form.get("start")),endMinute:minute(form.get("end"))}]}] } } : {}) };
    try {
      const response = await api.api.app["booking-links"].$post({json:body});
      if (!response.ok) throw new Error(await errorMessage(response));
      setUrl((await response.json()).url); await load();
    } catch(error) { setError(error instanceof Error ? error.message : "The link could not be created. Reload the list before trying again."); }
    finally { busy.current=false; setPending(false); }
  }
  async function revoke(id:string) {
    if (busy.current) return; busy.current=true; setPending(true); setError("");
    try { const response=await api.api.app["booking-links"][":id"].revoke.$post({param:{id}}); if(!response.ok) throw new Error(await errorMessage(response)); await load(); }
    catch(error) { setError(error instanceof Error ? error.message : "The link could not be revoked."); }
    finally { busy.current=false; setPending(false); }
  }
  const available = events.filter(event=>event.status!=="disabled" && !event.requestOnly);
  return <Card className="p-5 sm:p-6"><h2 className="text-[22px] font-bold">Private booking links</h2><p className="mt-2 text-sm text-soft">Each link accepts one booking. One-off meetings use their own duration, location and hours without publishing another event type.</p>
    {available.length ? <form onSubmit={event=>void create(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
      <label>Event type<Select name="eventTypeId">{available.map(event=><option key={event.id} value={event.id}>{event.title}</option>)}</Select></label>
      <label>Link type<Select value={kind} onChange={event=>setKind(event.target.value as BookingLinkInput["kind"])}><option value="single_use">Single-use event link</option><option value="one_off">One-off meeting</option></Select></label>
      <label>Expires at (your device timezone)<Input type="datetime-local" name="expiry" required /></label>
      {kind === "one_off" ? <><label>Duration (minutes)<Input type="number" name="duration" min={5} max={480} defaultValue={30} required /></label>
        <label>Meeting date (host timezone)<Input type="date" name="date" required /></label><div className="grid grid-cols-2 gap-3"><label>From<Input name="start" type="time" required /></label><label>Until<Input name="end" type="time" required /></label></div>
        <label>Location<Select value={locationType} onChange={event=>setLocationType(event.target.value)}><option value="fixed_link">Meeting link</option><option value="google_meet">Google Meet</option><option value="phone">Host phone</option><option value="in_person">In person</option></Select></label>
        <label>Public location label<Input name="locationLabel" required maxLength={180} /></label>
        {locationType!=="google_meet" ? <label className="sm:col-span-2">Private joining details<Input name="locationValue" required maxLength={1000} /></label> : null}</> : null}
      <div className="sm:col-span-2"><Button disabled={!hydrated || pending}>{pending ? "Saving…" : "Create private link"}</Button></div>
    </form> : <p className="mt-4 text-sm">Create an event type first.</p>}
    {url ? <div className="mt-4 grid gap-2" role="status"><label>Copy this private link now. It is shown once.<Input readOnly value={url} onFocus={event=>event.target.select()} /></label><Button type="button" variant="secondary" onClick={()=>void navigator.clipboard.writeText(url).catch(()=>setError("Select and copy the link from the field above."))}>Copy link</Button></div> : null}
    {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
    <ul className="mt-6 grid gap-3">{links.map(link=><li key={link.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"><div><p className="font-semibold">{events.find(event=>event.id===link.eventTypeId)?.title ?? "Meeting"} · {link.kind === "one_off" ? "One-off" : "Single-use"}</p><p className="text-sm text-soft">Expires {link.expiresAt.replace("T"," ").replace(".000Z"," UTC")}</p></div><Badge>{link.state}</Badge>{link.state === "active" ? <Button type="button" variant="quiet" disabled={!hydrated || pending} onClick={()=>void revoke(link.id)}>Revoke</Button> : null}</li>)}</ul>
  </Card>;
}
