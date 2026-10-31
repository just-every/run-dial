import { useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Input, Select, noticeClassName } from "../../../app/ui/primitives";
import type { AppointmentCredit, AppointmentProduct } from "./entitlement-summary";

type Kind = AppointmentCredit["kind"];
export function AppointmentProductEditor({ eventId, editing, stripeConnected, onSaved, onCancel }: { eventId: string; editing?: AppointmentProduct; stripeConnected: boolean; onSaved(): void; onCancel(): void }) {
  const [kind, setKind] = useState<Kind>(editing?.kind ?? "package"), [name, setName] = useState(editing?.name ?? "");
  const [amount, setAmount] = useState(editing ? String(editing.amountCents / 100) : ""), [sessions, setSessions] = useState(String(editing?.sessions ?? 3)), [validity, setValidity] = useState(String(editing?.validityDays ?? 180)), [email, setEmail] = useState("");
  const [working, setWorking] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [issued, setIssued] = useState<string>(), purchase = useRef<{ payload: string; key: string } | undefined>(undefined);
  async function save() {
    if (working) return;
    const amountCents = Math.round(Number(amount) * 100), count = kind === "gift" ? 1 : Number(sessions), validityDays = Number(validity);
    if (!name.trim() || !Number.isFinite(Number(amount)) || amountCents < 50 || !Number.isInteger(count) || count < 1 || !Number.isInteger(validityDays) || validityDays < 1) { setError("Enter a name, at least $0.50, a whole session or use count, and a validity of at least one day."); return; }
    setWorking(true); setError(""); setNotice(""); setIssued(undefined);
    try {
      const body = { name: name.trim(), amountCents, sessions: count, validityDays };
      if (kind === "coupon") {
        const payload = JSON.stringify({ eventId, ...body, email: email.trim() });
        if (purchase.current?.payload !== payload) purchase.current = { payload, key: crypto.randomUUID() };
        const response = await api.api.app["event-types"][":id"].coupons.$post({ param: { id: eventId }, json: { ...body, email: email.trim(), idempotencyKey: purchase.current.key } });
        if (!response.ok) { setError(await errorMessage(response)); return; }
        setIssued((await response.json() as { code: string }).code);
        setNotice("Coupon issued. Share the code with its recipient.");
      } else if (editing) {
        const response = await api.api.app["event-types"][":id"].products[":product"].$put({ param: { id: eventId, product: editing.id }, json: body });
        if (!response.ok) { setError(await errorMessage(response)); return; }
        setNotice("Appointment product updated.");
      } else {
        const response = await api.api.app["event-types"][":id"].products.$post({ param: { id: eventId }, json: { ...body, kind: kind as AppointmentProduct["kind"] } });
        if (!response.ok) { setError(await errorMessage(response)); return; }
        setNotice(stripeConnected ? "Appointment product saved. Invitees can buy it on the published booking page." : "Appointment product saved. It goes on sale once Stripe is connected.");
      }
      onSaved();
    } catch { setError("The result could not be received. Reload balances before creating another product; coupon retries retrieve the same code."); }
    finally { setWorking(false); }
  }
  return <form aria-label="Appointment product" className="mt-4" onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset disabled={working} className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 text-[15px] font-semibold">{editing ? `Edit ${editing.name}` : "Create appointment product or coupon"}</legend>
      <label className="grid gap-2 text-sm font-semibold">Product type<Select aria-label="Product type" value={kind} onChange={event => { setKind(event.target.value as Kind); setIssued(undefined); }}><option value="package">Package</option><option value="membership">Monthly membership</option><option value="gift">Gift certificate</option><option value="coupon">Coupon</option></Select></label>
      <label className="grid gap-2 text-sm font-semibold">Product name<Input aria-label="Product name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="grid gap-2 text-sm font-semibold">{kind === "coupon" ? "Discount per booking (USD)" : kind === "gift" ? "Gift value (USD)" : kind === "membership" ? "Monthly price (USD)" : "Purchase price (USD)"}<Input aria-label={kind === "coupon" ? "Discount per booking (USD)" : kind === "gift" ? "Gift value (USD)" : kind === "membership" ? "Monthly price (USD)" : "Purchase price (USD)"} type="number" inputMode="decimal" min="0.50" max="999999.99" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
      {kind !== "gift" ? <label className="grid gap-2 text-sm font-semibold">{kind === "coupon" ? "Coupon uses" : kind === "membership" ? "Sessions each month" : "Sessions"}<Input aria-label={kind === "coupon" ? "Coupon uses" : kind === "membership" ? "Sessions each month" : "Sessions"} type="number" min="1" max="1000" step="1" required value={sessions} onChange={event => setSessions(event.target.value)} /></label> : null}
      <label className="grid gap-2 text-sm font-semibold">Valid for (days)<Input aria-label="Valid for (days)" type="number" min="1" max="3660" step="1" required value={validity} onChange={event => setValidity(event.target.value)} /></label>
      {kind === "coupon" ? <label className="grid gap-2 text-sm font-semibold">Recipient email<Input aria-label="Recipient email" type="email" maxLength={320} required value={email} onChange={event => setEmail(event.target.value)} /></label> : null}
      <p className="text-sm leading-6 text-soft sm:col-span-2">{kind === "coupon" ? "Each booking uses one coupon use and discounts the price by up to this amount, never below zero. The remainder is charged through Stripe. Eligible cancellation restores that use." : kind === "membership" ? "Stripe bills monthly. A paid renewal resets the session balance; failed payment pauses new redemptions." : kind === "gift" ? "The gift balance is in USD. It must cover the booking in full." : "One session is used per booking. Eligible cancellation restores that session."}</p>
      <div className="flex flex-wrap gap-3"><Button disabled={working}>{working ? "Saving…" : kind === "coupon" ? "Issue coupon" : editing ? "Save changes" : "Save appointment product"}</Button>{editing ? <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button> : null}</div>
    </fieldset>
    {error ? <p role="alert" className={noticeClassName("error", "mt-3")}>{error}</p> : null}
    {notice ? <p role="status" className={noticeClassName("success", "mt-3")}>{notice}</p> : null}
    {issued ? <p className="mt-3 break-all text-sm">Redemption code: <code>{issued}</code></p> : null}
  </form>;
}
