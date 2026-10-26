import { FocusDialog } from "../../../app/ui/focus-dialog";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorMessage } from "../../../api/client";
import { useHydrated } from "../../../app/use-hydrated";
import { Badge, Button, Input, Select } from "../../../app/ui/primitives";
import type { BookingRecord } from "../types";
import { localInput, resolveOperatorTime, startTime, timeRange } from "./operator-time";
import { RescheduleRequestForm } from "./reschedule-request-form";
import { CancelBookingForm } from "./cancel-booking-form";

type Props = { booking: BookingRecord; onChanged(notice?: string): Promise<void>; onCancel(id: string): Promise<void>; renderActions(primary: ReactNode, advanced: ReactNode): ReactNode };

export function BookingChanges({ booking, onChanged, onCancel, renderActions }: Props) {
  const hydrated = useHydrated();
  const returnFocus = useRef<HTMLElement | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [futureStart, setFutureStart] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { setFutureStart(Date.parse(booking.occurrence.startAt) > Date.now()); }, [booking.occurrence.startAt]);
  useEffect(() => {
    if (!working && returnFocus.current) {
      if (returnFocus.current.isConnected) returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [working]);
  async function restore(conflictId: string) {
    setWorking(true); setNotice("");
    try {
      const response = await api.api.app.bookings[":id"]["calendar-conflicts"][":conflictId"].restore.$post({ param: { id: booking.id, conflictId } });
      if (!response.ok) { setNotice(await errorMessage(response)); return; }
      await onChanged("Restore queued. Calendar delivery is pending."); setConflictsOpen(false);
    } catch { setNotice("Restoration could not be checked. Refresh the booking before trying again."); }
    finally { setWorking(false); }
  }
  async function cancel() {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setWorking(true); setNotice("");
    try {
      const response = await api.api.app.bookings[":id"].money.$get({ param: { id: booking.id } });
      if (!response.ok) { setNotice(await errorMessage(response)); return; }
      const { money } = await response.json() as { money: BookingRecord["money"] | null };
      if (money) { setEditing(false); setRequesting(false); setConflictsOpen(false); setCancelling(current => !current); }
      else await onCancel(booking.id);
    }
    catch { setNotice("Cancellation could not be checked. Refresh the booking before trying again."); }
    finally { setWorking(false); }
  }
  return <fieldset disabled={!hydrated || working} className="mt-6 grid gap-5 border-0 p-0">
    {booking.calendarConflicts.length ? <>{conflictsOpen ? <FocusDialog title="Calendar conflicts" onClose={() => setConflictsOpen(false)}><section aria-labelledby={`conflicts-${booking.id}`} className="grid gap-4 rounded-xl border border-[#e6d5ae] bg-[#fff8e9] p-4">
      <h3 id={`conflicts-${booking.id}`} className="font-semibold">Conflict details</h3>
      <p className="text-sm text-[#755010]">The calendar was edited outside Dial. The booking time is preserved.</p>
      <p className="text-sm text-muted">Host times in {booking.hostTimezone}{booking.inviteeTimezone !== booking.hostTimezone ? `; invitee times in ${booking.inviteeTimezone}` : ""}.</p>
      {booking.calendarConflicts.map((conflict) => {
        const current = conflict.occurrenceId === booking.occurrence.id;
        const actionable = current && conflict.state === "open" && booking.state !== "cancelled";
        return <article key={conflict.id} className="grid min-w-0 gap-3 border-t border-[#e6d5ae] pt-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={actionable ? "warning" : "neutral"}>{!current ? "Previous booking time" : conflict.state === "restored" ? "Restoration requested" : conflict.state}</Badge></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><h4 className="font-semibold">Booking time</h4><p>Host: {timeRange(conflict.canonicalStartAt, conflict.canonicalEndAt, booking.hostTimezone)}</p>{booking.inviteeTimezone !== booking.hostTimezone ? <p>Invitee: {timeRange(conflict.canonicalStartAt, conflict.canonicalEndAt, booking.inviteeTimezone)}</p> : null}<p className="mt-2 break-words"><strong>Booking location: </strong>{conflict.canonicalLocation || "No location"}</p></div>
            <div><h4 className="font-semibold">Calendar time</h4><p>Host: {timeRange(conflict.externalStartAt, conflict.externalEndAt, booking.hostTimezone)}</p>{booking.inviteeTimezone !== booking.hostTimezone ? <p>Invitee: {timeRange(conflict.externalStartAt, conflict.externalEndAt, booking.inviteeTimezone)}</p> : null}<p className="mt-2 break-words"><strong>Calendar location: </strong>{conflict.externalLocation ?? "Not provided by calendar"}</p></div>
          </div>
          {actionable ? <div className="flex flex-wrap gap-3"><Button variant="secondary" type="button" onClick={() => void restore(conflict.id)}>Restore booking time</Button><Button variant="danger" type="button" onClick={() => void cancel()}>Cancel booking instead</Button></div> : null}
        </article>;
      })}
    </section></FocusDialog> : null}</> : null}
    {notice ? <p role="status" className="text-sm text-[#755010]">{notice}</p> : null}
    {renderActions(
      booking.state !== "cancelled" && futureStart ? <Button variant="secondary" type="button" disabled={!booking.eventTypeId} onClick={() => { setRequesting(false); setCancelling(false); setEditing(current => !current); }}>Reschedule booking</Button> : null,
      <>
        {booking.calendarConflicts.length ? <Button type="button" variant="secondary" onClick={() => setConflictsOpen(true)}>Review calendar conflicts</Button> : null}
        {booking.state !== "cancelled" ? <>
          {!futureStart ? <Button variant="secondary" type="button" disabled={!booking.eventTypeId} onClick={() => { setRequesting(false); setCancelling(false); setEditing(current => !current); }}>Reschedule booking</Button> : null}
          {hydrated && booking.eventTypeId && futureStart && (booking.rescheduleRequest?.archiveHistorical || booking.rescheduleRequest?.state !== "open") ? <Button variant="secondary" type="button" aria-expanded={requesting} onClick={() => { setEditing(false); setCancelling(false); setRequesting(current => !current); }}>Ask invitee to pick a new time</Button> : null}
          <Button variant="danger" type="button" aria-expanded={cancelling} onClick={() => void cancel()}>Cancel booking</Button>
        </> : null}
      </>
    )}
    {cancelling && booking.state !== "cancelled" ? <CancelBookingForm booking={booking} onWorking={setWorking} onClose={() => setCancelling(false)} onCancelled={async notice => { setCancelling(false); await onChanged(notice); }} /> : null}
    {editing && booking.state !== "cancelled" ? <RescheduleForm booking={booking} onWorking={setWorking} onChanged={async () => { setEditing(false); await onChanged("Reschedule saved. Calendar and notifications queued."); }} /> : null}
    {requesting && booking.state !== "cancelled" && (booking.rescheduleRequest?.archiveHistorical || booking.rescheduleRequest?.state !== "open") ? <RescheduleRequestForm booking={booking} onWorking={setWorking} onChanged={async () => { setRequesting(false); await onChanged("Reschedule request sent. Invitee email queued."); }} /> : null}
  </fieldset>;
}

function RescheduleForm({ booking, onChanged, onWorking }: Pick<Props, "booking" | "onChanged"> & { onWorking(working: boolean): void }) {
  const [timezone, setTimezone] = useState(booking.hostTimezone);
  const [startLocal, setStartLocal] = useState(localInput(booking.occurrence.startAt, booking.hostTimezone));
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const candidates = useMemo(() => resolveOperatorTime(startLocal, timezone), [startLocal, timezone]);
  const selected = candidates.length === 1 ? candidates[0]?.instant : candidates.find((entry) => entry.instant === choice)?.instant;
  const zones = useMemo(() => [...new Set([booking.hostTimezone, booking.inviteeTimezone, "UTC", ...Intl.supportedValuesOf("timeZone")])], [booking.hostTimezone, booking.inviteeTimezone]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || selected === booking.occurrence.startAt) return;
    setWorking(true); onWorking(true); setNotice("");
    try {
      const response = await api.api.app.bookings[":id"].reschedule.$post({ param: { id: booking.id }, json: { startAt: selected, inviteeTimezone: booking.inviteeTimezone, reason: reason || undefined, overridePublishedAvailability: override } });
      if (!response.ok) { setNotice(await errorMessage(response)); return; }
      await onChanged();
    } catch { setNotice("Reschedule could not be checked. Refresh the booking before trying again."); }
    finally { setWorking(false); onWorking(false); }
  }
  return <form onSubmit={(event) => void submit(event)} className="rounded-xl border border-line bg-row p-4">
    <h3 className="font-semibold">Choose a new booking time</h3>
    <fieldset disabled={working} className="mt-4 grid gap-4 border-0 p-0 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-semibold">Time zone<Select aria-label="Time zone" value={timezone} onChange={(event) => { setNotice(""); setTimezone(event.target.value); setStartLocal(localInput(booking.occurrence.startAt, event.target.value)); setChoice(""); }}>{zones.map((zone) => <option key={zone}>{zone}</option>)}</Select></label>
      <label className="grid gap-2 text-sm font-semibold">New start time<Input type="datetime-local" step={60} value={startLocal} onChange={(event) => { setNotice(""); setStartLocal(event.target.value); setChoice(""); }} required /></label>
      {candidates.length > 1 ? <label className="grid gap-2 text-sm font-semibold sm:col-span-2">Repeated time<Select aria-label="Repeated time" value={choice} onChange={(event) => { setNotice(""); setChoice(event.target.value); }} required><option value="">Choose the UTC offset</option>{candidates.map((entry) => <option value={entry.instant} key={entry.instant}>{entry.label}</option>)}</Select></label> : null}
      {candidates.length > 1 && !choice ? <p role="alert" className="text-sm text-[#755010] sm:col-span-2">This time occurs twice. Choose a UTC offset.</p> : null}
      {startLocal && candidates.length === 0 ? <p role="alert" className="text-sm text-[#a54038] sm:col-span-2">This time does not exist in {timezone}. Choose another time.</p> : null}
      {selected ? <div className="grid gap-2 text-sm sm:col-span-2"><p><strong>New host start: </strong>{startTime(selected, booking.hostTimezone)}</p><p><strong>New invitee start: </strong>{startTime(selected, booking.inviteeTimezone)}</p></div> : null}
      <label className="grid gap-2 text-sm font-semibold sm:col-span-2">Reason (optional)<Input value={reason} maxLength={500} onChange={(event) => { setNotice(""); setReason(event.target.value); }} /></label>
      <p className="text-sm text-muted sm:col-span-2">The editing time zone does not change the invitee’s zone: {booking.inviteeTimezone}.</p>
      <label className="flex items-start gap-3 rounded-xl bg-[#fff4dd] p-3 text-sm text-[#755010] sm:col-span-2"><input type="checkbox" checked={override} onChange={(event) => { setNotice(""); setOverride(event.target.checked); }} />Override published availability, minimum notice and booking horizon. Calendar conflicts and buffers are always checked.</label>
      {notice ? <p role="alert" className="text-sm text-[#a54038] sm:col-span-2">{notice}</p> : null}
      <Button type="submit" disabled={!selected || selected === booking.occurrence.startAt}>{working ? "Saving reschedule…" : "Confirm reschedule"}</Button>
    </fieldset>
  </form>;
}
