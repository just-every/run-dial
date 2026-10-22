import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Input } from "../../../app/ui/primitives";
import { formatUsd } from "../../../shared/event-price";
import type { BookingMoney } from "../../payments";
import type { BookingRecord } from "../types";

const field = "grid gap-2 text-sm font-semibold";

/** PAY-003 (D4) on the booking record: cancelling refunds everything paid, once, with no fee, and voids any open
 * balance or invoice; the operator may instead refund less, or nothing, by giving a reason the invitee is told. */
export function CancelBookingForm({ booking, onWorking, onCancelled, onClose }: { booking: BookingRecord; onWorking(working: boolean): void; onCancelled(notice: string): Promise<void>; onClose(): void }) {
  const [refundable, setRefundable] = useState<number>(), [notice, setNotice] = useState(""), [working, setWorking] = useState(false);
  const [reason, setReason] = useState(""), [choice, setChoice] = useState<"full" | "less">("full"), [amount, setAmount] = useState(""), [refundReason, setRefundReason] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const response = await api.api.app.bookings[":id"].money.$get({ param: { id: booking.id } });
        if (!response.ok) { setNotice(await errorMessage(response)); return; }
        setRefundable(((await response.json()) as { money: BookingMoney | null }).money?.ledger.refundableCents ?? 0);
      } catch { setNotice("Payments could not be loaded. Refresh before cancelling."); }
    })();
  }, [booking.id]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (refundable === undefined) return;
    const cents = choice === "less" ? Math.round(Number(amount || "0") * 100) : refundable;
    if (choice === "less" && (!Number.isInteger(cents) || cents < 0 || cents >= refundable)) { setNotice(`Enter an amount from $0.00 to less than ${formatUsd(refundable)}.`); return; }
    if (choice === "less" && !refundReason.trim()) { setNotice("Give the reason for refunding less. The invitee's cancellation email states it."); return; }
    setWorking(true); onWorking(true); setNotice("");
    try {
      const response = await api.api.app.bookings[":id"].cancel.$post({ param: { id: booking.id }, json: { ...(reason.trim() ? { reason: reason.trim() } : {}), ...(choice === "less" ? { refund: { amountCents: cents, reason: refundReason.trim() } } : {}) } });
      if (!response.ok) { setNotice(await errorMessage(response)); return; }
      await onCancelled(refundable ? `Booking cancelled. ${cents ? `Refund of ${formatUsd(cents)} sent to Stripe` : "Nothing refunded"}; invitee email queued.` : "Booking cancelled and delivery updates queued.");
    } catch { setNotice("Cancellation could not be checked. Refresh the booking before trying again."); }
    finally { setWorking(false); onWorking(false); }
  }
  return <form onSubmit={event => void submit(event)} aria-label="Cancel booking" className="rounded-xl border border-line bg-row p-4">
    <h3 className="font-semibold">Cancel this booking</h3>
    <fieldset disabled={working || refundable === undefined} className="mt-4 grid gap-4 border-0 p-0">
      <label className={field}>Reason (optional)<Input value={reason} maxLength={500} onChange={event => { setNotice(""); setReason(event.target.value); }} /></label>
      {refundable ? <fieldset className="grid gap-3 border-0 p-0">
        <legend className="text-sm font-semibold">Refund</legend>
        <label className="flex items-start gap-3 text-sm"><input type="radio" name="refund" checked={choice === "full"} onChange={() => { setNotice(""); setChoice("full"); }} />Refund everything paid, {formatUsd(refundable)}. No fee is charged.</label>
        <label className="flex items-start gap-3 text-sm"><input type="radio" name="refund" checked={choice === "less"} onChange={() => { setNotice(""); setChoice("less"); }} />Refund less, or nothing, with a reason</label>
        {choice === "less" ? <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>Amount to refund (USD)<Input inputMode="decimal" value={amount} placeholder="0.00" onChange={event => { setNotice(""); setAmount(event.target.value); }} /></label>
          <label className={field}>Reason for the smaller refund<Input value={refundReason} maxLength={500} onChange={event => { setNotice(""); setRefundReason(event.target.value); }} /></label>
          <p className="text-sm text-muted sm:col-span-2">The invitee's cancellation email states the amount refunded and this reason.</p>
        </div> : null}
      </fieldset> : null}
      {notice ? <p role="alert" className="text-sm text-[#a54038]">{notice}</p> : null}
      <div className="flex flex-wrap gap-3"><Button variant="danger" type="submit">{working ? "Cancelling…" : "Cancel booking"}</Button><Button variant="quiet" type="button" onClick={onClose}>Keep booking</Button></div>
    </fieldset>
  </form>;
}
