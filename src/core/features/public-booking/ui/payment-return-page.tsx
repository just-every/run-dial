import { useCallback, useEffect, useState } from "react";
import { errorMessage, publicApi } from "../../../api/client";
import { formatUsd } from "../../../shared/event-price";
import { format } from "./flow-shell";
import { manageToken } from "./navigation";
import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";
import { PublicRecoveryPage } from "./recovery-page";

type ReturnStatus = { state: "held" | "processing" | "confirmed" | "released" | "unbookable"; mode?: "payment" | "setup"; approvalRequired?: boolean; approvalUrl?: string; amountCents: number; currency: "usd"; startAt: string; endAt: string; expiresAt: string; reference: string | null; checkoutUrl: string | null; manageUrl?: string; reason?: string };

/** Stripe returns the invitee here. The page only reads the hold: its URL, and Stripe's session ID in it,
 * never confirm anything. The receipt opens once Stripe's signed event has confirmed the booking. */
export function PaymentReturnPage({ handle, slug, token }: { handle: string; slug: string; token: string }) {
  const [status, setStatus] = useState<ReturnStatus>();
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const read = useCallback(async () => {
    try {
      const response = await publicApi.api.public.payments[":token"].$get({ param: { token } });
      if ([404, 410].includes(response.status)) { setMissing(true); return; }
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setError(""); setStatus(await response.json() as ReturnStatus);
    } catch { setError("The payment status could not be loaded. Reload to check again."); }
  }, [token]);
  useEffect(() => { void read(); }, [read]);
  useEffect(() => {
    if (status?.approvalUrl) { window.location.replace(status.approvalUrl); return; }
    if (status?.state === "confirmed" && status.manageUrl) {
      const receipt = manageToken(status.manageUrl);
      if (receipt) window.location.replace(`/book/${handle}/${slug}/confirmed?token=${encodeURIComponent(receipt)}`);
      return;
    }
    if (!status || !["held", "processing"].includes(status.state)) return;
    const timer = window.setTimeout(() => { void read(); }, 2_000);
    return () => window.clearTimeout(timer);
  }, [status, read, handle, slug]);
  if (missing) return <PublicRecoveryPage kind="booking" />;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <PublicTheme><PublicHeader step={3} /><main className="pb-recovery"><section aria-live="polite">
    <p className="pb-eyebrow">{status?.approvalRequired ? "Booking request" : "Payment"}</p>
    {!status ? <p>{error || "Checking your payment with Stripe…"}</p> : <>
      <h1>{status.approvalRequired && ["held", "processing"].includes(status.state) ? status.mode === "setup" ? "Waiting for Stripe to confirm your saved card." : "Waiting for Stripe to confirm your authorization." : status.state === "confirmed" ? status.mode === "setup" ? "Card saved." : "Payment confirmed." : status.state === "released" ? "This payment window has closed." : status.state === "unbookable" ? status.mode === "setup" ? "Card saved, but the time is no longer available." : "Payment received, but the time is no longer available." : status.mode === "setup" ? "Waiting for Stripe to confirm your card." : "Waiting for Stripe to confirm your payment."}</h1>
      <p>{status.mode === "setup" ? "Nothing charged" : `${status.approvalRequired && status.state !== "confirmed" ? "Authorization · " : ""}${formatUsd(status.amountCents)}`} · {format(status.startAt, timezone)} · {timezone}</p>
      {status.reference ? <p>Stripe reference <code>{status.reference}</code></p> : null}
      {status.state === "held" ? <p>Your time is held until {format(status.expiresAt, timezone)}. {status.approvalRequired ? "Finish on Stripe to submit your request. Nothing is charged before the host approves. The booking is confirmed only after approval and, for a priced request, Stripe confirms the capture." : "If you have not paid yet, return to Stripe to finish. The booking is confirmed only when Stripe confirms the payment."}</p> : null}
      {status.state === "processing" ? <p>{status.approvalRequired ? "Stripe is checking your authorization. The host can decide once it is accepted; no booking has been confirmed." : "Your bank payment is processing. Your time stays held, and you will receive a confirmation email once Stripe confirms the payment."}</p> : null}
      {status.state === "released" ? <p>No booking was made and nothing was charged. Choose a new time to try again.</p> : null}
      {status.state === "unbookable" ? <p>No booking was made. Dial does not issue refunds; contact the host, who refunds payments in Stripe.</p> : null}
      {status.state === "held" && status.checkoutUrl ? <a className="pb-primary-link" href={status.checkoutUrl}>Return to Stripe Checkout</a> : null}
      {status.state === "released" ? <a className="pb-primary-link" href={`/book/${handle}/${slug}`}>Choose a new time</a> : null}
      {error ? <p role="alert">{error}</p> : null}
    </>}
  </section></main><PublicFooter /></PublicTheme>;
}
