import { useEffect, useRef, useState } from "react";
import { errorMessage, publicApi } from "../../../api/client";
import { formatUsd } from "../../../shared/event-price";

type Product = { id: string; kind: "package" | "membership" | "gift"; name: string; sessions: number; amountCents: number; validityDays: number };
export function CreditPurchases({ handle, slug, email, disabled }: { handle: string; slug: string; email: string; disabled: boolean }) {
  const [products, setProducts] = useState<Product[]>([]), [purchaserEmail, setPurchaserEmail] = useState("");
  const [busy, setBusy] = useState<string>(), [error, setError] = useState("");
  const [checkout, setCheckout] = useState<{ checkoutUrl: string; code: string }>();
  const keys = useRef(new Map<string, string>()), purchasing = useRef(false);
  useEffect(() => {
    let current = true;
    void publicApi.api.public.book[":handle"][":slug"].products.$get({ param: { handle, slug } }).then(async response => {
      if (!response.ok) throw new Error(await errorMessage(response));
      const rows = await response.json() as Product[];
      if (current) setProducts(rows);
    }).catch(() => { if (current) setError("Purchase options could not be loaded. Reload this page to try again."); });
    return () => { current = false; };
  }, [handle, slug]);
  async function purchase(product: Product) {
    if (purchasing.current) return;
    purchasing.current = true; setBusy(product.id); setError(""); setCheckout(undefined);
    const address = (purchaserEmail || email).trim();
    const keyName = `${product.id}:${address.toLowerCase()}`;
    const idempotencyKey = keys.current.get(keyName) ?? crypto.randomUUID();
    keys.current.set(keyName, idempotencyKey);
    try {
      const response = await publicApi.api.public.book[":handle"][":slug"].products[":product"].purchase.$post({ param: { handle, slug, product: product.id }, json: { email: address, idempotencyKey } });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = await response.json() as { checkoutUrl: string; code: string };
      setCheckout(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your purchase could not be started. Try again."); }
    finally { purchasing.current = false; setBusy(undefined); }
  }
  if (!products.length && !error) return null;
  return <details className="pb-credit-purchases"><summary>Buy a package, membership or gift</summary>
    <p>Credits become available after Stripe confirms your payment. Redeem with the code or the email you buy with.</p>
    <form onSubmit={event => event.preventDefault()} aria-label="Buy appointment credit">
      <label>Purchase email<input type="email" autoComplete="email" required maxLength={320} value={purchaserEmail || email} disabled={disabled || Boolean(busy)} onChange={event => { setPurchaserEmail(event.target.value); setCheckout(undefined); }} /></label>
      <ul>{products.map(product => <li key={product.id}><div><strong>{product.name}</strong><p>{product.kind === "gift" ? `${formatUsd(product.amountCents)} gift certificate` : `${product.sessions} sessions · ${formatUsd(product.amountCents)}${product.kind === "membership" ? " each month" : ""}`} · {product.validityDays} days</p>{product.kind === "membership" ? <p>Renews monthly. Paid renewals reset the session balance.</p> : null}</div><button type="button" className="pb-secondary-button" disabled={disabled || Boolean(busy) || !(purchaserEmail || email).trim()} onClick={event => { if (event.currentTarget.form?.reportValidity()) void purchase(product); }}>{busy === product.id ? "Opening…" : `Buy ${product.name}`}</button></li>)}</ul>
      {error ? <p className="pb-field-error" role="alert">{error}</p> : null}
      {checkout ? <div className="pb-payment-summary" role="status"><p>Save your credit code: <code>{checkout.code}</code></p><p>Your credits stay inactive until payment is confirmed.</p><a className="pb-primary-button" href={checkout.checkoutUrl}>Continue on Stripe</a></div> : null}
    </form>
  </details>;
}
