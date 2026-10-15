import { deviceTimezone } from "./timezone-search";
import { dayLabel, dateInZone } from "./day-picker-model";
import { RequestDates, nextTenDates } from "./request-dates";
import { useHydrated } from "../../../app/use-hydrated";
import { useDocumentData, useDocumentInstant } from "../../../app/document-data";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { errorMessage, publicApi } from "../../../api/client";
import { PublicFooter, PublicHeader, PublicTheme, SessionSidebar } from "./public-shell";
import { PublicRecoveryPage } from "./recovery-page";
import { bookingPath } from "./navigation";
import type { PublicEventPayload } from "./types";

type TimeRange = { start: string; end: string };
type RequestWindow = { date: string; startMinute: number; endMinute: number };
type RequestComposition = { inviteeName: string; inviteeEmail: string; inviteeTimezone: string; note: string | null; windows: RequestWindow[] };
type Review = { nonce: string; expiresAt: string; request: RequestComposition & { eventTitle: string; hostName: string } };

export function AlternativeRequestPage({ handle, slug, embedded = false }: { handle: string; slug: string; embedded?: boolean }) {
  const [data, setData] = useState<PublicEventPayload | undefined>(useDocumentData<PublicEventPayload>());
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setMissing(false);
    void publicApi.api.public.events[":handle"][":slug"].$get({ param: { handle, slug } }).then(async (response) => {
      if (response.ok) setData(await response.json()); else setMissing(true);
    });
  }, [handle, slug]);
  if (missing || (data && !data.eventType.alternativeRequestsEnabled)) return <PublicRecoveryPage />;
  if (!data) return <PublicTheme><PublicHeader /><main className="pb-loading">Loading this session…</main></PublicTheme>;
  return <RequestComposer data={data} embedded={embedded} />;
}

