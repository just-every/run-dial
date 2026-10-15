import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { RequestOrder } from "./request-order";
import { bookingPath } from "./navigation";
import { errorMessage, publicApi } from "../../../api/client";
import { TimezoneControl } from "./timezone-control";
import { deviceTimezone } from "./timezone-search";
import { useDocumentInstant } from "../../../app/document-data";
import { FlowShell } from "./flow-shell";
import type { PublicEventPayload } from "./types";
import type { PublicSelection } from "./selection-types";
import { rememberSelection } from "./selection-storage";
import { readRecoveryDraft } from "./booking-recovery-draft";
import { isCanonicalIanaTimeZone } from "../../../shared/scheduling";
import { DayTimePicker } from "./day-time-picker";
import { shiftHostDate, dateInZone, dayLabel, type PickerSlot as Slot, type PickerAvailability as Availability } from "./day-picker-model";

export function ChooseTime({ data, embedded = false, preview = false }: { data: PublicEventPayload; embedded?: boolean; preview?: boolean }) {
  const reads = useRef(new RequestOrder()), selectionReads = useRef(new RequestOrder()), selectingNow = useRef(false);
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const [availability, setAvailability] = useState<Availability>();
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  const [week, setWeek] = useState<string>();
  const [inviteeTimezone, setInviteeTimezone] = useState<string>();
  const [selecting, setSelecting] = useState<string>();
  const [localTimezone, setLocalTimezone] = useState(data.profile.timezone);
  const [selectedDay, setSelectedDay] = useState<string>();
  const [hasRecoveryDraft, setHasRecoveryDraft] = useState(false);
  const instant = useDocumentInstant();
  const [today] = useState(() => dateInZone(instant, data.profile.timezone));
  const displayTimezone = inviteeTimezone ?? localTimezone;
  useEffect(() => {
    const restore = () => {
      const query = new URLSearchParams(window.location.search);
      setHasRecoveryDraft(Boolean(readRecoveryDraft(data.profile.handle, data.eventType.slug)));
      const savedZone = query.get("timezone");
      const zone = savedZone && isCanonicalIanaTimeZone(savedZone) ? savedZone : deviceTimezone(data.profile.timezone);
      setLocalTimezone(zone);
      setInviteeTimezone(savedZone && isCanonicalIanaTimeZone(savedZone) ? savedZone : undefined);
      setWeek(query.get("week") ?? undefined); setSelectedDay(query.get("day") ?? undefined);
    };
    restore(); window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [data.profile.handle, data.profile.timezone, data.eventType.slug]);
  function remember(patch: Record<string, string>) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(patch)) url.searchParams.set(key, value);
    window.history.pushState(null, "", url);
  }
  const refreshAvailability = useCallback(async (nextWeek = week) => {
    if (preview) return;
    const currentRead = reads.current.begin();
    setNotice(""); setChecking(true);
    const query = { ...(nextWeek ? { week: nextWeek } : {}), ...(inviteeTimezone ? { inviteeTimezone } : {}) };
    try {
      const response = await publicApi.api.public.book[":handle"][":slug"].availability.$get({ param: { handle: data.profile.handle, slug: data.eventType.slug }, query });
      if (response.ok) { const received = await response.json() as Availability; if (currentRead()) setAvailability(received); return; }
      const message = await errorMessage(response); if (currentRead()) { setAvailability(undefined); setNotice(message); }
    } catch { if (currentRead()) { setAvailability(undefined); setNotice("Availability could not be checked. Please retry."); } }
    finally { if (currentRead()) setChecking(false); }

  }, [data.eventType.slug, data.profile.handle, inviteeTimezone, preview, week]);
  useEffect(() => { const order = reads.current; void refreshAvailability(); return () => { order.invalidate(); }; }, [refreshAvailability]);

  useEffect(() => { const order = selectionReads.current; return () => { order.invalidate(); }; }, [data.profile.handle, data.eventType.slug, displayTimezone]);

  async function select(slot: Slot) {
    if (selectingNow.current || checking) return;
    const currentSelection = selectionReads.current.begin();
    selectingNow.current = true;
    setSelecting(slot.startAt); setNotice("");
    try {
      const response = await publicApi.api.public.book[":handle"][":slug"].selection.$post({ param: { handle: data.profile.handle, slug: data.eventType.slug }, json: { startAt: slot.startAt, inviteeTimezone: displayTimezone } });
      if (!currentSelection()) return;
      if (!response.ok) {
        if (response.status === 409) { await refreshAvailability(); if (currentSelection()) setNotice("That time is no longer available. Choose from the current times."); return; }
        const message = await errorMessage(response); if (currentSelection()) setNotice(message); return;
      }
      const selected = await response.json() as PublicSelection;
      if (!currentSelection()) return;
      rememberSelection(data.profile.handle, data.eventType.slug, selected);
      window.location.assign(bookingPath(data.profile.handle, data.eventType.slug, "/details", embedded, { nonce: selected.nonce, startAt: selected.selection.startAt, inviteeTimezone: selected.selection.inviteeTimezone, day: dateInZone(slot.startAt, displayTimezone), timezone: displayTimezone, ...(availability?.state === "available" ? { week: availability.week } : {}) }, window.location.search));
    } catch { if (currentSelection()) setNotice("That time could not be checked. Please retry."); }
    finally { selectingNow.current = false; setSelecting(undefined); }
  }

  const shownWeek = week ?? (availability?.state === "available" ? availability.week : undefined);
  const changeWeek = (days: number) => { if (shownWeek) { const next = days < 0 && shiftHostDate(shownWeek, days) < today ? today : shiftHostDate(shownWeek, days); setWeek(next); setSelectedDay(undefined); setInviteeTimezone(displayTimezone); remember({ week: next, timezone: displayTimezone, day: "" }); } };
  return <FlowShell data={data} embedded={embedded} step={1}>
    {preview ? <p className="pb-preview-banner">Operator preview — providers are not used from preview.</p> : null}
    <div className="pb-event-heading"><div><p className="pb-eyebrow">{data.eventType.title} · {data.eventType.durationMinutes} minutes</p><h1>Choose a day and time.</h1><p>Times are checked against the host’s availability before confirmation.</p></div></div>
    {new URLSearchParams(search).get("notice") === "slot_changed" ? <p className="pb-request-notice" role="status">That time was just taken. Choose another time.{hasRecoveryDraft ? " Your details are saved for this booking." : null}</p> : null}
    <TimezoneControl timezone={displayTimezone} hostTimezone={data.profile.timezone} disabled={Boolean(selecting)} onChange={zone => { setInviteeTimezone(zone); remember({ timezone: zone }); }} />
    {checking ? <p role="status">Checking current times…</p> : null}
    {availability?.state === "available" ? <><section className="pb-week-navigation" aria-label="Availability week"><button type="button" className="pb-secondary-button" disabled={Boolean(selecting) || availability.week <= today} onClick={() => changeWeek(-7)}>Previous week</button><p>{dayLabel(availability.week)} – {dayLabel(shiftHostDate(availability.week, 6))}</p><button type="button" className="pb-secondary-button" disabled={Boolean(selecting) || shiftHostDate(availability.week, 7) > shiftHostDate(today, data.eventType.bookingHorizonDays)} onClick={() => changeWeek(7)}>Next week</button></section><DayTimePicker availability={availability} timezone={displayTimezone} hostTimezone={data.profile.timezone} selectedDay={selectedDay} onDay={day => { setSelectedDay(day); remember({ day, timezone: displayTimezone, week: availability.week }); }} onSelect={slot => void select(slot)} disabled={Boolean(selecting) || checking} /></> : <section className="pb-unavailable" aria-live="polite"><div><p className="pb-eyebrow">{availability || notice ? "Booking temporarily unavailable" : "Availability"}</p><h2>{availability || notice ? "Times cannot be verified right now." : "Checking available times…"}</h2><p>{availability?.state === "temporarily_unavailable" ? "Availability cannot be verified, so no time is offered." : notice ? "Please retry when availability can be checked." : "This page will update when availability has been checked."}</p></div></section>}
    {data.eventType.alternativeRequestsEnabled ? <a className="pb-quiet-link" href={bookingPath(data.profile.handle, data.eventType.slug, "/request", embedded, {}, search)}>None of these work?</a> : null}
    {notice ? <p className="pb-request-notice" role="status">{notice} <button type="button" className="pb-quiet-button" disabled={Boolean(selecting)} onClick={() => void refreshAvailability()}>Reload times</button></p> : null}
  </FlowShell>;
}
