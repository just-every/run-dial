import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { stableJson } from "../../../shared/stable-json";
import { api, errorMessage } from "../../../api/client";
import { useHydrated } from "../../../app/use-hydrated";
import { PageHeader } from "../../../app/ui/page-header";
import { Button, Card, Input, Select, buttonClassName, noticeClassName } from "../../../app/ui/primitives";
import type { EventTypeRecord } from "../../event-types";
import type { OperatorRequest } from "../../availability-requests";
import { OperatorQuestion } from "./operator-question";
import { localInput, resolveOperatorTime, startTime } from "./operator-time";

export function CreateBookingPage() {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const requestId = useMemo(() => new URLSearchParams(search).get("requestId") ?? undefined, [search]);
  return <CreateBookingForm key={requestId ?? "independent"} requestId={requestId} />;
}

function CreateBookingForm({ requestId }: { requestId?: string }) {
  const hydrated = useHydrated();
  const navigate = useNavigate();
  const [timezone, setTimezone] = useState("UTC");
  const [inviteeTimezone, setInviteeTimezone] = useState("UTC");
  const [hostTimezone, setHostTimezone] = useState<string | null>();
  const [events, setEvents] = useState<EventTypeRecord[]>();
  const [request, setRequest] = useState<OperatorRequest>();
  const [eventTypeId, setEventTypeId] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [overrideNoticeAndHorizon, setOverrideNoticeAndHorizon] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const creationAttempt = useRef<{ key: string; fingerprint: string } | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      try {
        const [eventResponse, profileResponse] = await Promise.all([api.api.app["event-types"].$get({}), api.api.app.profile.$get()]);
        if (!eventResponse.ok || !profileResponse.ok) { setNotice(await errorMessage(!eventResponse.ok ? eventResponse : profileResponse)); return; }
        const next = await eventResponse.json();
        setEvents(next); setEventTypeId((current) => current || next[0]?.id || "");
        const profile = await profileResponse.json();
        setHostTimezone(profile?.timezone ?? null);
        if (profile) { setTimezone(profile.timezone); if (!requestId) setInviteeTimezone(profile.timezone); }
        if (requestId) {
          const response = await api.api.app["availability-requests"][":id"].$get({ param: { id: requestId } });
          if (!response.ok) { setNotice(await errorMessage(response)); return; }
          const nextRequest = await response.json();
          setRequest(nextRequest); setEventTypeId(nextRequest.eventTypeId);
          setName(nextRequest.inviteeName); setEmail(nextRequest.inviteeEmail); setInviteeTimezone(nextRequest.inviteeTimezone);
        }
      } catch { setNotice("The booking form could not be loaded. Refresh to try again."); }
    })();
  }, [requestId]);
  const event = events?.find((entry) => entry.id === eventTypeId);
  const candidates = useMemo(() => resolveOperatorTime(startLocal, timezone), [startLocal, timezone]);
  const selected = candidates.length === 1 ? candidates[0]?.instant : candidates.find((entry) => entry.instant === choice)?.instant;
  const zones = useMemo(() => [...new Set([timezone, inviteeTimezone, ...(hostTimezone ? [hostTimezone] : []), "UTC", ...Intl.supportedValuesOf("timeZone")])], [timezone, inviteeTimezone, hostTimezone]);
  const ready = Boolean(event && hostTimezone && (!requestId || (request?.id === requestId && request.state === "submitted")));
  async function create(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!ready || !selected || saving) return;
    setSaving(true); setNotice("");
    try {
      const payload = { ...(requestId ? { requestId } : {}), eventTypeId, startAt: selected, inviteeTimezone, name, email, answers, overrideNoticeAndHorizon };
      const fingerprint = stableJson({ ...payload, name: payload.name.trim(), email: payload.email.trim().toLowerCase() });
      if (creationAttempt.current?.fingerprint !== fingerprint) creationAttempt.current = { key: crypto.randomUUID(), fingerprint };
      const response = await api.api.app.bookings.$post({ json: { ...payload, idempotencyKey: creationAttempt.current.key } });
      if (!response.ok) { setNotice(`This booking cannot be created. ${await errorMessage(response)}`); return; }
      await navigate({ to: "/app/bookings" });
    } catch { setNotice("Creation could not be checked. Try again to recover the same booking; your entered details are kept here."); }
    finally { setSaving(false); }
  }
  return <div className="grid gap-7">
    <PageHeader eyebrow={request ? "Alternative request" : "Operator booking"} title={request ? `Book time with ${request.inviteeName}` : "Create booking"} description={request ? `This will link the agreed booking to ${request.eventTitle} and notify the invitee once.` : "Calendar availability is checked before the booking is written."} />
    {notice ? <p role="alert" className={noticeClassName("error", "font-semibold")}>{notice}</p> : null}
    {hostTimezone === null ? <p role="status" className={noticeClassName("warning")}>Set up the host profile before creating a booking. <Link to="/app/profile" className="font-semibold underline">Set up host profile</Link></p> : null}
    {events && !events.length ? <p role="status" className={noticeClassName("warning")}>Create an event type before creating a booking.</p> : null}
    {request && !event ? <p role="status" className={noticeClassName("warning")}>This request’s event type is no longer available. Return to requests to review it.</p> : null}
    {request && request.state !== "submitted" ? <p role="status" className={noticeClassName("warning")}>This request is already {request.state}. Review its existing record before creating another booking.</p> : null}
    {request ? <Card className="max-w-3xl p-5 sm:p-6"><h2 className="font-semibold text-ink">Requested windows</h2><div className="mt-3 grid gap-3">{request.windows.map((window, index) => <div className="rounded-2xl bg-row px-4 py-3.5" key={index}><p className="font-[650] text-ink">Host: {window.hostLabel}</p><p className="mt-1 text-sm text-muted">Invitee: {window.inviteeLabel}</p></div>)}</div>{request.note ? <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{request.note}</p> : null}</Card> : null}
    <Card className="max-w-3xl p-5 sm:p-6"><form onSubmit={(formEvent) => void create(formEvent)}>
      <fieldset disabled={!hydrated || !ready || saving} className="border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-[650] text-ink">Event type<Select value={eventTypeId} onChange={(entry) => { setNotice(""); setEventTypeId(entry.target.value); setAnswers({}); }} disabled={Boolean(request)}>{events?.map((entry) => <option key={entry.id} value={entry.id}>{entry.title} · {entry.durationMinutes} min</option>)}</Select></label>
          <label className="grid gap-2 text-sm font-[650] text-ink">Editing time zone<Select aria-label="Editing time zone" value={timezone} onChange={(entry) => { setNotice(""); if (selected) setStartLocal(localInput(selected, entry.target.value)); setTimezone(entry.target.value); setChoice(""); }}>{zones.map((zone) => <option key={zone}>{zone}</option>)}</Select></label>
          <label className="grid gap-2 text-sm font-[650] text-ink">Start time<Input type="datetime-local" step={60} value={startLocal} onChange={(entry) => { setNotice(""); setStartLocal(entry.target.value); setChoice(""); }} required /></label>
          <label className="grid gap-2 text-sm font-[650] text-ink">Invitee time zone<Select aria-label="Invitee time zone" value={inviteeTimezone} onChange={(entry) => { setNotice(""); setInviteeTimezone(entry.target.value); }}>{zones.map((zone) => <option key={zone}>{zone}</option>)}</Select></label>
          <p className="text-sm text-muted sm:col-span-2">The editing zone labels the time you enter. The invitee zone is used on their receipt and mail.</p>
          {candidates.length > 1 ? <label className="grid gap-2 text-sm font-[650] text-ink sm:col-span-2">Repeated time<Select aria-label="Repeated time" value={choice} onChange={(entry) => { setNotice(""); setChoice(entry.target.value); }} required><option value="">Choose the UTC offset</option>{candidates.map((entry) => <option key={entry.instant} value={entry.instant}>{entry.label}</option>)}</Select></label> : null}
          {candidates.length > 1 && !choice ? <p role="alert" className={noticeClassName("warning", "sm:col-span-2")}>This time occurs twice. Choose a UTC offset.</p> : null}
          {startLocal && !candidates.length ? <p role="alert" className={noticeClassName("error", "sm:col-span-2")}>This time does not exist in {timezone}. Choose another time.</p> : null}
          {selected && hostTimezone ? <div className="grid gap-1.5 text-sm text-ink sm:col-span-2"><p><strong className="font-[650]">Host start: </strong>{startTime(selected, hostTimezone)}</p><p><strong className="font-[650]">Invitee start: </strong>{startTime(selected, inviteeTimezone)}</p></div> : null}
          <label className="grid gap-2 text-sm font-[650] text-ink">Invitee name<Input value={name} onChange={(entry) => { setNotice(""); setName(entry.target.value); }} required maxLength={160} /></label>
          <label className="grid gap-2 text-sm font-[650] text-ink">Invitee email<Input type="email" value={email} onChange={(entry) => { setNotice(""); setEmail(entry.target.value); }} required maxLength={320} /></label>
          {event?.questions.map((question) => { const key = question.key; return key ? <OperatorQuestion key={key} question={question} value={answers[key] ?? ""} onChange={(value) => { setNotice(""); setAnswers((current) => ({ ...current, [key]: value })); }} /> : null; })}
        </div>
        <label className="mt-6 flex items-start gap-3 rounded-[14px] border border-gold-line bg-gold-wash p-3 text-sm leading-5 text-ink"><input className="mt-0.5 h-[18px] w-[18px] shrink-0" type="checkbox" checked={overrideNoticeAndHorizon} onChange={(entry) => { setNotice(""); setOverrideNoticeAndHorizon(entry.target.checked); }} />Override the event’s minimum-notice and rolling-range rules. Calendar conflicts are still always checked.</label>
        <div className="mt-6 flex flex-wrap gap-3"><Button type="submit" disabled={saving || !selected}>{saving ? "Creating booking…" : request ? "Create agreed booking" : "Create booking"}</Button><Link to={requestId ? "/app/requests" : "/app/bookings"} className={buttonClassName("secondary")}>Cancel</Link></div>
      </fieldset>
    </form></Card>
  </div>;
}
