import { useEffect, useRef, useState } from "react";
import { errorMessage, publicApi } from "../../../api/client";
import { formatUsd } from "../../../shared/event-price";
import { creditAmount, type AppointmentCredit } from "./entitlement-summary";
export type AppliedCredit = { entitlement: AppointmentCredit; discountCents: number; dueNowCents: number; redemption: { code?: string }; email: string };

export function BookingCredit({ handle, slug, email, durationMinutes, disabled, applied, onApply }: { handle: string; slug: string; email: string; durationMinutes: number; disabled: boolean; applied?: AppliedCredit; onApply(value: AppliedCredit | undefined): void }) {
  const [mode, setMode] = useState("code"), [code, setCode] = useState(""), [error, setError] = useState("");
  const [working, setWorking] = useState(false), epoch = useRef(0);
  useEffect(() => { epoch.current++; setWorking(false); setError(""); }, [email, durationMinutes]);
  const current = applied?.email === email ? applied : undefined;
  async function apply() {
    const read = ++epoch.current;
    setWorking(true); setError(""); onApply(undefined);
    try {
      const response = await publicApi.api.public.book[":handle"][":slug"].credit.$post({ param: { handle, slug }, json: { email: email.trim(), ...(mode === "code" ? { code: code.trim() } : {}), durationMinutes } });
      if (read !== epoch.current) return;
      if (!response.ok) { setError(await errorMessage(response)); return; }
      const result = await response.json() as Omit<AppliedCredit, "redemption" | "email">;
      if (read === epoch.current) onApply({ ...result, redemption: mode === "code" ? { code: code.trim() } : {}, email });
    } catch { if (read === epoch.current) setError("Your credit could not be checked. Retry before confirming."); }
    finally { if (read === epoch.current) setWorking(false); }
  }
  return <fieldset className="pb-request-fields" disabled={disabled || working}><legend>Use appointment credit</legend>
    <label>Find your credit<select aria-label="Find your credit" value={mode} onChange={event => { setMode(event.target.value); onApply(undefined); setError(""); }}><option value="code">Redemption code</option><option value="email">Booking email</option></select></label>
    {mode === "code" ? <label>Redemption code<input aria-label="Redemption code" autoComplete="off" maxLength={200} value={code} onChange={event => { setCode(event.target.value); onApply(undefined); setError(""); }} /></label> : <p>We will look for credit bought with the booking email entered above.</p>}
    <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="button" className="pb-secondary-button" disabled={disabled || working || !email.trim() || mode === "code" && !code.trim()} onClick={() => void apply()}>{working ? "Checking balance…" : "Check and apply credit"}</button>{current ? <button type="button" className="pb-quiet-button" onClick={() => onApply(undefined)}>Remove credit</button> : null}</div>
    {error ? <p className="pb-field-error" role="alert">{error}</p> : null}
    {current ? <div className="pb-request-notice sm:col-span-2" role="status"><p><strong>{current.entitlement.name ?? "Appointment credit"}</strong></p><p>Remaining balance: {creditAmount(current.entitlement, current.entitlement.balance)} · Expires {new Date(current.entitlement.expiresAt).toLocaleDateString("en-US", { timeZone: "UTC" })} (UTC)</p><p>Credit applied: {formatUsd(current.discountCents)} · Due now: {formatUsd(current.dueNowCents)}</p><p>{current.dueNowCents ? "The remaining amount is paid on Stripe before your booking confirms." : "No additional payment is needed for this booking."} The balance is reserved only when you confirm.</p></div> : null}
  </fieldset>;
}
