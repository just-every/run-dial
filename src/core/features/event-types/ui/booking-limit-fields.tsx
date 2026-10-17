import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { SectionHeading } from "../../../app/ui/page-header";
import { Button, Card, Input, Select } from "../../../app/ui/primitives";
import { useHydrated } from "../../../app/use-hydrated";
import type { BookingLimitsConfig } from "../../availability";

const periods = [["day", "Day"], ["week", "Week"], ["month", "Month"]] as const;
export function BookingLimitFields({ eventId }: { eventId: string }) {
  const hydrated = useHydrated();
  const [scope, setScope] = useState(eventId);
  const [limits, setLimits] = useState<BookingLimitsConfig>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    setLimits(undefined); setError(""); setSaved(false);
    void api.api.app["booking-limits"][":scope"].$get({ param: { scope } }).then(async response => {
      if (!response.ok) throw new Error(await errorMessage(response));
      const value = await response.json(); if (active) setLimits(value);
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Booking limits could not be loaded."); });
    return () => { active = false; };
  }, [scope]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!limits || busy) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await api.api.app["booking-limits"][":scope"].$put({ param: { scope }, json: limits });
      if (!response.ok) throw new Error(await errorMessage(response));
      setLimits(await response.json()); setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Booking limits could not be saved."); }
    finally { setBusy(false); }
  }
  return <Card className="p-5 sm:p-6"><form onSubmit={event => void save(event)} className="grid gap-5">
    <SectionHeading icon="clock" title="Booking limits" description="Protect your workload by counting confirmed bookings and their meeting minutes. Each booking counts in the period where it starts. Days, Monday–Sunday weeks and calendar months use your host timezone. Blank means no cap; zero closes that period." />
    <label className="grid gap-2 text-sm font-semibold">Apply limits to<Select aria-label="Booking limit scope" value={scope} disabled={!hydrated || busy} onChange={event => setScope(event.target.value)}><option value={eventId}>This event type</option><option value="host">All my event types together</option></Select></label>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {saved ? <p role="status" className="text-sm">Booking limits saved. Future offers use these limits immediately.</p> : null}
    {limits ? <fieldset disabled={!hydrated || busy} className="grid gap-4 border-0 p-0">
      <div className="grid gap-3 sm:grid-cols-3">{periods.map(([period, label]) => <div key={period} className="grid gap-3 rounded-2xl bg-row p-4"><h3 className="font-bold">{label}</h3>{(["Count", "Minutes"] as const).map(kind => {
        const key = `${period}${kind}` as keyof Omit<BookingLimitsConfig, "inviteeGapMinutes">;
        return <label key={kind} className="grid gap-2 text-sm">{kind === "Count" ? "Maximum bookings" : "Maximum meeting minutes"}<Input aria-label={`${label} ${kind === "Count" ? "booking cap" : "minute cap"}`} type="number" min="0" step="1" value={limits[key] ?? ""} onChange={event => { setLimits({ ...limits, [key]: event.target.value === "" ? null : Number(event.target.value) }); setSaved(false); }} /></label>;
      })}</div>)}</div>
      <label className="grid gap-2 text-sm">Minimum gap for the same invitee (minutes)<Input type="number" min="0" step="1" value={limits.inviteeGapMinutes} onChange={event => { setLimits({ ...limits, inviteeGapMinutes: Number(event.target.value) }); setSaved(false); }} /></label>
      <p className="text-sm text-muted">The invitee gap is checked when their email is supplied. Host limits apply across every offer; this event’s limits add to them. Existing bookings stay unchanged.</p>
      <div><Button type="submit">{busy ? "Saving…" : "Save booking limits"}</Button></div>
    </fieldset> : !error ? <p role="status" className="text-sm">Loading booking limits…</p> : null}
  </form></Card>;
}
