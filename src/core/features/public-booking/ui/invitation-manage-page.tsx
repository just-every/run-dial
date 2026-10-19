import { useRef, useState } from "react";
import { publicApi, errorMessage } from "../../../api/client";
import { useHydrated } from "../../../app/use-hydrated";
import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";

export function InvitationManagePage({ token }: { token: string }) {
  const hydrated = useHydrated();
  const pending = useRef(false);
  const [working, setWorking] = useState(false), [requested, setRequested] = useState(false), [error, setError] = useState("");
  async function emailLink() {
    if (pending.current) return;
    pending.current = true; setWorking(true); setError("");
    try {
      const response = await publicApi.api.public.manage.invite[":token"].email.$post({ param: { token }, json: {} });
      if (response.ok) setRequested(true);
      else setError(await errorMessage(response));
    } catch { setError("Your request could not be confirmed. Please try again."); }
    finally { pending.current = false; setWorking(false); }
  }
  return <PublicTheme><PublicHeader /><main className="pb-recovery pb-invitation" aria-busy={working}><section>
    <p className="pb-eyebrow">Calendar invitation</p><h1>Get your manage link</h1>
    <p>We’ll email a replacement link to the invitee’s booking address. Booking details stay private.</p>
    <p>Requesting a replacement means your earlier manage link no longer works, including the link in your confirmation email.</p>
    {requested ? <p role="status">Your request is queued. Check the invitee’s inbox for the replacement link. Your earlier manage link no longer works.</p>
      : <button className="pb-primary-button" type="button" disabled={!hydrated || working} onClick={() => void emailLink()}>{working ? "Requesting link…" : "Email me my link"}</button>}
    {error ? <p role="alert">{error}</p> : null}
  </section></main><PublicFooter /></PublicTheme>;
}
