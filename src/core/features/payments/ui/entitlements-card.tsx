import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Select, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { formatUsd } from "../../../shared/event-price";
import { AppointmentProductEditor } from "./appointment-product-editor";
import { EntitlementSummary, creditLabel, type AppointmentCredit, type AppointmentProduct } from "./entitlement-summary";

type EventChoice = { id: string; title: string; status: string };
type HostCredit = AppointmentCredit & { email: string };
export function EntitlementsCard({ timezone }: { timezone: string | null }) {
  const [events, setEvents] = useState<EventChoice[]>([]), [eventId, setEventId] = useState("");
  const [products, setProducts] = useState<AppointmentProduct[]>([]), [credits, setCredits] = useState<HostCredit[]>([]);
  const [error, setError] = useState(""), [loaded, setLoaded] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [eventResponse, creditResponse] = await Promise.all([api.api.app["event-types"].$get(), api.api.app.payments.entitlements.$get()]);
        if (!eventResponse.ok) throw new Error(await errorMessage(eventResponse));
        if (!creditResponse.ok) throw new Error(await errorMessage(creditResponse));
        const nextEvents = await eventResponse.json() as EventChoice[], nextCredits = await creditResponse.json() as HostCredit[];
        if (!active) return;
        setEvents(nextEvents); setCredits(nextCredits); setLoaded(true); setError("");
        setEventId(current => nextEvents.some(event => event.id === current) ? current : nextEvents[0]?.id ?? "");
      } catch { if (active) setError("Appointment credit could not be loaded. Retry to view current balances."); }
    })();
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    let active = true; setProducts([]);
    if (eventId) void api.api.app["event-types"][":id"].products.$get({ param: { id: eventId } }).then(async response => {
      if (!response.ok) throw new Error(await errorMessage(response));
      const rows = await response.json() as AppointmentProduct[];
      if (active) setProducts(rows);
    }).catch(() => { if (active) setError("Appointment products could not be loaded. Retry to view them."); });
    return () => { active = false; };
  }, [eventId, revision]);
  return <Card id="appointment-credits" className="min-w-0 p-5 sm:p-6 xl:col-span-2"><SectionHeading icon="calendar" title="Packages, memberships and credits" description="Sell appointment credit through Stripe and issue coupons for a specific event." action={<Button variant="secondary" onClick={() => setRevision(current => current + 1)}>Refresh balances</Button>} />
    {error ? <p role="alert" className={noticeClassName("error", "mt-3")}>{error}</p> : null}
    {!loaded && !error ? <p className="mt-4 text-sm" role="status">Loading appointment credits…</p> : null}
    {events.length ? <details className="mt-5 rounded-2xl bg-row p-4"><summary className="cursor-pointer text-[15px] font-semibold">Configure products and issue coupons</summary><label className="mt-4 grid gap-2 text-sm font-semibold">Event type<Select aria-label="Credit event type" value={eventId} onChange={event => setEventId(event.target.value)}>{events.map(event => <option key={event.id} value={event.id}>{event.title}{event.status === "published" ? "" : " (not published)"}</option>)}</Select></label>
      {eventId ? <AppointmentProductEditor key={eventId} eventId={eventId} onSaved={() => setRevision(current => current + 1)} /> : null}
      {products.length ? <ul aria-label="Appointment product catalog" className="mt-5 grid gap-2">{products.map(product => <li className="rounded-xl bg-card p-3 text-sm leading-6" key={product.id}><strong>{product.name}</strong><p>{creditLabel(product.kind)} · {formatUsd(product.amountCents)}{product.kind === "membership" ? " monthly" : ""}{product.kind !== "gift" ? ` · ${product.sessions} sessions` : ""}</p><p>{product.kind === "membership" ? "Balance renews with each paid period" : `Valid for ${product.validityDays} days`}</p></li>)}</ul> : null}
    </details> : loaded ? <p className="mt-4 text-sm text-soft">Create an event type before offering appointment credit.</p> : null}
    <h3 className="mt-6 text-[17px] font-semibold">Balances and redemption history</h3>
    {credits.length ? <ul aria-label="Appointment credit balances" className="mt-3 grid gap-3">{credits.map(credit => <li className="min-w-0 rounded-2xl bg-row p-4" key={credit.id}><p className="mb-2 break-words text-sm text-soft">{credit.email} · {events.find(event => event.id === credit.eventTypeId)?.title ?? "Appointment credit"}</p><EntitlementSummary credit={credit} timezone={timezone ?? "UTC"} host /></li>)}</ul> : loaded ? <p className="mt-3 text-sm text-soft">No purchased credit or issued coupons yet.</p> : null}
  </Card>;
}
