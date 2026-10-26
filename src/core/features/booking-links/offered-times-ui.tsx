import { useEffect, useRef, useState, type FormEvent } from "react";
import { operatorDateTime, operatorTimeRange } from "../../shared/operator-format";
import { errorMessage } from "../../api/client";
import { Button, Card, Input, Select, Textarea } from "../../app/ui/primitives";
import { useHydrated } from "../../app/use-hydrated";
import type { EventTypeRecord } from "../event-types";
import type { ProfileRecord } from "../host-profile";
import { dateInZone, shiftHostDate, type PickerAvailability, type PickerSlot } from "../public-booking";
import { OfferedTimeChoices } from "./offered-time-choices";

type Host = Pick<ProfileRecord, "handle" | "timezone">;
type CreatedOffer = { url: string; email: string };
const fieldLabel = "grid gap-2 text-sm font-[650] text-ink";

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
    <h2 className="text-[22px] font-bold">Offer specific times</h2>
    <p className="mt-2 text-sm text-soft">Pick up to 12 available times. Your recipient books one, and the other times are released.</p>
    {!eligible.length ? <p className="mt-4 text-sm">Publish an event type with automatic booking to offer times.</p> : <>
      <label className={`${fieldLabel} mt-5`}>Event type<Select value={selectedEvent?.id ?? ""} onChange={event => setEventId(event.target.value)}>
        {eligible.map(event => <option key={event.id} value={event.id}>{event.title} · {event.durationMinutes} min</option>)}
      </Select></label>
      {profileError ? <div className="mt-4"><p role="alert" className="text-sm text-danger">{profileError}</p><Button type="button" variant="quiet" onClick={() => setRetry(value => value + 1)}>Retry profile</Button></div> : !host ? <p role="status" className="mt-4 text-sm text-soft">Loading host timezone…</p> : selectedEvent ? <OfferForm key={`${selectedEvent.id}:${host.handle}:${host.timezone}`} event={selectedEvent} host={host} onCreated={offer => { setCreated(offer); setCopyNotice(""); }} /> : null}
    </>}
    {created ? <div className="mt-6 grid gap-3 border-t border-line pt-5">
      <p role="status" className="font-semibold">Your offered-times link is ready. Copy it before leaving this page.</p>
      <label className={fieldLabel}>Offer link<Input readOnly value={created.url} onFocus={event => event.target.select()} /></label>
      <div><Button type="button" variant="secondary" onClick={() => void copy(created.url)}>Copy offer link</Button></div>
      <label className={fieldLabel}>Email text<Textarea readOnly rows={8} value={created.email} onFocus={event => event.target.select()} /></label>
      <div><Button type="button" variant="secondary" onClick={() => void copy(created.email)}>Copy email text</Button></div>
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
  const [hold, setHold] = useState("held");
  const [holdHours, setHoldHours] = useState("48");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setAvailability(undefined); setAvailabilityError("");
    void (async () => {
      try {
        const path = `/api/public/book/${encodeURIComponent(host.handle)}/${encodeURIComponent(event.slug)}/availability`;
        const response = await fetch(`${path}?${new URLSearchParams({ week })}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(await errorMessage(response));
        const result = await response.json() as PickerAvailability;
        if (result.state !== "available") throw new Error("Calendar availability cannot be checked right now. Refresh times to try again.");
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
    const expiresAt = new Date(expiry);
    const hours = hold === "held" ? Number(holdHours) : 0;
    if (!selected.length || selected.length > 12) { setError("Choose between 1 and 12 available times."); return; }
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) { setError("Choose an expiry date and time in the future."); return; }
    if (hold === "held" && (!Number.isInteger(hours) || hours < 1 || hours > 168)) { setError("Enter a hold between 1 and 168 hours."); return; }
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
      <p className="text-sm text-soft">{event.durationMinutes} minutes · Times shown in {host.timezone}. Availability is checked again when you create the offer and when your recipient books.</p>
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
        <label className={fieldLabel}>Week starting<Input type="date" min={today} value={week} required onChange={entry => { if (entry.target.value) setWeek(entry.target.value); }} /></label>
        <div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" disabled={loading || week <= today} onClick={() => setWeek(shiftHostDate(week, -7) < today ? today : shiftHostDate(week, -7))}>Previous</Button><Button type="button" variant="secondary" disabled={loading} onClick={() => setWeek(shiftHostDate(week, 7))}>Next</Button><Button type="button" variant="quiet" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh times</Button></div>
      </div>
      {loading ? <p role="status" className="text-sm text-soft">Checking live availability…</p> : availabilityError ? <p role="alert" className="text-sm text-danger">{availabilityError}</p> : availability?.state === "available" ? <OfferedTimeChoices slots={availability.slots} timezone={host.timezone} selected={selected} onToggle={toggle} /> : null}
      <div><p role="status" className="text-sm font-semibold">{selected.length} of 12 times selected</p>{selected.length ? <ul className="mt-2 grid gap-1">{selected.map(slot => <li key={slot.startAt} className="flex flex-wrap items-center justify-between gap-x-3 text-sm"><span>{offeredLabel(slot, host.timezone)}</span><Button type="button" variant="quiet" aria-label={`Remove ${offeredLabel(slot, host.timezone)}`} onClick={() => toggle(slot)}>Remove</Button></li>)}</ul> : null}</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={fieldLabel}>Hold selected times<Select value={hold} onChange={entry => setHold(entry.target.value)}><option value="held">Hold for recipient</option><option value="none">No hold</option></Select></label>
        {hold === "held" ? <label className={fieldLabel}>Hold duration (hours)<Input type="number" min={1} max={168} step={1} value={holdHours} required onChange={entry => setHoldHours(entry.target.value)} /></label> : null}
        <label className={fieldLabel}>Link expires (your device timezone)<Input type="datetime-local" value={expiry} required onChange={entry => setExpiry(entry.target.value)} /></label>
      </div>
      <p className="text-sm text-soft">{hold === "held" ? "Held times leave public availability until the hold ends, the link expires, or one time is booked." : "Times stay available to others and may be booked before your recipient chooses."}</p>
      <div><Button disabled={!selected.length || loading || Boolean(availabilityError)}>{saving ? "Creating offer…" : "Create offered-times link"}</Button></div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
  </form>;
}

function offeredLabel(slot: PickerSlot, timezone: string) {
  return operatorTimeRange(slot.startAt, slot.endAt, timezone);
}