function RequestComposer({ data, embedded }: { data: PublicEventPayload; embedded: boolean }) {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const instant = useDocumentInstant();
  const hydrated = useHydrated();
  const storageKey = `dial.request-review.v1:${data.profile.handle}:${data.eventType.slug}`;
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [ranges, setRanges] = useState<TimeRange[]>([{ start: "", end: "" }]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState(data.profile.timezone);
  const dates = useMemo(() => nextTenDates(dateInZone(instant, timezone)), [instant, timezone]);
  const [note, setNote] = useState("");
  const [review, setReview] = useState<Review>();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [receiptNonce, setReceiptNonce] = useState<string>();
  const [acknowledgement, setAcknowledgement] = useState<"queued" | "sent" | "failed">("queued");
  const [receiptError, setReceiptError] = useState(false);
  useEffect(() => {
    if (!completed || !receiptNonce || acknowledgement !== "queued") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      let delay = 4000;
      try {
        const response = await publicApi.api.public.events[":handle"][":slug"].request.receipt.$get({ param: { handle: data.profile.handle, slug: data.eventType.slug }, query: { nonce: receiptNonce } });
        if (!active) return;
        if (response.ok) {
          const receipt = await response.json();
          if (!active) return;
          setAcknowledgement(receipt.acknowledgement); setReceiptError(false);
          if (receipt.acknowledgement !== "queued") return;
        } else {
          setReceiptError(true);
          if ([400, 403, 404, 410].includes(response.status)) return;
          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After");
            const seconds = Number(retryAfter), retryAt = Date.parse(retryAfter ?? "");
            if (retryAfter && Number.isFinite(seconds) && seconds >= 0) delay = Math.max(delay, seconds * 1000);
            else if (Number.isFinite(retryAt)) delay = Math.max(delay, retryAt - Date.now());
            else return;
          }
        }
      } catch { if (active) setReceiptError(true); }
      if (active) timer = setTimeout(() => { void check(); }, delay);
    };
    void check();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [acknowledgement, completed, data.eventType.slug, data.profile.handle, receiptNonce]);

  useEffect(() => {
    setTimezone(deviceTimezone(data.profile.timezone));
    const stored = readReview(storageKey);
    if (!stored || Date.parse(stored.expiresAt) <= Date.now()) return;
    setReview(stored);
    setName(stored.request.inviteeName);
    setEmail(stored.request.inviteeEmail);
    setTimezone(stored.request.inviteeTimezone);
    setNote(stored.request.note ?? "");
    setSelectedDates([...new Set(stored.request.windows.map((window) => window.date))]);
    setRanges(uniqueRanges(stored.request.windows));
  }, [storageKey, data.profile.timezone]);

  const composition = () => ({
    inviteeName: name.trim(),
    inviteeEmail: email.trim(),
    inviteeTimezone: timezone.trim(),
    note: note.trim() || null,
    windows: selectedDates.flatMap((date) => ranges.map((range) => ({ date, startMinute: minutes(range.start), endMinute: minutes(range.end) }))),
  });
  const localError = () => {
    if (!name.trim()) return "Add your name.";
    if (!/^\S+@\S+\.\S+$/.test(email)) return "Add a valid email address.";
    if (!timezone.trim()) return "Add your IANA timezone.";
    if (!selectedDates.length) return "Choose at least one future date.";
    if (ranges.some((range) => !range.start || !range.end || range.start >= range.end)) return "Each time window needs an end after its start.";
    if (selectedDates.length * ranges.length > 20) return "Choose no more than 20 date and time windows.";
    return "";
  };

  async function reviewRequest() {
    if (submitting) return;
    const error = localError();
    if (error) { setMessage(error); return; }
    setSubmitting(true); setMessage("");
    try {
      const response = await publicApi.api.public.events[":handle"][":slug"].request.review.$post({ param: { handle: data.profile.handle, slug: data.eventType.slug }, json: composition() });
      if (!response.ok) { setMessage(await errorMessage(response)); return; }
      const next = await response.json() as Review;
      setReview(next);
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* The in-memory review remains usable when browser storage is unavailable. */ }
    } catch { setMessage("Your review could not be loaded. Your details are kept; please retry."); }
    finally { setSubmitting(false); }
  }

  async function submitRequest() {
    if (!review || submitting) return;
    setSubmitting(true); setMessage("");
    try {
      const response = await publicApi.api.public.events[":handle"][":slug"].request.$post({ param: { handle: data.profile.handle, slug: data.eventType.slug }, query: { nonce: review.nonce }, json: composition() });
      if (!response.ok) { setMessage(await errorMessage(response)); return; }
      try { sessionStorage.removeItem(storageKey); } catch { /* Successful receipt is authoritative even when browser storage is unavailable. */ }
      setReceiptNonce(review.nonce); setAcknowledgement("queued"); setReceiptError(false); setReview(undefined); setCompleted(true);
    } catch { setMessage("The result could not be received. Your reviewed request is kept; send again to retrieve the same request."); }
    finally { setSubmitting(false); }
  }

  const backPath = bookingPath(data.profile.handle, data.eventType.slug, "", embedded, {}, search);
  return <PublicTheme><PublicHeader embedded={embedded} profilePath={embedded || data.eventType.requestOnly ? undefined : backPath} /><main className="pb-event-page"><div className="pb-mobile-session"><SessionSidebar profile={data.profile} eventType={data.eventType} compact /></div><div className="pb-event-layout"><SessionSidebar profile={data.profile} eventType={data.eventType} /><section className="pb-event-flow"><div className="pb-event-heading"><div><p className="pb-eyebrow">A flexible alternative</p><h1>{completed ? "Request received." : review ? "Review your request." : data.eventType.requestOnly ? "Send another request." : "Request another time."}</h1>{!completed ? <p>Share future dates and windows that could work. This request never reserves a time.</p> : null}</div>{!data.eventType.requestOnly ? embedded ? <a className="pb-quiet-link" href={backPath}>Back to availability</a> : <Link className="pb-quiet-link" to="/book/$handle/$slug" params={{ handle: data.profile.handle, slug: data.eventType.slug }}>Back to availability</Link> : null}</div>{completed ? <section className="pb-request-form"><p role="status">Your request is with the host. {acknowledgement === "sent" ? "An acknowledgement email was sent to your email address." : acknowledgement === "failed" ? "The acknowledgement email could not be confirmed as sent. Your request is saved; contact the host if you need help." : "Acknowledgement email is queued for your email address."} The host will follow up by email.{receiptError ? " The email status could not be checked." : null}</p><button type="button" className="pb-secondary-button" onClick={() => { setCompleted(false); setReceiptNonce(undefined); setMessage(""); }}>Send another request</button></section> : review ? <RequestReview review={review} message={message} onBack={() => setReview(undefined)} onSubmit={() => void submitRequest()} submitting={submitting} /> : <form className="pb-request-form" onSubmit={(event) => { event.preventDefault(); void reviewRequest(); }}><fieldset disabled={!hydrated || submitting} className="border-0 p-0"><RequestDates dates={dates} selected={selectedDates} onToggle={(date) => setSelectedDates((current) => current.includes(date.value) ? current.filter((value) => value !== date.value) : [...current, date.value])} /><RequestRanges ranges={ranges} onChange={setRanges} /><fieldset className="pb-request-fields"><legend>3. Your details</legend><p>The host and the configured email provider receive this request. It does not create a calendar event. <a href="/privacy">Read the privacy notice.</a></p><label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label><label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label><label>Timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} aria-describedby="request-timezone-note" required /></label><label className="sm:col-span-2">Note <span>(optional)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></label><p id="request-timezone-note">Use an IANA timezone such as Australia/Brisbane so the host can understand your preferred windows.</p></fieldset><section className="pb-request-delivery" aria-live="polite"><h2>Review before sending</h2><p>We will show the exact dates, times, and contact details before this request is recorded.</p>{message ? <p className="pb-request-notice" role="status">{message}</p> : null}<div><button className="pb-primary-button" type="submit" disabled={submitting}>{submitting ? "Preparing review…" : "Review request"}</button></div></section></fieldset></form>}</section></div></main><PublicFooter embedded={embedded} /></PublicTheme>;
}

