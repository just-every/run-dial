import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Badge, Button, Input, noticeClassName } from "../../../app/ui/primitives";
import { formatUsd } from "../../../shared/event-price";
import type { BookingMoney as Money } from "../../payments";
import { startTime } from "./operator-time";
import { useOperators } from "./use-operators";

const kinds: Record<string, string> = { balance: "Balance paid", invoice: "Invoice", refund: "Refund", late_cancel_fee: "Late-cancellation fee", no_show_fee: "No-show fee" };
type Offer = { priceCents: number; taxRequired: boolean };
const withTax = (amountCents: number, taxCents: number) => `${formatUsd(amountCents)}${taxCents ? ` (sales tax ${formatUsd(taxCents)})` : ""}`;
const actors: Record<string, string> = { invitee: "Invitee, balance link", policy: "Cancellation policy", operator: "Operator" };
const field = "grid gap-2 text-sm font-[650] text-ink";

/** PAY-003 on the booking record: what was shown and paid, every money movement with its actor, reason, time and
 * Stripe reference, and the host's refund and no-show fee actions. */
export function BookingMoney({ bookingId, timezone, noShow, onChanged }: { bookingId: string; timezone: string; noShow: boolean; onChanged(notice: string): Promise<void> }) {
  const [money, setMoney] = useState<Money | null>(), [offer, setOffer] = useState<Offer | null>(null), [error, setError] = useState(""), [working, setWorking] = useState(false);
  const [address, setAddress] = useState({ line1: "", city: "", state: "", postalCode: "" }), [invoicing, setInvoicing] = useState(false);
  const [amount, setAmount] = useState(""), [reason, setReason] = useState(""), [refunding, setRefunding] = useState(false);
  const key = useRef(crypto.randomUUID());
  const { operators } = useOperators(Boolean(money?.movements.some(movement => movement.actorType === "operator")));
  const load = useCallback(async () => {
    try {
      const response = await api.api.app.bookings[":id"].money.$get({ param: { id: bookingId } });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json() as { money: Money | null; invoiceOffer: Offer | null };
      setMoney(body.money); setOffer(body.invoiceOffer);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Payments could not be loaded. Refresh to try again."); }
  }, [bookingId]);
  useEffect(() => { void load(); }, [load]);
  if (money === undefined) return error ? <p role="alert" className={noticeClassName("error", "mt-5")}>{error}</p> : null;
  const issue = (event: React.FormEvent) => {
    event.preventDefault();
    const billingAddress = offer?.taxRequired ? { line1: address.line1.trim(), city: address.city.trim(), state: address.state.trim().toUpperCase(), postalCode: address.postalCode.trim(), country: "US" as const } : undefined;
    if (billingAddress && (!billingAddress.line1 || !billingAddress.city || !/^[A-Z]{2}$/.test(billingAddress.state) || !/^\d{5}(-\d{4})?$/.test(billingAddress.postalCode))) { setError("Enter the invitee's billing address: street, city, two-letter state and ZIP code."); return; }
    void act(() => api.api.app.bookings[":id"].invoice.$post({ param: { id: bookingId }, json: billingAddress ? { billingAddress } : {} }), "Invoice issued and emailed to the invitee.");
  };
  const invoiceForm = offer ? <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={issue} aria-label="Issue invoice">
    <p className="text-sm leading-6 text-soft sm:col-span-2">Invoice this unpaid booking for {formatUsd(offer.priceCents)}{offer.taxRequired ? " plus sales tax at the invitee's billing address" : ""}. Stripe hosts the invoice and its payment page; Dial emails the link and marks it paid only when Stripe confirms.</p>
    {offer.taxRequired ? <>{(["line1", "city", "state", "postalCode"] as const).map(name => <label key={name} className={field}>{{ line1: "Street address", city: "City", state: "State", postalCode: "ZIP code" }[name]}<Input value={address[name]} maxLength={name === "state" ? 2 : 200} disabled={working} onChange={event => setAddress(current => ({ ...current, [name]: event.target.value }))} /></label>)}</> : null}
    <div className="flex flex-wrap gap-3 sm:col-span-2"><Button type="submit" disabled={working}>{working ? "Issuing…" : "Issue invoice"}</Button><Button variant="quiet" type="button" disabled={working} onClick={() => setInvoicing(false)}>Cancel</Button></div>
  </form> : null;
  if (money === null) return offer ? <section className="mt-6 border-t border-line-soft pt-5" aria-label="Payments">
    <h3 className="font-bold text-ink">Payments</h3>
    <p className="mt-2 text-sm leading-6 text-soft">Nothing was paid when this booking was made.</p>
    {error ? <p role="alert" className={noticeClassName("error", "mt-4")}>{error}</p> : null}
    {invoicing ? invoiceForm : <Button className="mt-4" variant="secondary" type="button" onClick={() => setInvoicing(true)}>Issue invoice</Button>}
  </section> : null;
  const { ledger, snapshot, consent, payment } = money;
  const noShowFee = snapshot?.noShowFeeCents ?? 0, charged = money.movements.some(movement => movement.kind === "no_show_fee");
  async function act(run: () => Promise<Parameters<typeof errorMessage>[0] & { ok: boolean; json(): Promise<unknown> }>, done: string) {
    if (working) return;
    setWorking(true); setError("");
    try {
      const response = await run();
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setMoney((await response.json() as { money: Money | null }).money); setOffer(null); setInvoicing(false);
      key.current = crypto.randomUUID(); setRefunding(false); setAmount(""); setReason("");
      await onChanged(done);
    } catch { setError("The result could not be received. Refresh before retrying; a retried refund with the same request is never repeated."); }
    finally { setWorking(false); }
  }
  const refund = (event: React.FormEvent) => {
    event.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isInteger(cents) || cents < 1 || cents > ledger.refundableCents) { setError(`Enter an amount between $0.01 and ${formatUsd(ledger.refundableCents)}.`); return; }
    if (!reason.trim()) { setError("Give the reason for the refund."); return; }
    void act(() => api.api.app.bookings[":id"].refunds.$post({ param: { id: bookingId }, json: { amountCents: cents, reason: reason.trim(), idempotencyKey: key.current } }), `Refund of ${formatUsd(cents)} sent to Stripe.`);
  };
  return <section className="mt-6 border-t border-line-soft pt-5" aria-label="Payments">
    <h3 className="font-bold text-ink">Payments</h3>
    <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <Fact label="Price" value={formatUsd(ledger.priceCents)} />
      {payment ? <Fact label={payment.kind === "deposit" ? "Deposit" : "Payment"} value={`${withTax(payment.amountCents, payment.taxCents)} · Stripe ${[payment.checkoutSessionId, payment.paymentIntentId].filter(Boolean).join(" · ")}`} /> : <Fact label="Payment" value="Nothing charged at booking" />}
      {snapshot?.balanceCents ? <Fact label="Balance" value={ledger.balanceDueCents ? `${formatUsd(ledger.balanceDueCents)} due` : `${formatUsd(snapshot.balanceCents)} paid`} /> : null}
      <Fact label="Paid" value={formatUsd(ledger.paidCents)} /><Fact label="Fees" value={formatUsd(ledger.feesCents)} />
      <Fact label="Refunded" value={formatUsd(ledger.refundedCents)} /><Fact label="Net" value={formatUsd(ledger.netCents)} />
      {ledger.taxCents ? <Fact label="Sales tax" value={`${formatUsd(ledger.taxCents)} collected after refunds`} /> : null}
      <Fact label="Cancellation policy" value={snapshot?.freeWindowHours ? `Free until ${snapshot.freeWindowHours} hours before; late fee ${formatUsd(snapshot.lateCancelFeeCents)}` : "None: no automatic refund or fee"} />
      <Fact label="Saved card" value={consent?.paymentMethodId ? `Consent ${consent.consentTextVersion} at ${startTime(consent.acceptedAt, timezone)} for a ${formatUsd(consent.lateCancelFeeCents)} late fee and a ${formatUsd(consent.noShowFeeCents)} no-show fee` : "None"} />
    </dl>
    {money.movements.length ? <ol className="mt-5 grid gap-3 text-sm text-muted">{money.movements.map(movement => <li key={movement.id} className="min-w-0 break-words rounded-xl bg-row px-3.5 py-3">
      <p className="flex flex-wrap items-center gap-2 font-[650] text-ink">{kinds[movement.kind]} · {withTax(movement.amountCents, movement.taxCents)} <Badge tone={movement.status === "succeeded" ? "success" : movement.status === "failed" ? "danger" : "warning"}>{movement.status}</Badge></p>
      <p>{actors[movement.actorType]}{movement.actorId ? ` ${operators.find(operator => operator.id === movement.actorId)?.email ?? movement.actorId}` : ""} · {startTime(movement.createdAt, timezone)}</p>
      <p>{movement.reason}{movement.failureCode ? ` · Stripe: ${movement.failureCode}` : ""}</p>
      {movement.processorRef ? <p>Stripe reference <code className="break-all">{movement.processorRef}</code></p> : null}
      {movement.invoiceUrl ? <p>Invoice {movement.invoiceNumber ?? movement.invoiceId}: <a className="font-semibold underline underline-offset-4" href={movement.invoiceUrl}>Stripe-hosted invoice</a></p> : null}
    </li>)}</ol> : null}
    {error ? <p role="alert" className={noticeClassName("error", "mt-4")}>{error}</p> : null}
    <div className="mt-5 flex flex-wrap gap-3">
      {ledger.refundableCents > 0 && !refunding ? <Button variant="secondary" type="button" disabled={working} onClick={() => { setRefunding(true); setAmount((ledger.refundableCents / 100).toFixed(2)); }}>Refund</Button> : null}
      {noShow && noShowFee > 0 && consent?.paymentMethodId && !charged ? <Button variant="secondary" type="button" disabled={working} onClick={() => void act(() => api.api.app.bookings[":id"]["no-show-fee"].$post({ param: { id: bookingId } }), `No-show fee of ${formatUsd(noShowFee)} charged.`)}>{working ? "Charging…" : `Charge no-show fee ${formatUsd(noShowFee)}`}</Button> : null}
    </div>
    {refunding ? <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={refund} aria-label="Refund">
      <label className={field}>Amount (USD, up to {formatUsd(ledger.refundableCents)})<Input inputMode="decimal" value={amount} disabled={working} onChange={event => setAmount(event.target.value)} /></label>
      <label className={field}>Reason<Input value={reason} maxLength={500} disabled={working} onChange={event => setReason(event.target.value)} /></label>
      <div className="flex flex-wrap gap-3 sm:col-span-2"><Button type="submit" disabled={working}>{working ? "Refunding…" : "Send refund"}</Button><Button variant="quiet" type="button" disabled={working} onClick={() => setRefunding(false)}>Cancel</Button></div>
    </form> : null}
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-[13px] font-[650] text-muted">{label}</dt><dd className="mt-1 break-words text-[15px] text-ink">{value}</dd></div>; }
