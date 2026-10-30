import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../api/client";
import { useHydrated } from "../../../app/use-hydrated";
import { Badge, Button, Card, Input, Select, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { useEventTypes } from "../../bookings/client";
import { formatUsd } from "../../../shared/event-price";
import { CreditLedger, creditKinds, type AppointmentCredit } from "../../../shared/appointment-credit";

type Product = { id: string; kind: AppointmentCredit["kind"]; name: string; sessions: number; amountCents: number; validityDays: number };
export function EntitlementSettingsCard() {
  const hydrated = useHydrated();
  const { eventTypes, error: eventError } = useEventTypes();
  const [eventId, setEventId] = useState("");
  const [products, setProducts] = useState<Product[]>([]), [credits, setCredits] = useState<AppointmentCredit[]>([]);
  const [kind, setKind] = useState<Product["kind"]>("package"), [name, setName] = useState("");
  const [sessions, setSessions] = useState("3"), [amount, setAmount] = useState("120.00"), [validityDays, setValidityDays] = useState("180");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const reads = useRef(0), saving = useRef(false);
  const load = useCallback(async () => {
    const epoch = ++reads.current;
    const responses = await Promise.all([fetch("/api/app/payments/entitlements"), ...(eventId ? [fetch(`/api/app/event-types/${encodeURIComponent(eventId)}/products`)] : [])]);
    for (const response of responses) if (!response.ok) throw new Error(await errorMessage(response));
    const [nextCredits, nextProducts] = await Promise.all(responses.map(response => response.json()));
    if (epoch !== reads.current) return;
    setCredits(nextCredits as AppointmentCredit[]); setProducts(nextProducts as Product[] ?? []);
  }, [eventId]);
  useEffect(() => { void load().catch(() => setError("Appointment credit could not be loaded. Reload to try again.")); return () => { reads.current++; }; }, [load]);
  async function create() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(""); setNotice(""); setCouponCode("");
    try {
      const cents = Number(amount) * 100;
      if (!Number.isFinite(cents) || Math.abs(cents - Math.round(cents)) > 0.000001) throw new Error("Enter a USD amount in whole cents.");
      const response = await fetch(`/api/app/event-types/${encodeURIComponent(eventId)}/products`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name, sessions: kind === "gift" ? 1 : Number(sessions), amountCents: Math.round(cents), validityDays: Number(validityDays) }) });
      if (!response.ok) throw new Error(await errorMessage(response));
      const created = await response.json() as { code?: string };
      if (created.code) setCouponCode(created.code);
      setNotice(kind === "coupon" ? "Coupon issued. Save its code before leaving this page." : "Purchase option created. Invitees can buy it on the booking details page.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The purchase option could not be saved."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Card id="appointment-credits" className="min-w-0 p-5 sm:p-6 xl:col-span-2">
    <SectionHeading icon="calendar" title="Packages, memberships and credits" action={<Badge>{credits.length} balances</Badge>} />
    <p className="mt-3 text-sm leading-6 text-soft">Offer session packages, monthly memberships and USD gift certificates through Stripe. Issue a coupon with a fixed USD discount and a limited number of uses.</p>
    {error || eventError ? <p role="alert" className={noticeClassName("error", "mt-4")}>{error || eventError}</p> : null}
    {notice ? <p role="status" className={noticeClassName("success", "mt-4")}>{notice}</p> : null}
    {couponCode ? <div className="mt-4 rounded-xl bg-row p-4 text-sm"><p>Coupon code</p><code className="mt-2 block break-all font-semibold">{couponCode}</code><Button type="button" variant="secondary" className="mt-3" onClick={() => void navigator.clipboard.writeText(couponCode).then(() => setNotice("Coupon code copied.")).catch(() => setNotice("Select the code above to copy it."))}>Copy code</Button></div> : null}
    <form aria-label="Appointment purchase option" className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void create(); }}>
      <label className="grid min-w-0 gap-2 text-sm font-semibold">Event type<Select value={eventId} required disabled={!hydrated || busy} onChange={event => setEventId(event.target.value)}><option value="">Choose an event type</option>{eventTypes.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</Select></label>
      <label className="grid min-w-0 gap-2 text-sm font-semibold">Credit type<Select value={kind} disabled={!hydrated || busy} onChange={event => setKind(event.target.value as Product["kind"])}>{Object.entries(creditKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
      <label className="grid min-w-0 gap-2 text-sm font-semibold sm:col-span-2">Name<Input required maxLength={120} value={name} disabled={!hydrated || busy} onChange={event => setName(event.target.value)} /></label>
      {kind !== "gift" ? <label className="grid min-w-0 gap-2 text-sm font-semibold">{kind === "coupon" ? "Number of uses" : kind === "membership" ? "Sessions each month" : "Sessions"}<Input type="number" min={1} max={1000} step={1} required value={sessions} disabled={!hydrated || busy} onChange={event => setSessions(event.target.value)} /></label> : null}
      <label className="grid min-w-0 gap-2 text-sm font-semibold">{kind === "coupon" ? "Discount per use (USD)" : kind === "gift" ? "Gift value and price (USD)" : kind === "membership" ? "Monthly price (USD)" : "Price (USD)"}<Input type="number" min={0.5} max={999999.99} step={0.01} required value={amount} disabled={!hydrated || busy} onChange={event => setAmount(event.target.value)} /></label>
      <label className="grid min-w-0 gap-2 text-sm font-semibold">Valid for (days)<Input type="number" min={1} max={3660} step={1} required value={validityDays} disabled={!hydrated || busy} onChange={event => setValidityDays(event.target.value)} /></label>
      {kind === "membership" ? <p className="text-sm leading-6 text-soft sm:col-span-2">Stripe renews monthly and resets the session balance after a paid renewal. Unpaid renewals stop new redemptions.</p> : null}
      {kind === "coupon" ? <p className="text-sm leading-6 text-soft sm:col-span-2">Each booking consumes one use. The discount cannot exceed the booking price. Invitees pay the remainder on Stripe; eligible cancellations restore one use.</p> : null}
      <div className="sm:col-span-2"><Button disabled={!hydrated || busy || !eventId}>{busy ? "Saving…" : kind === "coupon" ? "Issue coupon" : "Create purchase option"}</Button></div>
    </form>
    {products.length ? <div className="mt-6"><h3 className="font-bold text-ink">Purchase options</h3><ul className="mt-3 grid min-w-0 gap-3">{products.map(product => <li key={product.id} className="rounded-xl bg-row p-4 text-sm leading-6"><p className="font-semibold">{product.name} · {creditKinds[product.kind]}</p><p>{product.kind === "coupon" ? `${formatUsd(product.amountCents)} discount · ${product.sessions} uses` : product.kind === "gift" ? formatUsd(product.amountCents) : `${product.sessions} sessions · ${formatUsd(product.amountCents)}${product.kind === "membership" ? " each month" : ""}`} · {product.validityDays} days</p></li>)}</ul></div> : null}
    <div className="mt-6"><h3 className="font-bold text-ink">Balances and redemption history</h3>{credits.length ? <ul className="mt-3 grid min-w-0 gap-3">{credits.map(credit => <li key={credit.id} className="min-w-0 rounded-xl bg-row p-4">{credit.email ? <p className="mb-2 break-all text-sm font-semibold">{credit.email}</p> : null}<CreditLedger credit={credit} /></li>)}</ul> : <p className="mt-3 text-sm text-soft">No appointment credits yet.</p>}</div>
    <Button variant="quiet" type="button" className="mt-4" disabled={!hydrated || busy} onClick={() => void load().catch(() => setError("Appointment credit could not be reloaded."))}>Reload balances</Button>
  </Card>;
}
