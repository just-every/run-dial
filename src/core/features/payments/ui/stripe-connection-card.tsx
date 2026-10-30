import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Badge, Button, Card, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { operatorTimestamp } from "../../../shared/operator-format";
import { TaxSettings } from "./tax-settings";

type StripeStatus = { redirectUri: string; webhookUrl: string; webhookEvents: string[]; configured: boolean; state: "connected" | "deauthorized" | "disconnected"; accountId: string | null; livemode: boolean; achEnabled: boolean; statusChangedAt: string | null };

/** PAY-001 Settings: connect the host's own Stripe account (Connect Standard), its status, ACH and disconnect,
 * plus the exact redirect URI and webhook endpoint to register. */
export function StripeConnectionCard({ timezone }: { timezone: string | null }) {
  const [status, setStatus] = useState<StripeStatus>();
  const [working, setWorking] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const load = async () => {
    try { const response = await api.api.app.payments.stripe.$get(); if (response.ok) setStatus(await response.json() as StripeStatus); else setError(await errorMessage(response)); }
    catch { setError("Stripe status could not be loaded. Reload settings to try again."); }
  };
  useEffect(() => { void load(); }, []);
  async function act(run: () => Promise<Parameters<typeof errorMessage>[0] & { ok: boolean; json(): Promise<unknown> }>, success: (body: unknown) => string) {
    if (working) return;
    setWorking(true); setNotice(""); setError("");
    try { const response = await run(); if (!response.ok) setError(await errorMessage(response)); else setNotice(success(await response.json())); await load(); }
    catch { setError("The result could not be received. Reload settings before retrying."); }
    finally { setWorking(false); }
  }
  const connected = status?.state === "connected";
  return <Card id="stripe-connection" className="min-w-0 p-5 sm:p-6 xl:col-span-2">
    <SectionHeading icon="shield" title="Stripe payments" action={<Badge tone={connected ? "success" : "warning"}>{connected ? "Connected" : status?.state === "deauthorized" ? "Access revoked" : "Not connected"}</Badge>} />
    <p className="mt-3 max-w-2xl text-sm leading-6 text-soft">{connected ? "Paid event types take payment through Stripe Checkout on your own Stripe account. A booking confirms only when Stripe's signed event arrives." : status?.state === "deauthorized" ? "Stripe reported that Dial's access was revoked. New paid bookings are refused until you connect again; free event types are unchanged." : "Connect your own Stripe account to charge for event types. Free event types work without Stripe."}</p>
    {status ? <div className="mt-4 grid gap-1 text-sm leading-6 text-ink">{status.accountId ? <p>Account: <code className="break-all">{status.accountId}</code>{status.livemode ? " · live mode" : " · test mode"}</p> : null}{status.statusChangedAt ? <p>Status changed {operatorTimestamp(status.statusChangedAt, timezone ?? "UTC")}.</p> : null}</div> : null}
    <details className="mt-5 rounded-2xl bg-row px-4 py-3.5 text-sm leading-6 text-soft">
      <summary className="cursor-pointer py-2.5 text-[15px] font-bold text-ink sm:py-0">Set up Stripe for this installation</summary>
      <ol className="mt-3 list-decimal space-y-3 pl-5">
        <li>In your Stripe platform account, open <strong>Connect → Settings → Onboarding options → OAuth</strong>, turn on OAuth for <strong>Standard</strong> accounts and add this exact <strong>Redirect URI</strong>:{status ? <code className="mt-2 block break-all rounded-lg bg-card p-2 font-mono text-ink">{status.redirectUri}</code> : null}</li>
        <li>Under <strong>Developers → Webhooks</strong>, add an endpoint that listens to <strong>events on connected accounts</strong> at:{status ? <code className="mt-2 block break-all rounded-lg bg-card p-2 font-mono text-ink">{status.webhookUrl}</code> : null}with the events {status?.webhookEvents.map((name, index) => <span key={name}>{index ? ", " : ""}<code>{name}</code></span>)}.</li>
        <li>Store the platform secret key as <code>STRIPE_SECRET_KEY</code>, the Connect client ID (<code>ca_…</code>) as <code>STRIPE_CONNECT_CLIENT_ID</code> and the endpoint's signing secret (<code>whsec_…</code>) as <code>STRIPE_WEBHOOK_SECRET</code>, each as an encrypted deploy secret. Never put them in source files.</li>
        <li>Return here and choose <strong>Connect Stripe</strong>. Dial stores only the connected account ID, never a card number.</li>
      </ol>
      {status ? <p className="mt-3 font-semibold">{status.configured ? "Required Stripe secrets are present." : "Required Stripe secrets are missing. Add all three before connecting."}</p> : null}
    </details>
    {connected ? <label className="mt-5 flex items-start gap-3 text-sm text-ink"><input className="mt-0.5 h-[18px] w-[18px]" type="checkbox" checked={status.achEnabled} disabled={working} onChange={event => void act(() => api.api.app.payments.stripe.ach.$put({ json: { enabled: event.target.checked } }), () => "Payment methods saved.")} /><span>Offer <strong>ACH Direct Debit</strong> (US bank account) as well as cards, Apple Pay, Google Pay and Link. A bank payment holds the time until Stripe confirms it.</span></label> : null}
    {connected ? <TaxSettings /> : null}
    {error ? <p role="alert" className={noticeClassName("error", "mt-4")}>{error}</p> : null}
    {notice ? <p role="status" className={noticeClassName("success", "mt-4")}>{notice}</p> : null}
    <div className="mt-5 flex flex-wrap gap-3">{connected ? <Button variant="danger" type="button" disabled={working} onClick={() => void act(() => api.api.app.payments.stripe.$delete(), body => (body as { revoked: boolean }).revoked ? "Stripe disconnected and Dial's access revoked." : "Stripe disconnected in Dial. Revoke Dial's access in your Stripe dashboard if it is still listed.")}>{working ? "Disconnecting…" : "Disconnect Stripe"}</Button> : <Button type="button" disabled={!status?.configured || working} onClick={() => window.location.assign("/api/app/payments/stripe/oauth/start")}>Connect Stripe</Button>}</div>
  </Card>;
}
