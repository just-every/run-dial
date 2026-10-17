import { ManageChangeTerms } from "./booking-change-terms";
import { ContactHost } from "./contact-host";
import { LockedBookingTime, LockedTimezoneNotice, useBrowserTimezone } from "./locked-timezone";
import { useEffect, useRef, useState } from "react";
import { useHydrated } from "../../../app/use-hydrated";
import { useDocumentData } from "../../../app/document-data";
import { errorMessage, publicApi } from "../../../api/client";
import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";
import { format } from "./flow-shell";
import { deviceTimezone } from "../../../shared/timezone-choices";
import { ManageReschedule } from "./manage-reschedule";
import type { Confirmation } from "./types";

export function ManageBookingPage({ token, embedded = false }: { token: string; embedded?: boolean }) {
  const browserTimezone = useBrowserTimezone();
  const resultElement = useRef<HTMLParagraphElement>(null);
  const focusResult = useRef(false);
  const [booking, setBooking] = useState<Confirmation | undefined>(useDocumentData<Confirmation>());
  const [timezone, setTimezone] = useState<string>();
  const hostTimezone = booking?.host.timezone;
  useEffect(() => { if (hostTimezone) setTimezone(deviceTimezone(hostTimezone)); }, [hostTimezone]);
  const [notice, setNotice] = useState(""), [reason, setReason] = useState(""), [rescheduling, setRescheduling] = useState(false), [working, setWorking] = useState(false), [pending, setPending] = useState(false);
  const hydrated = useHydrated(), refreshEpoch = useRef(0), cancelling = useRef(false);
  useEffect(() => { if (!working && notice && focusResult.current) { resultElement.current?.focus(); focusResult.current = false; } }, [working, notice]);
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
  const displayTimezone = booking.lockedTimezone ?? timezone ?? booking.inviteeTimezone;
  const rescheduleAllowed = booking.changePolicy?.rescheduleAllowed !== false;
  const cancellationAllowed = booking.changePolicy?.cancellationAllowed !== false;
  async function cancel() {
    if (!cancellationAllowed || working || pending || cancelling.current || !window.confirm("Cancel this booking? This cannot be undone.")) return;
    cancelling.current = true; refreshEpoch.current++; setWorking(true); setNotice("");
    try {
      const response = await publicApi.api.public.manage[":token"].cancel.$post({ param: { token }, json: { reason: reason || undefined } });
      if (response.ok) { const cancelled = await response.json() as Confirmation; focusResult.current = true; setBooking(cancelled); setRescheduling(false); setNotice("This booking has been cancelled."); }
      else setNotice(await errorMessage(response));
    } catch { setNotice("The result could not be received. Retry to check the same booking."); }
    finally { cancelling.current = false; setWorking(false); }
  }
  return <PublicTheme><PublicHeader embedded={embedded} /><main aria-busy={!hydrated || working} className={`pb-recovery pb-manage ${embedded ? "pb-event-embedded" : ""}`}><section><p className="pb-eyebrow">Manage booking</p><h1>{booking.event.eventTitle}</h1>{booking.lockedTimezone ? <><LockedTimezoneNotice timezone={booking.lockedTimezone} /><LockedBookingTime startAt={booking.occurrence.startAt} endAt={booking.occurrence.endAt} timezone={booking.lockedTimezone} browserTimezone={browserTimezone} /></> : <p>{booking.state === "cancelled" ? "Cancelled time: " : "Currently: "}{format(booking.occurrence.startAt, displayTimezone)}, {displayTimezone}</p>}<ManageChangeTerms decision={booking.changePolicy} timezone={displayTimezone} />{notice || booking.state === "cancelled" ? <p ref={resultElement} tabIndex={-1} role="status">{notice || "This booking has been cancelled."}</p> : null}{booking.state !== "cancelled" ? <>{rescheduleAllowed || cancellationAllowed ? <label className="pb-manage-reason">Reason (optional)<textarea disabled={!hydrated || working || pending} value={reason} onChange={event => setReason(event.target.value)} /></label> : null}<div className="pb-request-actions">{cancellationAllowed ? <button type="button" className="pb-secondary-button" disabled={!hydrated || working || pending} onClick={() => void cancel()}>Cancel booking</button> : null}{rescheduleAllowed ? <button type="button" className="pb-secondary-button" disabled={!hydrated || working || pending} onClick={() => { refreshEpoch.current++; setRescheduling(true); }}>Reschedule booking</button> : null}</div>{!rescheduleAllowed || !cancellationAllowed ? <ContactHost key={token} token={token} /> : null}{rescheduling && rescheduleAllowed ? <ManageReschedule key={booking.occurrence.startAt} token={token} booking={booking} timezone={booking.lockedTimezone ? browserTimezone ?? "" : displayTimezone} onTimezoneChange={setTimezone} reason={reason} onBusy={setWorking} onPending={setPending} onBooked={value => { focusResult.current = true; setBooking(value); setPending(false); setRescheduling(false); setNotice("Your booking has been rescheduled."); }} /> : null}</> : null}</section></main><PublicFooter embedded={embedded} /></PublicTheme>;
}
