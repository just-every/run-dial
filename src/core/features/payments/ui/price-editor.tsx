import { useState } from "react";
import { Input } from "../../../app/ui/primitives";
import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { InlineConfirm } from "../../../app/ui/autosave/inline-confirm";
import type { EventPrice } from "../../../shared/event-price";
import { SettingReadState, useSettingRead, writeSetting } from "../../../app/ui/autosave-setting";

const dollars = (cents: number | null) => cents === null ? "" : String(cents / 100);
const cents = (value: string) => value.trim() === "" ? null : Math.round(Number(value) * 100);
type Props = { eventId: string; durations: number[]; initial?: EventPrice; eventTitle?: string; onSaved?(): void };
type PriceDraft = { price: string; perDuration: Record<number, string> };

/** PAY-001: prices ask once, under the changed field; existing bookings keep their price. */
export function PriceEditor(props: Props) {
  const read = useSettingRead<EventPrice>(`/api/app/event-types/${props.eventId}/price`, props.initial);
  return read.value ? <PriceFields {...props} initial={read.value} /> : <SettingReadState error={read.error} retry={read.retry} />;
}
function PriceFields({ eventId, durations, initial, eventTitle = "this event", onSaved }: Props & { initial: EventPrice }) {
  const [savedPrice, setSavedPrice] = useState(initial.amountCents);
  const draft: PriceDraft = { price: dollars(initial.amountCents), perDuration: Object.fromEntries(initial.durationPrices.map(entry => [entry.durationMinutes, dollars(entry.amountCents)])) };
  const save = useAutosave(`event:${eventId}:price`, draft, async (next, init) => {
    const amountCents = cents(next.price);
    const durationPrices = durations.filter(duration => (next.perDuration[duration] ?? "").trim() !== "").map(duration => ({ durationMinutes: duration, amountCents: cents(next.perDuration[duration])! }));
    if ([amountCents, ...durationPrices.map(entry => entry.amountCents)].some(value => value !== null && (!Number.isInteger(value) || value < 50))) throw new Error("Enter at least $0.50, or leave it blank for free.");
    await writeSetting(`/api/app/event-types/${eventId}/price`, { amountCents, durationPrices }, init);
    setSavedPrice(amountCents); onSaved?.();
  }, { asks: ["price", "perDuration"] });
  const amount = save.values.price ? `$${save.values.price}` : "nothing";
  return <div className="event-payment-price grid gap-4" role="group" aria-label="Price">
    <div className="event-payment-price-main grid gap-2"><label className="flex items-center justify-between gap-2 text-sm font-semibold" htmlFor={`price-${eventId}`}>Price (USD)<SavedMark state={save.state("price")} /></label>
      <Input id={`price-${eventId}`} aria-label="Price (USD)" inputMode="decimal" placeholder="Free" value={save.values.price} onChange={event => save.type("price", event.target.value)} onBlur={save.leave} />
      <SaveFailed id={`price-failed-${eventId}`} state={save.state("price")} what="the price" onRetry={save.retry} />
    </div>
    {save.state("price").asking ? <div className="event-payment-price-confirm"><InlineConfirm question={`Charge ${amount} for new bookings of ${eventTitle}?`} detail="Bookings already made keep their price." action={save.values.price ? `Charge ${amount}` : "Make it free"} keep={savedPrice === null ? "Keep it free" : "Keep the price"} onAction={() => save.confirm("price")} onKeep={() => save.keep("price")} /></div> : null}
    {durations.length > 1 ? <div className="event-payment-lengths grid gap-3">{durations.map(duration => <label key={duration} className="grid gap-2 text-sm font-semibold">Price for {duration} minutes (USD)<Input inputMode="decimal" placeholder={save.values.price ? `$${save.values.price}` : "Free"} value={save.values.perDuration[duration] ?? ""} onChange={event => save.type("perDuration", { ...save.values.perDuration, [duration]: event.target.value })} onBlur={save.leave} /></label>)}<SavedMark state={save.state("perDuration")} /><SaveFailed id={`duration-price-failed-${eventId}`} state={save.state("perDuration")} what="duration prices" onRetry={save.retry} />{save.state("perDuration").asking ? <InlineConfirm question={`Use these prices for new bookings of ${eventTitle}?`} detail="Bookings already made keep their price." action="Use these prices" keep="Keep current prices" onAction={() => save.confirm("perDuration")} onKeep={() => save.keep("perDuration")} /> : null}</div> : null}
  </div>;
}
