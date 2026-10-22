import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Input, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";

type Preview = { bookings: number; requests: number; payments: number; pending: boolean; operatorIdentityRetained: boolean; expiresAt: number; confirmation: string };
type Receipt = { operatorIdentityRetained: boolean; id: string; bookings: number; requests: number; completedAt: string | null; localComplete: boolean; calendarCleanup: string; calendarFailures: (string | null)[];
  savedCardsDetached: number; savedCardFailures: number; stripeCustomersRetained: number | null; stripeCustomersNotice: string | null; stripeSessionsRetained: number | null };

export function PersonErasureCard() {
  const errorId = useId();
  const [invalidEmail, setInvalidEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  const receiptElement = useRef<HTMLDivElement>(null);
  useEffect(() => { if (receipt) receiptElement.current?.focus(); }, [receipt]);

  async function inspect(event: FormEvent) {
    event.preventDefault(); setInvalidEmail(false); setWorking(true); setError(""); setReceipt(undefined);
    try {
      const response = await api.api.app.privacy.preview.$post({ json: { email } });
      if (!response.ok) { setInvalidEmail(response.status === 400); throw Error(await errorMessage(response)); }
      setPreview(await response.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Preview unavailable."); }
    finally { setWorking(false); }
  }
  async function erase() {
    if (!preview) return;
    setWorking(true); setError("");
    try {
      const response = await api.api.app.privacy.erase.$post({ json: { email, confirmation: preview.confirmation, expiresAt: preview.expiresAt } });
      if (!response.ok) throw Error(await errorMessage(response));
      setReceipt(await response.json() as Receipt); setPreview(undefined); setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erasure could not complete. Preview again to resume.");
      setPreview(undefined);
    } finally { setWorking(false); }
  }
  async function refresh() {
    if (!receipt) return;
    setWorking(true); setError("");
    try {
      const response = await api.api.app.privacy.receipts[":id"].$get({ param: { id: receipt.id } });
      if (!response.ok) throw Error(await errorMessage(response));
      setReceipt(await response.json() as Receipt);
    } catch (e) { setError(e instanceof Error ? e.message : "Cleanup status unavailable."); }
    finally { setWorking(false); }
  }
  function cancel() { setPreview(undefined); previewButton.current?.focus(); }

  return <Card className="p-5 sm:p-6 xl:col-span-2">
    <SectionHeading icon="people" title="Erase personal data" />
    <p className="mt-3 text-sm leading-6 text-soft">Preview every booking and availability request for an email, then permanently erase their answers, notes, private links, annotations and local mail. Calendar cleanup is tracked separately.</p>
    {error ? <p id={errorId} role="alert" className={noticeClassName("error", "mt-3")}>{error}</p> : null}
    <form onSubmit={inspect} aria-busy={working} className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
      <label className="grid gap-2 text-sm font-[650]">Person’s email
        <Input aria-invalid={invalidEmail} aria-describedby={invalidEmail ? errorId : undefined} type="text" inputMode="email" autoComplete="email" required maxLength={320} value={email} disabled={working} onChange={event => { setEmail(event.target.value); setPreview(undefined); if (invalidEmail) { setInvalidEmail(false); setError(""); } }} />
      </label>
      <Button ref={previewButton} type="submit" variant="secondary" className="self-end" disabled={working}>Preview erasure</Button>
    </form>
    {preview ? <div className="mt-4 rounded-[14px] border border-danger-line bg-danger-wash p-4 text-ink">
      {preview.pending ? <p role="status" className="mb-2">An earlier erasure is incomplete. New matching records are held; confirm below to finish the remaining work.</p> : null}
      <p role="status">{preview.bookings} bookings and {preview.requests} requests match this email.</p>
      {preview.payments ? <p className="mt-2">{preview.payments} pending Checkout {preview.payments === 1 ? "payment" : "payments"} will be closed before erasure. Any captured payment is refunded first.</p> : null}
      {preview.operatorIdentityRetained ? <p className="mt-2">The associated operator identity and sign-in access will be retained. This erases their matching invitee records. Remove an operator separately in Operator access; self-removal and protected-owner holds still apply.</p> : null}
      <p className="mt-2 text-sm">This action is permanent. Downloaded copies cannot be recalled. Use a current archive for future restores.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" variant="danger" disabled={working} onClick={() => void erase()}>Confirm permanent erasure</Button>
        <Button type="button" variant="secondary" disabled={working} onClick={cancel}>Cancel</Button>
      </div>
    </div> : null}
    {receipt ? <div ref={receiptElement} role="status" tabIndex={-1} className="mt-4 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gold-line">
      <p>Erased {receipt.bookings} matching bookings and {receipt.requests} matching requests. Record cleanup {receipt.localComplete ? "complete" : "pending"}.</p>
      {receipt.completedAt ? <p>Completed <time dateTime={receipt.completedAt}>{new Date(receipt.completedAt).toLocaleString()}</time>. Receipt {receipt.id}.</p> : null}
      {receipt.operatorIdentityRetained ? <p>Associated operator identity was retained by this erasure. Account removal is separate.</p> : null}
      <p>Calendar cleanup: {receipt.calendarCleanup}.</p>
      {receipt.savedCardsDetached || receipt.savedCardFailures ? <p>Saved cards: {receipt.savedCardsDetached} detached at Stripe, {receipt.savedCardFailures} not detached.</p> : null}
      {receipt.stripeCustomersRetained ? <p>Stripe customers kept: {receipt.stripeCustomersRetained}. {receipt.stripeCustomersNotice}</p> : null}
      {receipt.stripeSessionsRetained ? <p>Stripe Checkout sessions kept: {receipt.stripeSessionsRetained}.</p> : null}
      {receipt.calendarFailures.length ? <p>Calendar cleanup needs attention: {receipt.calendarFailures.join(", ")}</p> : null}
      {receipt.calendarCleanup !== "completed" ? <Button type="button" variant="secondary" className="mt-3" disabled={working} onClick={() => void refresh()}>Refresh cleanup status</Button> : null}
    </div> : null}
  </Card>;
}
