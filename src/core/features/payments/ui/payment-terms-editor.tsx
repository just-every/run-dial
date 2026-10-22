import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Input, Select, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { useHydrated } from "../../../app/use-hydrated";
import type { PaymentTerms } from "../../../shared/payment-terms";

const dollars = (cents: number) => cents ? (cents / 100).toFixed(2) : "";
const cents = (value: string) => value.trim() === "" ? 0 : Math.round(Number(value) * 100);
const whole = (value: string) => value.trim() === "" ? null : Number(value);
const label = "grid gap-2 text-sm font-[650] text-ink";
type Draft = { depositKind: PaymentTerms["deposit"]["kind"]; deposit: string; balanceDueHours: string; freeWindowHours: string; lateFee: string; noShowFee: string };

function draftOf(terms: PaymentTerms): Draft {
  return {
    depositKind: terms.deposit.kind,
    deposit: terms.deposit.kind === "fixed" ? dollars(terms.deposit.amountCents) : terms.deposit.kind === "percent" ? String(terms.deposit.percent) : "",
    balanceDueHours: String(terms.balanceDueHours), freeWindowHours: terms.freeWindowHours === null ? "" : String(terms.freeWindowHours),
    lateFee: dollars(terms.lateCancelFeeCents), noShowFee: dollars(terms.noShowFeeCents),
  };
}

/** PAY-003: a deposit instead of the full price, when the balance is due, and the cancellation policy with its
 * late-cancellation and no-show fees. Invitees see these before they book. */
export function PaymentTermsEditor({ eventId }: { eventId: string }) {
  const hydrated = useHydrated(), busy = useRef(false);
  const [draft, setDraft] = useState<Draft>(), [saving, setSaving] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await api.api.app["event-types"][":id"]["payment-terms"].$get({ param: { id: eventId } });
        if (!response.ok) throw new Error(await errorMessage(response));
        const terms = await response.json() as PaymentTerms;
        if (active) setDraft(draftOf(terms));
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "The payment terms could not be loaded. Reload to try again."); }
    })();
    return () => { active = false; };
  }, [eventId]);
  const change = (patch: Partial<Draft>) => { setDraft(current => current && { ...current, ...patch }); setStatus(""); };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!hydrated || !draft || busy.current) return;
    const deposit = draft.depositKind === "fixed" ? { kind: "fixed" as const, amountCents: cents(draft.deposit) } : draft.depositKind === "percent" ? { kind: "percent" as const, percent: Number(draft.deposit) } : { kind: "none" as const };
    busy.current = true; setSaving(true); setError(""); setStatus("");
    try {
      const response = await api.api.app["event-types"][":id"]["payment-terms"].$put({ param: { id: eventId }, json: { deposit, balanceDueHours: Number(draft.balanceDueHours || 0), freeWindowHours: whole(draft.freeWindowHours), lateCancelFeeCents: cents(draft.lateFee), noShowFeeCents: cents(draft.noShowFee) } });
      if (!response.ok) throw new Error(await errorMessage(response));
      setDraft(draftOf(await response.json() as PaymentTerms));
      setStatus("Payment terms saved. New bookings show and follow them; existing bookings keep the terms they were shown.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The save result could not be received. Reload to check the saved terms."); }
    finally { busy.current = false; setSaving(false); }
  }
  const disabled = !hydrated || !draft || saving;
  return <form className="mt-7" onSubmit={save} aria-label="Deposits and cancellation policy">
    <Card className="p-5 sm:p-6"><SectionHeading icon="notice" title="Deposits and cancellation policy" description="Take a deposit and collect the balance later, and state when cancelling is free and what a late cancellation or a no-show costs." />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className={label}>Deposit<Select value={draft?.depositKind ?? "none"} disabled={disabled} onChange={event => change({ depositKind: event.target.value as Draft["depositKind"], deposit: "" })}><option value="none">No deposit: the full price at booking</option><option value="fixed">A fixed amount (USD)</option><option value="percent">A percentage of the price</option></Select></label>
        {draft?.depositKind !== "none" ? <label className={label}>{draft?.depositKind === "percent" ? "Deposit (% of the chosen duration's price)" : "Deposit (USD)"}<Input inputMode="decimal" value={draft?.deposit ?? ""} disabled={disabled} onChange={event => change({ deposit: event.target.value })} /></label> : null}
        {draft?.depositKind !== "none" ? <label className={label}>Balance due (hours before the start)<Input inputMode="numeric" value={draft?.balanceDueHours ?? ""} disabled={disabled} onChange={event => change({ balanceDueHours: event.target.value })} /></label> : null}
        <label className={label}>Free cancellation until (hours before the start)<Input inputMode="numeric" placeholder="No cancellation policy" value={draft?.freeWindowHours ?? ""} disabled={disabled} onChange={event => change({ freeWindowHours: event.target.value })} /></label>
        <label className={label}>Late-cancellation fee (USD)<Input inputMode="decimal" placeholder="None" value={draft?.lateFee ?? ""} disabled={disabled} onChange={event => change({ lateFee: event.target.value })} /></label>
        <label className={label}>No-show fee (USD)<Input inputMode="decimal" placeholder="None" value={draft?.noShowFee ?? ""} disabled={disabled} onChange={event => change({ noShowFee: event.target.value })} /></label>
      </div>
      <p className="mt-4 text-sm leading-6 text-soft">Cancelling inside the free window refunds everything paid automatically; after it, the late-cancellation fee applies. A fee is charged only to a card the invitee explicitly agreed to save for the stated amounts, never more. Without a free window there is no automatic refund and no fee; you can still refund from the booking record.</p>
      {error ? <p role="alert" className={noticeClassName("error", "mt-4")}>{error}</p> : null}
      {status ? <p role="status" className={noticeClassName("success", "mt-4")}>{status}</p> : null}
      <Button className="mt-5" type="submit" disabled={disabled}>{saving ? "Saving…" : "Save payment terms"}</Button>
    </Card>
  </form>;
}
