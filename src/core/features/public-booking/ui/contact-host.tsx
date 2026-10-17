import { useRef, useState } from "react";
import { errorMessage, publicApi } from "../../../api/client";
import { useHydrated } from "../../../app/use-hydrated";

export function ContactHost({ token }: { token: string }) {
  const hydrated = useHydrated();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [working, setWorking] = useState(false), [sent, setSent] = useState(false), [notice, setNotice] = useState("");
  const attempt = useRef<{ idempotencyKey: string; message?: string } | undefined>(undefined);
  const posting = useRef(false);
  async function contact() {
    if (posting.current || sent) return;
    attempt.current ??= { idempotencyKey: crypto.randomUUID(), ...(message.trim() ? { message: message.trim() } : {}) };
    posting.current = true; setPending(true); setWorking(true); setNotice("");
    try {
      const response = await publicApi.api.public.manage[":token"]["contact-host"].$post({ param: { token }, json: attempt.current });
      if (!response.ok) { setNotice(await errorMessage(response)); return; }
      const receipt = await response.json() as { sent: boolean };
      if (receipt.sent !== true) { setNotice("Your message could not be confirmed. Retry to check the same message."); return; }
      setSent(true); setPending(false); attempt.current = undefined;
    } catch { setNotice("The result could not be received. Retry to send or retrieve the same message."); }
    finally { posting.current = false; setWorking(false); }
  }
  return <section className="pb-contact-host" aria-label="Contact the host"><h2>Contact the host</h2>{sent ? <p role="status">Your message is queued for the host. They can reply to your booking email address.</p> : <form onSubmit={event => { event.preventDefault(); void contact(); }}><p>Ask the host for help with changes to this booking.</p><label className="pb-manage-reason">Message (optional)<textarea maxLength={1000} disabled={!hydrated || working || pending} value={message} onChange={event => setMessage(event.target.value)} /></label><button type="submit" className="pb-secondary-button" disabled={!hydrated || working}>{working ? "Sending…" : pending ? "Retry message" : "Contact the host"}</button>{notice ? <p role="status">{notice}</p> : null}</form>}</section>;
}
