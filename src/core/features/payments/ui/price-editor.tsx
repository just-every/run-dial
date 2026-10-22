import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Input, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { useHydrated } from "../../../app/use-hydrated";
import type { EventPrice } from "../../../shared/event-price";

const dollars = (cents: number | null | undefined) => cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
const cents = (value: string) => value.trim() === "" ? null : Math.round(Number(value) * 100);

/** PAY-001: an event's USD price, or a price for each offered duration (EVENT-011). Blank keeps it free. */
export function PriceEditor({ eventId, durations }: { eventId: string; durations: number[] }) {
  const hydrated = useHydrated(), busy = useRef(false);
  const [price, setPrice] = useState(""), [perDuration, setPerDuration] = useState<Record<number, string>>({});
  const [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const apply = (value: EventPrice) => { setPrice(dollars(value.amountCents)); setPerDuration(Object.fromEntries(value.durationPrices.map(entry => [entry.durationMinutes, dollars(entry.amountCents)]))); };
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await api.api.app["event-types"][":id"].price.$get({ param: { id: eventId } });
        if (!response.ok) throw new Error(await errorMessage(response));
        const value = await response.json() as EventPrice;
        if (active) { apply(value); setLoaded(true); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "The price could not be loaded. Reload to try again."); }
    })();
    return () => { active = false; };
  }, [eventId]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!hydrated || !loaded || busy.current) return;
    const amountCents = cents(price);
    const durationPrices = durations.filter(duration => (perDuration[duration] ?? "").trim() !== "").map(duration => ({ durationMinutes: duration, amountCents: cents(perDuration[duration])! }));
    if ([amountCents, ...durationPrices.map(entry => entry.amountCents)].some(value => value !== null && (!Number.isInteger(value) || value < 50))) { setError("Enter prices of at least $0.50, or leave them blank."); return; }
    busy.current = true; setSaving(true); setError(""); setStatus("");
    try {
      const response = await api.api.app["event-types"][":id"].price.$put({ param: { id: eventId }, json: { amountCents, durationPrices } });
      if (!response.ok) throw new Error(await errorMessage(response));
      const saved = await response.json() as EventPrice;
      apply(saved); setStatus(saved.amountCents === null && !saved.durationPrices.length ? "This event type is free." : "Price saved. Invitees pay through Stripe Checkout before the booking confirms.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The save result could not be received. Reload to check the saved price."); }
    finally { busy.current = false; setSaving(false); }
  }
  return <form className="mt-7" onSubmit={save} aria-label="Price">
    <Card className="p-5 sm:p-6"><SectionHeading icon="notice" title="Price" description="Charge in USD through your connected Stripe account. Leave blank for a free event type." />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-[650] text-ink">Price (USD){durations.length > 1 ? " for every duration" : ""}<Input inputMode="decimal" placeholder="Free" value={price} disabled={!hydrated || !loaded || saving} onChange={event => { setPrice(event.target.value); setStatus(""); }} /></label>
        {durations.length > 1 ? durations.map(duration => <label key={duration} className="grid gap-2 text-sm font-[650] text-ink">Price for {duration} minutes (USD)<Input inputMode="decimal" placeholder={price ? `$${price}` : "Not priced"} value={perDuration[duration] ?? ""} disabled={!hydrated || !loaded || saving} onChange={event => { setPerDuration(current => ({ ...current, [duration]: event.target.value })); setStatus(""); }} /></label>) : null}
      </div>
      <p className="mt-4 text-sm leading-6 text-soft">The chosen duration's price applies; a reschedule keeps the amount already paid. Dial never sees card numbers. Set a deposit and the cancellation policy below, and refund from each booking record.</p>
      {error ? <p role="alert" className={noticeClassName("error", "mt-4")}>{error}</p> : null}
      {status ? <p role="status" className={noticeClassName("success", "mt-4")}>{status}</p> : null}
      <Button className="mt-5" type="submit" disabled={!hydrated || !loaded || saving}>{saving ? "Saving…" : "Save price"}</Button>
    </Card>
  </form>;
}
