import { useEffect, useRef, useState } from "react";
import { errorMessage, publicApi } from "../../../api/client";
import { formatUsd } from "../../../shared/event-price";

export type TaxQuote = { taxCents: number; summary: string | null; dueNowCents: number; dueNowTaxCents: number; dueNowTotalCents: number; balanceTotalCents: number };
export type BillingAddress = { line1: string; city: string; state: string; postalCode: string; country: "US" };
type Draft = Omit<BillingAddress, "country">;
const complete = (draft: Draft) => draft.line1.trim() && draft.city.trim() && /^[A-Za-z]{2}$/.test(draft.state.trim()) && /^\d{5}(-\d{4})?$/.test(draft.postalCode.trim());

/** PAY-005: the billing address Stripe Tax prices, and the sales tax shown before anything is held. The quote is
 * fetched for the address as entered; the confirmation repeats it and refuses a different figure. */
export function useTaxQuote(capability: { handle: string; slug: string; nonce: string; startAt: string; inviteeTimezone: string; link?: string }, enabled: boolean) {
  const [draft, setDraft] = useState<Draft>({ line1: "", city: "", state: "", postalCode: "" });
  const [quote, setQuote] = useState<TaxQuote>(), [quoting, setQuoting] = useState(false), [error, setError] = useState(""), [version, setVersion] = useState(0);
  const latest = useRef(0);
  const { handle, slug, nonce, startAt, inviteeTimezone, link } = capability;
  const address = complete(draft) ? { line1: draft.line1.trim(), city: draft.city.trim(), state: draft.state.trim().toUpperCase(), postalCode: draft.postalCode.trim(), country: "US" as const } : undefined;
  const key = address ? JSON.stringify(address) : "";
  useEffect(() => {
    if (!enabled || !key) { setQuote(undefined); return; }
    const request = ++latest.current;
    setQuoting(true); setError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await publicApi.api.public.book[":handle"][":slug"].tax.$post({ param: { handle, slug }, json: { nonce, startAt, inviteeTimezone, billingAddress: JSON.parse(key) as BillingAddress, ...(link ? { link } : {}) } });
          if (request !== latest.current) return;
          if (!response.ok) { setQuote(undefined); setError(await errorMessage(response)); return; }
          setQuote(await response.json() as TaxQuote);
        } catch { if (request === latest.current) { setQuote(undefined); setError("Sales tax could not be calculated. Check the address and try again."); } }
        finally { if (request === latest.current) setQuoting(false); }
      })();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [enabled, key, version, handle, slug, nonce, startAt, inviteeTimezone, link]);
  return { draft, setDraft: (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setQuote(undefined); }, address, quote, quoting, error, refresh: () => { setQuote(undefined); setVersion(current => current + 1); } };
}

export function BillingTax({ tax, disabled, error }: { tax: ReturnType<typeof useTaxQuote>; disabled: boolean; error?: string }) {
  const field = (label: string, name: keyof Draft, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <label><span className="pb-label-text">{label}<span aria-hidden="true"> *</span></span><input aria-label={label} required disabled={disabled} value={tax.draft[name]} aria-invalid={Boolean(error)} onChange={event => tax.setDraft({ [name]: event.target.value })} {...props} /></label>;
  return <fieldset className="pb-request-fields" disabled={disabled}><legend>Billing address for sales tax</legend>
    {field("Street address", "line1", { autoComplete: "billing address-line1", maxLength: 200 })}
    {field("City", "city", { autoComplete: "billing address-level2", maxLength: 100 })}
    {field("State", "state", { autoComplete: "billing address-level1", maxLength: 2, placeholder: "NY" })}
    {field("ZIP code", "postalCode", { autoComplete: "billing postal-code", inputMode: "numeric", maxLength: 10 })}
    <p className="pb-tax-line" role="status">{tax.quoting ? "Calculating sales tax…" : tax.quote ? tax.quote.dueNowTaxCents > 0 ? `Sales tax: ${formatUsd(tax.quote.dueNowTaxCents)}${tax.quote.summary ? ` (${tax.quote.summary})` : ""} · Due now: ${formatUsd(tax.quote.dueNowTotalCents)}` : `No sales tax applies to this address. Due now: ${formatUsd(tax.quote.dueNowTotalCents)}` : "Enter your billing address to see the sales tax before you pay."}</p>
    {tax.error || error ? <p className="pb-field-error">{tax.error || error}</p> : null}
  </fieldset>;
}
