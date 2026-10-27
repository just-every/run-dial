import { useEffect, useRef, useState, type FormEvent } from "react";
import { operatorDateTime, operatorTimeRange } from "../../shared/operator-format";
import { errorMessage } from "../../api/client";
import { Button, Card, Input, Select, Textarea } from "../../app/ui/primitives";
import { Tooltip } from "../../app/ui/tooltip";
import { useHydrated } from "../../app/use-hydrated";
import type { EventTypeRecord } from "../event-types";
import type { ProfileRecord } from "../host-profile";
import { dateInZone, shiftHostDate, type PickerAvailability, type PickerSlot } from "../public-booking";
import { OfferedTimeChoices } from "./offered-time-choices";

type Host = Pick<ProfileRecord, "handle" | "timezone">;
type CreatedOffer = { url: string; email: string };
const fieldLabel = "grid min-w-0 content-start gap-2 text-sm font-[650] text-ink";

export function OfferedTimesPanel({ events }: { events: EventTypeRecord[] }) {
  const [host, setHost] = useState<Host>();
  const [profileError, setProfileError] = useState("");
  const [retry, setRetry] = useState(0);
  const [eventId, setEventId] = useState("");
  const [created, setCreated] = useState<CreatedOffer>();
  const [copyNotice, setCopyNotice] = useState("");
  const eligible = events.filter(event => event.status === "published" && !event.requestOnly);
  const selectedEvent = eligible.find(event => event.id === eventId) ?? eligible[0];

  useEffect(() => {
    const controller = new AbortController();
    setProfileError("");
    void (async () => {
      try {
        const response = await fetch("/api/app/profile", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(await errorMessage(response));
        const profile = await response.json() as Host | null;
        if (!profile?.handle || !profile.timezone) throw new Error("Complete your host profile before offering times.");
        if (!controller.signal.aborted) setHost(profile);
      } catch (error) {
        if (!controller.signal.aborted) setProfileError(error instanceof Error ? error.message : "The host profile could not be loaded.");
      }
    })();
    return () => controller.abort();
  }, [retry]);

  async function copy(text: string) {
    setCopyNotice("");
    try { await navigator.clipboard.writeText(text); setCopyNotice("Copied."); }
    catch { setCopyNotice("Select and copy the text from the field."); }
  }

  return <Card className="p-5 sm:p-6">
    {!eligible.length ? <p className="text-sm">Publish an event type with automatic booking to offer times.</p> : <>
      {eligible.length > 1 ? <label className={fieldLabel}>Event<Select aria-label="Event" value={selectedEvent?.id ?? ""} onChange={event => setEventId(event.target.value)}>
        {eligible.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}
      </Select></label> : <p className="font-semibold">{selectedEvent?.title}</p>}
      {profileError ? <div className="mt-4"><p role="alert" className="text-sm text-danger">{profileError}</p><Button type="button" variant="quiet" onClick={() => setRetry(value => value + 1)}>Retry profile</Button></div> : !host ? <p role="status" className="mt-4 text-sm text-soft">Checking your hours…</p> : selectedEvent ? <OfferForm event={selectedEvent} host={host} onCreated={offer => { setCreated(offer); setCopyNotice(""); }} /> : null}
    </>}
    {created ? <div className="mt-6 grid gap-3">
      <p role="status" className="font-semibold">Link created</p>
      <label className={fieldLabel}>Offer link<Input readOnly value={created.url} onFocus={event => event.target.select()} /></label>
      <div><Button type="button" variant="secondary" onClick={() => void copy(created.url)}>Copy link</Button></div>
      <details><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Email text</summary>
        <div className="grid gap-3 pt-2"><label className={fieldLabel}>Text to send<Textarea readOnly rows={8} value={created.email} onFocus={event => event.target.select()} /></label>
          <div><Button type="button" variant="secondary" onClick={() => void copy(created.email)}>Copy email text</Button></div></div>
      </details>
      {copyNotice ? <p role="status" className="text-sm text-soft">{copyNotice}</p> : null}
    </div> : null}
  </Card>;
}

function OfferForm({ event, host, onCreated }: { event: EventTypeRecord; host: Host; onCreated(offer: CreatedOffer): void }) {
  const hydrated = useHydrated();
  const busy = useRef(false);
  const today = dateInZone(new Date().toISOString(), host.timezone);
  const [week, setWeek] = useState(today);
  const [refresh, setRefresh] = useState(0);
  const [availability, setAvailability] = useState<PickerAvailability>();
  const [loading, setLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState("");
  const [selected, setSelected] = useState<PickerSlot[]>([]);
  const [holdHours, setHoldHours] = useState("48");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setSelected([]); }, [event.id]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setAvailabilityError("");
    void (async () => {
      try {
        const path = `/api/public/book/${encodeURIComponent(host.handle)}/${encodeURIComponent(event.slug)}/availability`;
        const response = await fetch(`${path}?${new URLSearchParams({ week })}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(await errorMessage(response));
        const result = await response.json() as PickerAvailability;
        if (result.state !== "available") throw new Error("Calendar availability cannot be checked right now.");
        if (!controller.signal.aborted) setAvailability(result);
      } catch (error) {
        if (!controller.signal.aborted) setAvailabilityError(error instanceof Error ? error.message : "Available times could not be loaded.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [event.slug, host.handle, week, refresh]);

  function toggle(slot: PickerSlot) {
    setError("");
    setSelected(current => current.some(item => item.startAt === slot.startAt)
      ? current.filter(item => item.startAt !== slot.startAt)
      : current.length < 12 ? [...current, slot].sort((a, b) => a.startAt.localeCompare(b.startAt)) : current);
  }

  async function create(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy.current) return;
    const expiresAt = new Date(expiry), hours = Number(holdHours);
    if (!selected.length || selected.length > 12) { setError("Choose between 1 and 12 available times."); return; }
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) { setError("Choose an expiry date and time in the future."); return; }
    if (!Number.isInteger(hours) || hours < 0 || hours > 168) { setError("Choose no hold or a hold up to 168 hours."); return; }
    busy.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/app/booking-links", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "single_use", eventTypeId: event.id, expiresAt: expiresAt.toISOString(), offeredStarts: selected.map(slot => slot.startAt), holdHours: hours }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = await response.json() as { id: string; url: string };
      if (!result.id || !result.url) throw new Error("The server did not return the created offer link. Check your booking links before creating another.");
      const email = [`Choose a time for ${event.title} (${event.durationMinutes} minutes).`, `All times are in ${host.timezone}.`, "",
        ...selected.map(slot => `${offeredLabel(slot, host.timezone)} — ${result.url}`), "",
        `Choose one time using the link above. The link expires ${operatorDateTime(expiresAt.toISOString(), host.timezone)}.`,
      ].join("\n");
      onCreated({ url: result.url, email });
      setSelected([]); setRefresh(value => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Creation could not be checked. Review your booking links before trying again.");
    } finally { busy.current = false; setSaving(false); }
  }

  return <form className="mt-4 grid gap-4" onSubmit={formEvent => void create(formEvent)}>
    <fieldset disabled={!hydrated || saving} className="grid min-w-0 gap-4 border-0 p-0">
      <p className="text-sm text-soft">Times in {host.timezone} · {event.durationMinutes} minutes</p>
      <div className="flex items-end gap-2" data-offer-week-header>
        <Tooltip label="Previous week"><Button type="button" variant="secondary" className="min-w-11 shrink-0 px-0" disabled={week <= today} onClick={() => setWeek(shiftHostDate(week, -7) < today ? today : shiftHostDate(week, -7))}>‹</Button></Tooltip>
        <label className={`${fieldLabel} min-w-0 flex-1`}>Week starting<Input type="date" min={today} value={week} required onChange={entry => { if (entry.target.value) setWeek(entry.target.value); }} /></label>
        <Tooltip label="Next week"><Button type="button" variant="secondary" className="min-w-11 shrink-0 px-0" onClick={() => setWeek(shiftHostDate(week, 7))}>›</Button></Tooltip>
      </div>
      <div aria-busy={loading}>
        <div className="flex min-h-6 items-center justify-between gap-3 text-sm text-soft">
          <span role="status">{loading ? "Updating times…" : `${selected.length} of 12 times selected`}</span>
          {availabilityError ? <Button type="button" variant="quiet" onClick={() => setRefresh(value => value + 1)}>Retry times</Button> : null}
        </div>
        {availabilityError ? <p role="alert" className="my-2 text-sm text-danger">{availabilityError}</p> : null}
        <fieldset disabled={loading || Boolean(availabilityError)} className="min-w-0 border-0 p-0">
          <OfferedTimeChoices pending={loading} slots={availability?.state === "available" ? availability.slots : []} timezone={host.timezone} selected={selected} onToggle={toggle} />
        </fieldset>
      </div>
      {selected.length ? <ul className="grid gap-1">{selected.map(slot => <li key={slot.startAt} className="flex flex-wrap items-center justify-between gap-x-3 text-sm"><span>{offeredLabel(slot, host.timezone)}</span><Button type="button" variant="quiet" aria-label={`Remove ${offeredLabel(slot, host.timezone)}`} onClick={() => toggle(slot)}>Remove</Button></li>)}</ul> : null}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <label className={fieldLabel}>Hold<Select aria-label="Hold" value={holdHours} onChange={entry => setHoldHours(entry.target.value)}><option value="0">No hold</option>{Array.from({ length: 168 }, (_, index) => index + 1).map(hours => <option key={hours} value={hours}>{hours} {hours === 1 ? "hour" : "hours"}</option>)}</Select></label>
        <label className={fieldLabel}>Link expires (device time)<Input aria-label="Link expires" type="datetime-local" value={expiry} required onChange={entry => setExpiry(entry.target.value)} /></label>
      </div>
      <div><Button disabled={!selected.length || loading || Boolean(availabilityError)}>{saving ? "Creating…" : "Create link"}</Button></div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
  </form>;
}

function offeredLabel(slot: PickerSlot, timezone: string) {
  return operatorTimeRange(slot.startAt, slot.endAt, timezone);
}
