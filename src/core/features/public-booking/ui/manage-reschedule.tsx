import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, publicApi } from "../../../api/client";
import { useDocumentInstant } from "../../../app/document-data";
import { DayTimePicker } from "./day-time-picker";
import { dateInZone, dayLabel, shiftHostDate, type PickerAvailability, type PickerSlot } from "./day-picker-model";
import { TimezoneControl } from "./timezone-control";
import { RequestOrder } from "./request-order";
import { format } from "./flow-shell";
import type { PublicSelection } from "./selection-types";
import type { Confirmation } from "./types";

type Change = { nonce: string; startAt: string; inviteeTimezone: string; reason?: string };
export function ManageReschedule({ token, booking, reason, onBooked, onBusy, onPending }: { token: string; booking: Confirmation; reason: string; onBooked: (booking: Confirmation) => void; onBusy: (busy: boolean) => void; onPending: (pending: boolean) => void }) {
  const instant = useDocumentInstant();
  const [timezone, setTimezone] = useState(booking.inviteeTimezone), [week, setWeek] = useState<string>(), [day, setDay] = useState<string>();
  const [availability, setAvailability] = useState<PickerAvailability>(), [selection, setSelection] = useState<PublicSelection>();
  const [checking, setChecking] = useState(false), [working, setWorking] = useState(false), [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  const reads = useRef(new RequestOrder()), selections = useRef(new RequestOrder()), posting = useRef(false), attempt = useRef<Change | undefined>(undefined), uncertain = useRef(false);
  const today = dateInZone(instant, booking.host.timezone);
  const refresh = useCallback(async () => {
    const current = reads.current.begin(); setChecking(true); setNotice("");
    try {
      const response = await publicApi.api.public.manage[":token"].reschedule.availability.$get({ param: { token }, query: { inviteeTimezone: timezone, ...(week ? { week } : {}) } });
      if (!current()) return;
      if (response.ok) { const value = await response.json() as PickerAvailability; if (current()) setAvailability(value); }
      else { const message = await errorMessage(response); if (current()) { setAvailability(undefined); setNotice(message); } }
    } catch { if (current()) { setAvailability(undefined); setNotice("Available times could not be checked. Please retry."); } }
    finally { if (current()) setChecking(false); }
  }, [token, timezone, week]);
  useEffect(() => { void refresh(); const order = reads.current; return () => order.invalidate(); }, [refresh]);
  useEffect(() => { const order = selections.current; return () => order.invalidate(); }, []);
  function change(clear: () => void) { if (attempt.current || posting.current) return; selections.current.invalidate(); setSelection(undefined); clear(); }
  async function select(slot: PickerSlot) {
    if (posting.current || checking || attempt.current) return;
    const current = selections.current.begin(); posting.current = true; setWorking(true); onBusy(true); setNotice("");
    try {
      const response = await publicApi.api.public.manage[":token"].reschedule.selection.$post({ param: { token }, json: { startAt: slot.startAt, inviteeTimezone: timezone } });
      if (!current()) return;
      if (response.ok) { const value = await response.json() as PublicSelection; if (current()) setSelection(value); }
      else { const message = await errorMessage(response); if (current()) { setSelection(undefined); if (response.status === 409) await refresh(); setNotice(message); } }
    } catch { if (current()) setNotice("That time could not be checked. Please choose it again."); }
    finally { posting.current = false; setWorking(false); onBusy(false); }
  }
  async function confirm() {
    if (!selection || posting.current) return;
    attempt.current ??= { nonce: selection.nonce, startAt: selection.selection.startAt, inviteeTimezone: selection.selection.inviteeTimezone, reason: reason || undefined };
    setPending(true); onPending(true);
    posting.current = true; setWorking(true); onBusy(true); setNotice("");
    try {
      const response = await publicApi.api.public.manage[":token"].reschedule.$post({ param: { token }, json: attempt.current });
      if (response.ok) { onBooked(await response.json() as Confirmation); return; }
      const message = await errorMessage(response);
      if (!uncertain.current && response.status >= 400 && response.status < 500) { attempt.current = undefined; setPending(false); onPending(false); setSelection(undefined); await refresh(); }
      if (response.status >= 500) uncertain.current = true;
      setNotice(message);
    } catch { uncertain.current = true; setNotice("The result could not be received. Confirm again to retrieve the same reschedule; your original booking stays visible until its result is verified."); }
    finally { posting.current = false; setWorking(false); onBusy(false); }
  }
  const blocked = working || checking || pending;
  return <div className="pb-manage-picker"><h2>Choose a new day and time</h2><p>Currently: {format(booking.occurrence.startAt, booking.inviteeTimezone)}, {booking.inviteeTimezone}</p><p>Your current time stays reserved until the new booking is confirmed.</p><TimezoneControl timezone={timezone} hostTimezone={booking.host.timezone} disabled={blocked} onChange={zone => change(() => { setTimezone(zone); setDay(undefined); })} />{checking ? <p role="status">Checking current times…</p> : null}{availability?.state === "available" ? <><nav className="pb-week-navigation" aria-label="Reschedule week"><button type="button" className="pb-secondary-button" disabled={blocked || availability.week <= today} onClick={() => change(() => { setWeek(shiftHostDate(availability.week, -7) < today ? today : shiftHostDate(availability.week, -7)); setDay(undefined); })}>Previous week</button><p>{dayLabel(availability.week)} – {dayLabel(shiftHostDate(availability.week, 6))}</p><button type="button" className="pb-secondary-button" disabled={blocked} onClick={() => change(() => { setWeek(shiftHostDate(availability.week, 7)); setDay(undefined); })}>Next week</button></nav><DayTimePicker availability={availability} timezone={timezone} hostTimezone={booking.host.timezone} selectedDay={day} onDay={value => change(() => setDay(value))} onSelect={slot => void select(slot)} disabled={blocked} /></> : !checking ? <div><p>{availability?.state === "temporarily_unavailable" ? "The connected calendar cannot be read, so no time is offered." : "No verified time can be offered right now."}</p><button type="button" className="pb-secondary-button" disabled={working || pending} onClick={() => void refresh()}>Reload times</button></div> : null}{selection ? <div className="pb-reschedule-review"><p>New time: {format(selection.selection.startAt, selection.selection.inviteeTimezone)}, {selection.selection.inviteeTimezone}</p><button type="button" className="pb-primary-button" disabled={working} onClick={() => void confirm()}>Confirm reschedule</button></div> : null}{notice ? <p role="status">{notice}</p> : null}</div>;
}
