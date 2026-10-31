import { useEffect, useRef, useState } from "react";
import { errorMessage, publicApi } from "../../../api/client";
import { useHydrated } from "../../../app/use-hydrated";
import { formatUsd } from "../../../shared/event-price";
import { creditLabel, type AppointmentProduct } from "./entitlement-summary";

/** Purchases are separate from selecting a time; Stripe alone activates the bought balance. */
export function AppointmentProducts({ handle, slug }: { handle: string; slug: string }) {
  const hydrated = useHydrated();
  const [products, setProducts] = useState<AppointmentProduct[]>([]), [email, setEmail] = useState("");
  const [working, setWorking] = useState(false), [error, setError] = useState("");
  const [purchase, setPurchase] = useState<{ code: string; checkoutUrl: string }>();
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    void publicApi.api.public.book[":handle"][":slug"].products.$get({ param: { handle, slug } }).then(async response => {
      if (!response.ok) throw new Error(await errorMessage(response));
      const rows = await response.json() as AppointmentProduct[];
      if (active) setProducts(rows);
    }).catch(() => { if (active) setError("Appointment products could not be loaded. Reload this page to retry."); });
    return () => { active = false; };
  }, [handle, slug]);
  async function buy(product: AppointmentProduct) {
    if (working) return;
    setWorking(true); setError(""); setPurchase(undefined);
    const key = `${product.id}:${email.trim().toLowerCase()}`;
    if (!keys.current.has(key)) keys.current.set(key, crypto.randomUUID());
    try {
      const response = await publicApi.api.public.book[":handle"][":slug"].products[":product"].purchase.$post({ param: { handle, slug, product: product.id }, json: { email: email.trim(), idempotencyKey: keys.current.get(key)! } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      const value = await response.json() as { code: string; checkoutUrl: string };
      setPurchase(value);
    } catch { setError("The purchase could not be received. Retry with the same email to retrieve it."); }
    finally { setWorking(false); }
  }
  if (!products.length) return error ? <p role="status" className="pb-request-notice">{error}</p> : null;
  return <details className="mt-6 rounded-2xl bg-row p-4 text-[15px] leading-6" aria-label="Appointment products"><summary className="cursor-pointer font-semibold max-sm:min-h-11 max-sm:py-2.5">Packages, memberships and gifts</summary>
    <p className="mt-3">Buy credit for this event, then book using your purchase email or redemption code. Payment does not reserve a time.</p>
    <form className="pb-request-form" onSubmit={event => event.preventDefault()}><fieldset className="pb-request-fields" disabled={!hydrated || working}><legend>Buy appointment credit</legend><label className="sm:col-span-2">Purchase email<input type="email" aria-label="Purchase email" autoComplete="email" maxLength={320} value={email} onChange={event => { setEmail(event.target.value); setPurchase(undefined); }} /></label></fieldset>
      <ul className="mt-4 grid gap-3">{products.map(product => <li className="rounded-xl bg-card p-4" key={product.id}><h3 className="font-semibold">{product.name}</h3><p>{creditLabel(product.kind)} · {formatUsd(product.amountCents)}{product.kind === "membership" ? " each month" : ""}</p><p>{product.kind === "gift" ? `${formatUsd(product.amountCents)} in booking credit` : `${product.sessions} sessions${product.kind === "membership" ? " per paid month" : ""}`} · {product.kind === "membership" ? "Valid through the paid period" : `Valid for ${product.validityDays} days`}</p><button className="pb-secondary-button mt-3" type="button" disabled={!hydrated || working || !email.trim()} onClick={() => void buy(product)}>{working ? "Preparing purchase…" : `Buy ${product.name}`}</button></li>)}</ul>
    </form>
    {error ? <p role="alert" className="pb-field-error mt-3">{error}</p> : null}
    {purchase ? <div className="pb-request-notice" role="status"><p>Save your redemption code: <code className="break-all">{purchase.code}</code></p><p>Your balance activates after Stripe confirms payment. You can also use your purchase email.</p><a className="pb-primary-link mt-3" href={purchase.checkoutUrl}>Continue purchase on Stripe</a></div> : null}
  </details>;
}
