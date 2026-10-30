import { useEffect, useRef, useState } from "react";
import { publicApi, errorMessage } from "../../../api/client";
import { formatUsd } from "../../../shared/event-price";
import { creditBalance } from "../../../shared/appointment-credit";

export type CreditPreview = { kind: "available"; balance: number; unit: string; expiresAt: string; creditKind: "package" | "membership" | "gift" | "coupon"; discountCents: number; remainderCents: number };
export type CreditRedemption = { code?: string };
type Refusal = { kind: "refused"; reason: string; balance: number; expiresAt?: string };
export function CreditEntry({ handle, slug, nonce, startAt, inviteeTimezone, link, email, disabled, redemption, onRedemption, preview, onPreview, error }: {
  handle: string; slug: string; nonce: string; startAt: string; inviteeTimezone: string; link?: string; email: string; disabled: boolean;
  redemption: CreditRedemption | undefined; onRedemption(value: CreditRedemption | undefined): void; preview: CreditPreview | undefined; onPreview(value: CreditPreview | undefined): void; error?: string;
}) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const reads = useRef(0);
  useEffect(() => { reads.current++; setBusy(false); setNotice(""); }, [email, redemption?.code, nonce]);
  async function check() {
    const epoch = ++reads.current; setBusy(true); setNotice(""); onPreview(undefined);
    try {
      const response = await publicApi.api.public.book[":handle"][":slug"]["credit-preview"].$post({ param: { handle, slug }, json: { nonce, startAt, inviteeTimezone, email, ...(redemption?.code ? { code: redemption.code } : {}), ...(link ? { link } : {}) } });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = await response.json() as CreditPreview | Refusal;
      if (epoch !== reads.current) return;
      if (result.kind === "available") onPreview(result);
      else setNotice(result.reason === "credit_expired" ? `This credit expired${result.expiresAt ? ` on ${new Date(result.expiresAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC` : ""}.` : result.reason === "credit_balance_insufficient" ? `This credit has insufficient balance. Remaining balance: ${result.balance}.` : result.reason === "membership_unpaid" ? "This membership is unpaid. A paid renewal is required before another booking." : result.reason === "credit_not_active" ? "This purchase is not active yet. Stripe must confirm payment before it can be redeemed." : result.reason === "credit_payment_terms_unsupported" ? "Appointment credit is unavailable with this booking's payment terms." : "No available appointment credit was found. Check the code or the email used to buy it.");
    } catch (cause) { if (epoch === reads.current) setNotice(cause instanceof Error ? cause.message : "The balance could not be checked. Try again."); }
    finally { if (epoch === reads.current) setBusy(false); }
  }
  return <section className="pb-credit-entry" aria-label="Appointment credit">
    <label className="pb-consent"><input type="checkbox" checked={redemption !== undefined} disabled={disabled} onChange={event => { reads.current++; setNotice(""); onRedemption(event.target.checked ? {} : undefined); onPreview(undefined); }} /><span>Use a package, membership, gift or coupon</span></label>
    {redemption !== undefined ? <div className="pb-credit-fields">
      <label>Credit code<input value={redemption.code ?? ""} maxLength={200} autoComplete="off" disabled={disabled || busy} onChange={event => { onRedemption(event.target.value ? { code: event.target.value.trim() } : {}); onPreview(undefined); }} /></label>
      <p>Enter a code, or leave it empty to find credits bought with the email above.</p>
      <button className="pb-secondary-button" type="button" disabled={disabled || busy || !email.trim()} onClick={() => void check()}>{busy ? "Checking…" : "Check balance"}</button>
      {preview ? <div className="pb-payment-summary" role="status"><p><strong>{creditBalance({ kind: preview.creditKind, balance: preview.balance })} available</strong></p><p>Expires {new Date(preview.expiresAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC.</p><p>Credit applied: {formatUsd(preview.discountCents)} · {preview.remainderCents ? `Pay ${formatUsd(preview.remainderCents)} on Stripe.` : "Nothing to pay on Stripe."}</p><p>The balance is checked again when you confirm.</p></div> : null}
      {notice || error ? <p className="pb-field-error" role="alert">{notice || error}</p> : null}
    </div> : null}
  </section>;
}