function RequestReview({ review, message, onBack, onSubmit, submitting }: { review: Review; message: string; onBack: () => void; onSubmit: () => void; submitting: boolean }) {
  return <section className="pb-request-form pb-request-review" aria-labelledby="request-review-title"><p className="pb-eyebrow">Ready to send</p><h2 id="request-review-title">{review.request.eventTitle}</h2><p>Your request will be sent once to {review.request.hostName}. The host will follow up by email.</p><dl><div><dt>Name</dt><dd>{review.request.inviteeName}</dd></div><div><dt>Email</dt><dd>{review.request.inviteeEmail}</dd></div><div><dt>Timezone</dt><dd>{review.request.inviteeTimezone}</dd></div><div><dt>Preferred windows</dt><dd><ul>{review.request.windows.map((window) => <li key={`${window.date}-${window.startMinute}-${window.endMinute}`}>{dayLabel(window.date)} · {time(window.startMinute)}–{time(window.endMinute)}</li>)}</ul></dd></div>{review.request.note ? <div><dt>Note</dt><dd>{review.request.note}</dd></div> : null}</dl>{message ? <p className="pb-request-notice" role="alert">{message}</p> : null}<div className="pb-request-actions"><button type="button" className="pb-secondary-button" onClick={onBack} disabled={submitting}>Edit request</button><button type="button" className="pb-primary-button" onClick={onSubmit} disabled={submitting}>{submitting ? "Sending…" : "Send request"}</button></div></section>;
}


function RequestRanges({ ranges, onChange }: { ranges: TimeRange[]; onChange: (ranges: TimeRange[]) => void }) {
  const update = (index: number, patch: Partial<TimeRange>) => onChange(ranges.map((range, position) => position === index ? { ...range, ...patch } : range));
  return <fieldset className="pb-request-step"><legend>2. Add time windows</legend><p>These windows apply to each selected date in your chosen timezone.</p>{ranges.map((range, index) => <div className="pb-range-row" key={index}><label>Start<input type="time" value={range.start} onChange={(event) => update(index, { start: event.target.value })} required /></label><span aria-hidden="true">–</span><label>End<input type="time" value={range.end} onChange={(event) => update(index, { end: event.target.value })} required /></label><button className="pb-icon-button" type="button" aria-label={`Remove time range ${index + 1}`} disabled={ranges.length === 1} onClick={() => onChange(ranges.filter((_, position) => position !== index))}>×</button></div>)}<button className="pb-add-range" type="button" disabled={ranges.length >= 20} onClick={() => onChange([...ranges, { start: "", end: "" }])}>Add another time range</button></fieldset>;
}


function minutes(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function time(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function uniqueRanges(windows: RequestWindow[]) { const ranges = new Map(windows.map((window) => [`${window.startMinute}-${window.endMinute}`, { start: time(window.startMinute), end: time(window.endMinute) }])); return [...ranges.values()]; }
function readReview(key: string) { try { const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null"); return isReview(value) ? value : undefined; } catch { return undefined; } }
function isReview(value: unknown): value is Review { return typeof value === "object" && value !== null && "nonce" in value && "expiresAt" in value && "request" in value; }
