import { HostAvatar } from "../../host-profile";
import { format, formatTime } from "./flow-shell";
import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useDocumentData } from "../../../app/document-data";
import { publicApi } from "../../../api/client";
import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";
import { PublicRecoveryPage } from "./recovery-page";
import { embedManageUrl } from "./navigation";
import type { Confirmation } from "./types";

export function BookingConfirmationPage({ token, embedded = false }: { token: string; embedded?: boolean }) {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const [booking, setBooking] = useState<Confirmation | undefined>(useDocumentData<Confirmation>());
  const [unavailable, setUnavailable] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const refreshReceipt = useCallback(async () => {
    try {
      const response = await publicApi.api.public.manage[":token"].$get({ param: { token } });
      if (response.ok) { setBooking(await response.json() as Confirmation); setRefreshError(false); return; }
      if ([403, 404, 410].includes(response.status)) setUnavailable(true);
      else setRefreshError(true);
    } catch { setRefreshError(true); }
  }, [token]);
  useEffect(() => { void refreshReceipt(); }, [refreshReceipt]);
  useEffect(() => {
    if (!booking || !isPending(booking) || refreshError) return;
    const timer = window.setTimeout(() => { void refreshReceipt(); }, 4_000);
    return () => window.clearTimeout(timer);
  }, [booking, refreshError, refreshReceipt]);
  if (unavailable) return <PublicRecoveryPage kind="booking" />;
  if (!booking) return <PublicTheme><PublicHeader embedded={embedded} step={3} /><main className="pb-loading">{refreshError ? <><p>Your receipt could not be loaded.</p><button className="pb-secondary-button" onClick={() => void refreshReceipt()}>Reload receipt</button></> : "Retrieving your booking receipt…"}</main></PublicTheme>;
  const cancelled = booking.state === "cancelled";
  const manage = embedded ? embedManageUrl(booking.manageUrl, search) : booking.manageUrl;
  const joinUrl = safeJoiningUrl(booking.location.value);
  const setupNotice = booking.calendarState === "failed" || booking.meetingState === "failed"
    ? "Calendar setup is incomplete. Your booking is confirmed; contact the host for help."
    : isPending(booking) ? "Your booking is confirmed. Calendar and joining details are still being prepared. Your joining link will arrive by email." : undefined;
  return <PublicTheme><PublicHeader embedded={embedded} step={cancelled ? undefined : 3} /><main className="pb-recovery"><section>
    <HostAvatar name={booking.host.name} avatarKey={booking.host.avatarKey} className="pb-avatar" />
    <p className="pb-eyebrow">{cancelled ? "Booking cancelled" : "Booking receipt"}</p>
    <h1>{cancelled ? "This booking is cancelled." : "Booking confirmed."}</h1>
    <p>{booking.event.eventTitle} with {booking.host.name}</p>
    <p>{format(booking.occurrence.startAt, booking.inviteeTimezone)} – {formatTime(booking.occurrence.endAt, booking.inviteeTimezone)} · {booking.inviteeTimezone} · {booking.event.durationMinutes} minutes</p>
    <p>Host time: {format(booking.occurrence.startAt, booking.host.timezone)} – {formatTime(booking.occurrence.endAt, booking.host.timezone)} · {booking.host.timezone}</p>
    {!cancelled && booking.location.state === "ready" ? <p>{booking.location.label}{booking.location.value && !joinUrl ? <>: {booking.location.value}</> : null}</p> : null}
    {!cancelled && booking.location.state === "ready" && joinUrl ? <a className="pb-primary-link" href={joinUrl}>Join session</a> : null}
    {(!cancelled && setupNotice) || refreshError ? <p className="pb-request-notice" role="status">{!cancelled ? setupNotice : null}{refreshError ? <> These are your last verified details. <button className="pb-quiet-button" onClick={() => void refreshReceipt()}>Reload receipt</button></> : null}</p> : null}
    <p className="pb-receipt-actions"><a className="pb-receipt-link" href={booking.icsUrl}>{cancelled ? "Download cancellation" : "Add to calendar"}</a> · <a className="pb-receipt-link" href={manage}>Manage booking</a></p>
  </section></main><PublicFooter embedded={embedded} /></PublicTheme>;
}

function isPending(booking: Confirmation) { return booking.calendarState === "pending" || booking.meetingState === "pending"; }
function safeJoiningUrl(value?: string) {
  if (!value) return undefined;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}
