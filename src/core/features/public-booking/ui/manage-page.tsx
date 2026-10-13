import { useEffect, useRef, useState } from "react";
import { useHydrated } from "../../../app/use-hydrated";
import { useDocumentData } from "../../../app/document-data";
import { errorMessage, publicApi } from "../../../api/client";
import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";
import { format } from "./flow-shell";
import { ManageReschedule } from "./manage-reschedule";
import type { Confirmation } from "./types";

export function ManageBookingPage({ token, embedded = false }: { token: string; embedded?: boolean }) {
  const [booking, setBooking] = useState<Confirmation | undefined>(useDocumentData<Confirmation>());
  const [notice, setNotice] = useState(""), [reason, setReason] = useState(""), [rescheduling, setRescheduling] = useState(false), [working, setWorking] = useState(false), [pending, setPending] = useState(false);
  const hydrated = useHydrated(), refreshEpoch = useRef(0), cancelling = useRef(false);
  useEffect(() => {
    const epoch = ++refreshEpoch.current;
    void (async () => {
      try {
        const response = await publicApi.api.public.manage[":token"].$get({ param: { token } });
        const next = response.ok ? await response.json() as Confirmation : undefined;
        if (epoch !== refreshEpoch.current) return;
        if (next) setBooking(next); else setNotice("This manage link is unavailable.");
      } catch { if (epoch === refreshEpoch.current) setNotice("Your booking could not be loaded. Reload this page to try again."); }
    })();
    return () => { refreshEpoch.current++; };
  }, [token]);
  if (!booking) return <PublicTheme><PublicHeader embedded={embedded} /><main className="pb-loading">{notice || "Loading your booking…"}</main></PublicTheme>;
  async function cancel() {
    if (working || pending || cancelling.current || !window.confirm("Cancel this booking? This cannot be undone.")) return;
    cancelling.current = true; refreshEpoch.current++; setWorking(true); setNotice("");
    try {
      const response = await publicApi.api.public.manage[":token"].cancel.$post({ param: { token }, json: { reason: reason || undefined } });
      if (response.ok) { setBooking(await response.json() as Confirmation); setRescheduling(false); setNotice("This booking has been cancelled."); }
      else setNotice(await errorMessage(response));
    } catch { setNotice("The result could not be received. Retry to check the same booking."); }
    finally { cancelling.current = false; setWorking(false); }
  }
  return <PublicTheme><PublicHeader embedded={embedded} /><main aria-busy={!hydrated || working} className={`pb-recovery pb-manage ${embedded ? "pb-event-embedded" : ""}`}><section><p className="pb-eyebrow">Manage booking</p><h1>{booking.event.eventTitle}</h1><p>Currently: {format(booking.occurrence.startAt, booking.inviteeTimezone)}, {booking.inviteeTimezone}</p>{notice || booking.state === "cancelled" ? <p role="status">{notice || "This booking has been cancelled."}</p> : null}{booking.state !== "cancelled" ? <><label className="pb-manage-reason">Reason (optional)<textarea disabled={!hydrated || working || pending} value={reason} onChange={event => setReason(event.target.value)} /></label><div className="pb-request-actions"><button type="button" className="pb-secondary-button" disabled={!hydrated || working || pending} onClick={() => void cancel()}>Cancel booking</button><button type="button" className="pb-secondary-button" disabled={!hydrated || working || pending} onClick={() => { refreshEpoch.current++; setRescheduling(true); }}>Reschedule booking</button></div>{rescheduling ? <ManageReschedule key={booking.occurrence.startAt} token={token} booking={booking} reason={reason} onBusy={setWorking} onPending={setPending} onBooked={value => { setBooking(value); setPending(false); setRescheduling(false); setNotice("Your booking has been rescheduled."); }} /> : null}</> : null}</section></main><PublicFooter embedded={embedded} /></PublicTheme>;
}
