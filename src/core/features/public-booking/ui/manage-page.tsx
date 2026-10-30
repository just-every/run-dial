import { completePendingAnalytics } from "./analytics";
import { ApprovalStatus } from "./approval-status";
import { ManageGuests } from "./manage-guests";
import { ManageChangeTerms } from "./booking-change-terms";
import { ContactHost } from "./contact-host";
import { CreditLedger } from "../../../shared/appointment-credit";
import { PaymentSummary } from "./pay-step";
import { LockedBookingTime, LockedTimezoneNotice, useBrowserTimezone } from "./locked-timezone";
import { useEffect, useRef, useState } from "react";
import { useHydrated } from "../../../app/use-hydrated";
import { useDocumentData } from "../../../app/document-data";
import { errorMessage, publicApi } from "../../../api/client";
import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";
import { formatRange } from "./invitee-time";
import { ManageCancel } from "./manage-cancel";
import { deviceTimezone } from "../../../shared/timezone-choices";
import { ManageReschedule } from "./manage-reschedule";
import { ManageRescheduleRequest } from "./manage-reschedule-request";
import type { Confirmation } from "./types";

export function ManageBookingPage({ token, embedded = false }: { token: string; embedded?: boolean }) {
  const browserTimezone = useBrowserTimezone();
  const resultElement = useRef<HTMLParagraphElement>(null);
  const focusResult = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [booking, setBooking] = useState<Confirmation | undefined>(useDocumentData<Confirmation>());
  useEffect(() => { if (booking) void completePendingAnalytics(booking, embedded); }, [booking, embedded]);
  const [timezone, setTimezone] = useState<string>();
  const hostTimezone = booking?.host.timezone;
  useEffect(() => { if (hostTimezone) setTimezone(deviceTimezone(hostTimezone)); }, [hostTimezone]);
  const [notice, setNotice] = useState(""), [rescheduling, setRescheduling] = useState(false), [working, setWorking] = useState(false), [pending, setPending] = useState(false);
  const hydrated = useHydrated(), refreshEpoch = useRef(0), cancelling = useRef(false);
  useEffect(() => { if (booking?.rescheduleRequest) setRescheduling(!booking.rescheduleRequest.archiveHistorical && booking.rescheduleRequest.state === "open"); }, [booking?.rescheduleRequest?.id, booking?.rescheduleRequest?.state]);
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
  const requestOpen = !booking.rescheduleRequest?.archiveHistorical && booking.rescheduleRequest?.state === "open";
  const rescheduleAllowed = requestOpen || booking.changePolicy?.rescheduleAllowed !== false;
  const cancellationAllowed = booking.changePolicy?.cancellationAllowed !== false;
  async function cancel(reason: string) {
    if (!cancellationAllowed || working || pending || cancelling.current) return;
    cancelling.current = true; refreshEpoch.current++; setWorking(true); setNotice("");
    try {
      const response = await publicApi.api.public.manage[":token"].cancel.$post({ param: { token }, json: { reason: reason || undefined } });
      if (response.ok) { const cancelled = await response.json() as Confirmation; focusResult.current = true; setBooking(cancelled); setCancelOpen(false); setRescheduling(false); setNotice("This booking has been cancelled."); }
      else setNotice(await errorMessage(response));
    } catch { setNotice("The result could not be received. Retry to check the same booking."); }
    finally { cancelling.current = false; setWorking(false); }
  }
  if(booking.approval)return <PublicTheme><PublicHeader embedded={embedded}/><main className="pb-recovery pb-manage"><ApprovalStatus booking={booking} disabled={!hydrated||working} onRefresh={()=>{setWorking(true);void publicApi.api.public.manage[":token"].$get({param:{token}}).then(async response=>{if(response.ok)setBooking(await response.json() as Confirmation);else setNotice(await errorMessage(response));}).catch(()=>setNotice("The approval status could not be checked.")).finally(()=>setWorking(false));}}/>{notice?<p role="status">{notice}</p>:null}</main><PublicFooter embedded={embedded}/></PublicTheme>;
  return <PublicTheme><PublicHeader embedded={embedded} /><main aria-busy={!hydrated || working} className={`pb-recovery pb-manage ${embedded ? "pb-event-embedded" : ""}`}><section><p className="pb-eyebrow">Manage booking</p><h1>{booking.event.eventTitle}</h1>{booking.lockedTimezone ? <><LockedTimezoneNotice timezone={booking.lockedTimezone} /><LockedBookingTime startAt={booking.occurrence.startAt} endAt={booking.occurrence.endAt} timezone={booking.lockedTimezone} browserTimezone={browserTimezone} /></> : <p>{booking.state === "cancelled" ? "Cancelled time: " : requestOpen && booking.rescheduleRequest?.releaseTime ? "Original time: " : "Currently: "}{formatRange(booking.occurrence.startAt, booking.occurrence.endAt, displayTimezone)}</p>}{!booking.lockedTimezone && !rescheduling ? <p>Times in <strong>{displayTimezone}</strong></p> : null}{booking.payment ? <PaymentSummary payment={booking.payment} timezone={displayTimezone} open={booking.state !== "cancelled"} /> : null}{booking.entitlement ? <section className="pb-payment-summary" aria-label="Appointment credit"><h2>Appointment credit</h2><CreditLedger credit={booking.entitlement} /></section> : null}{!requestOpen ? <ManageChangeTerms decision={booking.changePolicy} timezone={displayTimezone} locked={Boolean(booking.lockedTimezone)} /> : null}<ManageGuests key={token} token={token} booking={booking} disabled={!hydrated||working||pending} onChanged={setBooking} /><ManageRescheduleRequest booking={booking} timezone={displayTimezone} />{notice || booking.state === "cancelled" ? <p ref={resultElement} tabIndex={-1} role="status">{notice || "This booking has been cancelled."}</p> : null}{booking.state !== "cancelled" ? <><div className="pb-request-actions">{cancellationAllowed ? <button ref={cancelButton} type="button" className="pb-secondary-button" disabled={!hydrated || working || pending} aria-expanded={cancelOpen} onClick={() => { setCancelOpen(true); setRescheduling(false); }}>Cancel booking</button> : null}{rescheduleAllowed ? <button type="button" className="pb-secondary-button" disabled={!hydrated || working || pending} onClick={() => { refreshEpoch.current++; setCancelOpen(false); setRescheduling(true); }}>Reschedule booking</button> : null}</div>{cancelOpen && cancellationAllowed ? <ManageCancel payment={booking.payment} disabled={!hydrated || working || pending} onConfirm={reason => void cancel(reason)} onKeep={() => { setCancelOpen(false); cancelButton.current?.focus(); }} /> : null}{!rescheduleAllowed || !cancellationAllowed ? <ContactHost key={token} token={token} /> : null}{!cancelOpen && (rescheduling || requestOpen) && rescheduleAllowed ? <ManageReschedule key={`${booking.occurrence.startAt}:${booking.rescheduleRequest?.id ?? ""}`} token={token} booking={booking} timezone={booking.lockedTimezone ? browserTimezone ?? "" : displayTimezone} onTimezoneChange={setTimezone} onBusy={setWorking} onPending={setPending} onBooked={value => { focusResult.current = true; setBooking(value); setPending(false); setRescheduling(false); setNotice("Your booking has been rescheduled."); }} /> : null}</> : null}</section></main><PublicFooter embedded={embedded} /></PublicTheme>;
}
