import { useCallback, useEffect, useState } from "react";
import { errorMessage, publicApi } from "../../../api/client";
import { useHydrated } from "../../../app/use-hydrated";
import { formatUsd } from "../../../shared/event-price";
import { format } from "./flow-shell";
import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";
import { PublicRecoveryPage } from "./recovery-page";

type BalanceStatus = { state: "due" | "paid" | "expired" | "cancelled"; amountCents: number; balanceDueCents: number; dueAt: string; eventTitle: string; startAt: string; reference: string | null; processing: boolean };

/** PAY-003's balance link: what is still due on a deposit booking and until when, paid on Stripe Checkout. Only
 * Stripe's signed event marks it paid; returning from Stripe only reads the state again. */
export function BalancePage({ token }: { token: string }) {
  const hydrated = useHydrated();
  const [status, setStatus] = useState<BalanceStatus>(), [missing, setMissing] = useState(false), [error, setError] = useState(""), [working, setWorking] = useState(false);
  const returned = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("paid") === "1";
  const read = useCallback(async () => {
    try {
      const response = await publicApi.api.public.payments.balance[":token"].$get({ param: { token } });
      if (response.status === 404) { setMissing(true); return; }
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setError(""); setStatus(await response.json() as BalanceStatus);
    } catch { setError("The balance could not be loaded. Reload to check again."); }
  }, [token]);
  useEffect(() => { void read(); }, [read]);
  useEffect(() => {
    if (!returned || status?.state !== "due") return;
    const timer = window.setTimeout(() => { void read(); }, 2_000);
    return () => window.clearTimeout(timer);
  }, [returned, status, read]);
  async function pay() {
    if (working) return;
    setWorking(true); setError("");
    try {
      const response = await publicApi.api.public.payments.balance[":token"].$post({ param: { token } });
      if (!response.ok) { setError(await errorMessage(response)); await read(); return; }
      window.location.assign((await response.json() as { checkoutUrl: string }).checkoutUrl);
    } catch { setError("Stripe could not be reached. Try again."); }
    finally { setWorking(false); }
  }
  if (missing) return <PublicRecoveryPage kind="booking" />;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <PublicTheme><PublicHeader /><main className="pb-recovery"><section aria-live="polite">
    <p className="pb-eyebrow">Balance</p>
    {!status ? <p>{error || "Loading your balance…"}</p> : <>
      <h1>{status.state === "paid" ? "Balance paid." : status.state === "cancelled" ? "This booking is cancelled." : status.state === "expired" ? "This payment link has closed." : returned ? "Waiting for Stripe to confirm your payment." : `${formatUsd(status.balanceDueCents)} due.`}</h1>
      <p>{status.eventTitle} · {format(status.startAt, timezone)} · {timezone}</p>
      {status.state === "due" ? <p>Due by {format(status.dueAt, timezone)}. You pay securely on Stripe Checkout; Dial never sees your card number.</p> : null}
      {status.state === "paid" ? <p>{formatUsd(status.amountCents)} paid{status.reference ? <> · Stripe reference <code>{status.reference}</code></> : null}.</p> : null}
      {status.state === "cancelled" ? <p>Nothing more is due. The booking's cancellation policy decides any refund; see your manage link.</p> : null}
      {status.state === "expired" ? <p>The meeting has started, so this link no longer takes payment. Contact the host to settle the balance.</p> : null}
      {status.state === "due" && !returned ? <button type="button" className="pb-primary-button mt-5" disabled={!hydrated || working} onClick={() => void pay()}>{working ? "Opening Stripe…" : `Pay the balance · ${formatUsd(status.balanceDueCents)}`}</button> : null}
      {error ? <p role="alert">{error}</p> : null}
    </>}
  </section></main><PublicFooter /></PublicTheme>;
}
