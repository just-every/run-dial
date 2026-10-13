import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";

export function MailPreferencesCard() {
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await api.api.app.mail.preferences.$get();
    if (!response.ok) throw new Error(await errorMessage(response));
    setMuted((await response.json()).bookingMailMuted); setReady(true);
  }
  useEffect(() => { void load().catch(() => setError("Your mail preference could not be loaded. Reload it to retry.")); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || working) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await api.api.app.mail.preferences.$put({ json: { bookingMailMuted: muted } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setMuted((await response.json()).bookingMailMuted);
      setNotice("Your booking mail preference is saved.");
    } catch { setError("The result could not be received. Your choice is kept; reload the preference or retry."); }
    finally { setWorking(false); }
  }

  async function reload() {
    setWorking(true); setError(""); setNotice("");
    try { await load(); } catch { setError("Your mail preference could not be loaded. Please retry."); }
    finally { setWorking(false); }
  }

  return <Card className="p-5 sm:p-6">
    <SectionHeading icon="bell" title="Your booking mail" />
    <p className="mt-2 text-sm leading-6 text-soft">Mute your booking confirmations, changes and reminders. Invitee and other operator mail is unaffected.</p>
    <p className="mt-2 text-sm leading-6 text-soft">Sign-in links, requests and connection alerts continue. Unmuting does not resend skipped notices.</p>
    {error ? <p role="alert" className="mt-4 rounded-[14px] bg-danger-wash p-3 text-sm leading-6 text-danger">{error}</p> : null}
    {notice ? <p role="status" className="mt-4 rounded-[14px] bg-gold-wash p-3 text-sm text-ink">{notice}</p> : null}
    <form onSubmit={(event) => void save(event)} className="mt-5">
      <fieldset disabled={!ready || working}>
        <label className="flex items-start gap-3 text-sm font-[650] text-ink"><input type="checkbox" className="mt-1" checked={muted} onChange={(event) => { setMuted(event.target.checked); setNotice(""); }} />Mute booking mail for me</label>
        <Button type="submit" className="mt-5">{working ? "Saving…" : "Save mail preference"}</Button>
      </fieldset>
    </form>
    {!ready && !error ? <p role="status" className="mt-4 text-sm text-muted">Loading your preference…</p> : null}
    {error ? <Button type="button" variant="quiet" className="mt-3" disabled={working} onClick={() => void reload()}>Reload mail preference</Button> : null}
  </Card>;
}
