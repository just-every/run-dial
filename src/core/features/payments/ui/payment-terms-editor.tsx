import { Input, Select } from "../../../app/ui/primitives";
import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { InlineConfirm } from "../../../app/ui/autosave/inline-confirm";
import type { PaymentTerms } from "../../../shared/payment-terms";
import { SettingReadState, useSettingRead, writeSetting } from "../../../app/ui/autosave-setting";

type Draft = { deposit: { kind: PaymentTerms["deposit"]["kind"]; amount: string }; balanceDueHours: string; freeWindowHours: string; lateFee: string; noShowFee: string };
type Props = { eventId: string; initial?: PaymentTerms; onSaved?(): void };
const money = (value: string) => value === "" ? 0 : Math.round(Number(value) * 100);
export function PaymentTermsEditor(props: Props) {
  const read = useSettingRead<PaymentTerms>(`/api/app/event-types/${props.eventId}/payment-terms`, props.initial);
  return read.value ? <TermsFields {...props} initial={read.value} /> : <SettingReadState error={read.error} retry={read.retry} />;
}
function TermsFields({ eventId, initial, onSaved }: Props & { initial: PaymentTerms }) {
  const draft: Draft = { deposit: { kind: initial.deposit.kind, amount: initial.deposit.kind === "fixed" ? String(initial.deposit.amountCents / 100) : initial.deposit.kind === "percent" ? String(initial.deposit.percent) : "" }, balanceDueHours: String(initial.balanceDueHours), freeWindowHours: initial.freeWindowHours === null ? "" : String(initial.freeWindowHours), lateFee: initial.lateCancelFeeCents ? String(initial.lateCancelFeeCents / 100) : "", noShowFee: initial.noShowFeeCents ? String(initial.noShowFeeCents / 100) : "" };
  const save = useAutosave(`event:${eventId}:payment-terms`, draft, async (next, init) => {
    const deposit = next.deposit.kind === "fixed" ? { kind: "fixed", amountCents: money(next.deposit.amount) } : next.deposit.kind === "percent" ? { kind: "percent", percent: Number(next.deposit.amount) } : { kind: "none" };
    await writeSetting(`/api/app/event-types/${eventId}/payment-terms`, { deposit, balanceDueHours: Number(next.balanceDueHours), freeWindowHours: next.freeWindowHours === "" ? null : Number(next.freeWindowHours), lateCancelFeeCents: money(next.lateFee), noShowFeeCents: money(next.noShowFee) }, init);
    onSaved?.();
  }, { asks: ["deposit", "lateFee", "noShowFee"] });
  function confirm(field: "deposit" | "lateFee" | "noShowFee") {
    return save.state(field).asking ? <InlineConfirm question={field === "deposit" ? "Use this deposit for new bookings?" : `Charge this ${field === "lateFee" ? "late cancellation" : "no-show"} fee for new bookings?`} detail="Bookings already made keep their terms." action={field === "deposit" ? "Use this deposit" : "Use this fee"} keep="Keep current terms" onAction={() => save.confirm(field)} onKeep={() => save.keep(field)} /> : null;
  }
  function number(field: "balanceDueHours" | "lateFee" | "noShowFee", label: string) {
    return <div className={`grid gap-2 ${field === "balanceDueHours" ? "event-payment-balance" : ""}`}><label className="flex items-center justify-between gap-2 text-sm font-semibold" htmlFor={`${eventId}-${field}`}>{label}<SavedMark state={save.state(field)} /></label><Input id={`${eventId}-${field}`} aria-label={label} inputMode={field === "balanceDueHours" ? "numeric" : "decimal"} value={save.values[field]} onChange={event => save.type(field, event.target.value)} onBlur={save.leave} placeholder={field === "balanceDueHours" ? "24" : "None"} /><SaveFailed id={`${eventId}-${field}-failed`} state={save.state(field)} what={label.toLowerCase()} onRetry={save.retry} />{field !== "balanceDueHours" ? confirm(field) : null}</div>;
  }
  return <div className="event-payment-terms" role="group" aria-label="Deposits and cancellation policy">
    <div className="event-payment-deposit grid gap-2"><label className="flex items-center justify-between gap-2 text-sm font-semibold" htmlFor={`${eventId}-deposit`}>Deposit<SavedMark state={save.state("deposit")} /></label><Select id={`${eventId}-deposit`} aria-label="Deposit" value={save.values.deposit.kind} onChange={event => save.choose("deposit", { kind: event.target.value as Draft["deposit"]["kind"], amount: "" })}><option value="none">No deposit: full price at booking</option><option value="fixed">Fixed amount (USD)</option><option value="percent">Percentage of price</option></Select>
      {save.values.deposit.kind !== "none" ? <label className="grid gap-2 text-sm font-semibold">{save.values.deposit.kind === "fixed" ? "Deposit (USD)" : "Deposit (%)"}<Input inputMode="decimal" value={save.values.deposit.amount} onChange={event => save.type("deposit", { ...save.values.deposit, amount: event.target.value })} onBlur={save.leave} /></label> : null}
      <SaveFailed id={`${eventId}-deposit-failed`} state={save.state("deposit")} what="the deposit" onRetry={save.retry} />{confirm("deposit")}
    </div>
    {save.values.deposit.kind !== "none" ? number("balanceDueHours", "Balance due (hours before the start)") : null}
    <label className="event-payment-window grid gap-2 text-sm font-semibold"><span className="flex items-center justify-between gap-2">Free cancellation until<SavedMark state={save.state("freeWindowHours")} /></span><Select aria-label="Free cancellation until" value={save.values.freeWindowHours} onChange={event => save.choose("freeWindowHours", event.target.value)}><option value="">No limit</option>{[0, 1, 2, 6, 12, 24, 48, 72, 168].map(hours => <option key={hours} value={hours}>{hours === 0 ? "The start" : `${hours} hours before`}</option>)}{save.values.freeWindowHours !== "" && ![0, 1, 2, 6, 12, 24, 48, 72, 168].includes(Number(save.values.freeWindowHours)) ? <option value={save.values.freeWindowHours}>{save.values.freeWindowHours} hours before</option> : null}</Select><SaveFailed id={`${eventId}-window-failed`} state={save.state("freeWindowHours")} what="the free cancellation window" choice onRetry={save.retry} /></label>
    <div className="event-payment-fees">{number("lateFee", "Late-cancellation fee (USD)")}{number("noShowFee", "No-show fee (USD)")}</div>
  </div>;
}
