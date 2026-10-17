import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { useHydrated } from "../../../app/use-hydrated";
import { defaultEventBookingPolicy, eventBookingPolicySchema, type EventBookingPolicy } from "../../../shared/booking-policy";
import { LockedZoneFields } from "./locked-zone-fields";
import { ChangePolicyFields } from "./change-policy-fields";

export function BookingPolicyEditor({ eventId, hostTimezone, onSaved }: { eventId: string; hostTimezone: string; onSaved(): void }) {
  const hydrated = useHydrated();
  const [value, setValue] = useState<EventBookingPolicy>({ ...defaultEventBookingPolicy });
  const [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await api.api.app["event-types"][":id"]["booking-policy"].$get({ param: { id: eventId } });
        if (!response.ok) throw new Error(await errorMessage(response));
        const policy = await response.json();
        if (active) { setValue(policy); setLoaded(true); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Booking controls could not be loaded. Reload to try again."); }
    })();
    return () => { active = false; };
  }, [eventId]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!hydrated || !loaded || busy.current) return;
    const parsed = eventBookingPolicySchema.safeParse(value);
    if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(" ")); return; }
    busy.current = true; setSaving(true); setError(""); setStatus("");
    try {
      const response = await api.api.app["event-types"][":id"]["booking-policy"].$put({ param: { id: eventId }, json: parsed.data });
      if (!response.ok) throw new Error(await errorMessage(response));
      setValue(await response.json()); setStatus("Booking controls saved."); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The save result could not be received. Your settings are kept here; reload to check the saved controls."); }
    finally { busy.current = false; setSaving(false); }
  }
  return <form className="mt-7 grid gap-5" onSubmit={save} aria-label="Booking controls">
    <Card className="p-5 sm:p-6"><SectionHeading icon="clock" title="Meeting timezone" description="Keep an in-person meeting’s location time clear for travelling invitees." /><div className="mt-5"><LockedZoneFields value={value.lockedTimezone} hostTimezone={hostTimezone} disabled={!hydrated || !loaded || saving} onChange={lockedTimezone => { setValue(current => ({ ...current, lockedTimezone })); setStatus(""); }} /></div></Card>
    <ChangePolicyFields value={value} disabled={!hydrated || !loaded || saving} onChange={policy => { setValue(current => ({ ...current, ...policy })); setStatus(""); }} />
    {error ? <p role="alert" className={noticeClassName("error")}>{error}</p> : null}
    {status ? <p role="status" className={noticeClassName("success")}>{status}</p> : null}
    <div><Button type="submit" disabled={!hydrated || !loaded || saving}>{saving ? "Saving…" : "Save booking controls"}</Button></div>
  </form>;
}
