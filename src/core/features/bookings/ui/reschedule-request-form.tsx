import { useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Input, Select, Textarea } from "../../../app/ui/primitives";
import type { BookingRecord } from "../types";

export function RescheduleRequestForm({ booking, onChanged, onWorking }: { booking: BookingRecord; onChanged(): Promise<void>; onWorking(value: boolean): void }) {
  const [message, setMessage] = useState("");
  const [releaseTime, setReleaseTime] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("14");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHours, setReminderHours] = useState("24");
  const [working, setWorking] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState("");
  const posting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (posting.current || uncertain) return;
    posting.current = true; setWorking(true); onWorking(true); setNotice("");
    try {
      const response = await api.api.app.bookings[":id"]["reschedule-request"].$post({ param: { id: booking.id }, json: { message, releaseTime, expiresInDays: Number(expiresInDays), reminderHours: reminderEnabled ? Number(reminderHours) : null } });
      if (!response.ok) {
        const message = await errorMessage(response);
        if (response.status >= 500) { setUncertain(true); setNotice(`${message} Refresh the booking before sending another request.`); }
        else setNotice(message);
        return;
      }
      await onChanged();
    } catch { setUncertain(true); setNotice("The request result could not be checked. Refresh the booking before sending another request."); }
    finally { posting.current = false; setWorking(false); onWorking(false); }
  }
  return <form onSubmit={event => void submit(event)} className="rounded-xl border border-line bg-row p-4">
    <h3 className="font-semibold">Ask the invitee to pick a new time</h3>
    <p className="mt-2 text-sm leading-6 text-soft">Send an email with a link to choose a new time for this booking. Its duration and saved answers stay the same.</p>
    <fieldset disabled={working || uncertain} className="mt-4 grid min-w-0 gap-4 border-0 p-0">
      <label className="grid gap-2 text-sm font-semibold">Message (optional)<Textarea value={message} maxLength={1000} onChange={event => setMessage(event.target.value)} /><span className="text-xs font-normal text-muted">{message.length}/1,000 characters</span></label>
      <label className="grid gap-2 text-sm font-semibold">Original time<Select value={releaseTime ? "release" : "hold"} onChange={event => setReleaseTime(event.target.value === "release")}><option value="hold">Hold until the invitee picks</option><option value="release">Release now</option></Select></label>
      <p className="text-sm leading-6 text-soft">{releaseTime ? "The original time becomes available to others immediately. If no new time is picked before expiry, this booking is cancelled with the reason “no new time picked”." : "The original time stays reserved. The request expires at the original start if that comes first; if no new time is picked, the original booking remains."}</p>
      <label className="grid gap-2 text-sm font-semibold">Request expires after (days)<Input type="number" min={1} max={30} step={1} required value={expiresInDays} onChange={event => setExpiresInDays(event.target.value)} /></label>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={reminderEnabled} onChange={event => setReminderEnabled(event.target.checked)} className="h-5 w-5 shrink-0" />Send one reminder if no new time is picked</label>
      {reminderEnabled ? <><label className="grid gap-2 text-sm font-semibold">Remind after (hours)<Input type="number" min={1} max={168} step={1} required value={reminderHours} onChange={event => setReminderHours(event.target.value)} /></label><p className="text-sm leading-6 text-soft">Choose 1 hour to 7 days after sending. A reminder is sent only while the request is open, and before the original start when the time is held.</p></> : null}
      <div><Button type="submit">{working ? "Sending request…" : "Send reschedule request"}</Button></div>
    </fieldset>
    {notice ? <p role="status" className="mt-3 text-sm text-danger">{notice}</p> : null}
  </form>;
}
