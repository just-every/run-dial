import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHydrated } from "../../../app/use-hydrated";
import { useDocumentData } from "../../../app/document-data";
import { errorMessage, publicApi } from "../../../api/client";
import { bookingPath, manageToken } from "./navigation";
import { PublicHeader, PublicTheme } from "./public-shell";
import { PublicRecoveryPage } from "./recovery-page";
import { FlowShell, format } from "./flow-shell";
import { RequestOrder } from "./request-order";
import { ConfirmationAttempt } from "./confirmation-attempt";
import { retainConfiguredAnswers } from "./answer-retention";
import { seedSelection } from "./document-seeds";
import { forgetSelection, rememberSelection } from "./selection-storage";
import { detailsErrors, questionErrorKey } from "./details-validation";
import { Question } from "./public-question";
import type { Confirmation, PublicEventPayload } from "./types";
import type { BookingDetailsCapability, PublicSelection } from "./selection-types";

export function BookingDetailsPage({ handle, slug, capability, embedded = false }: { handle: string; slug: string; capability: BookingDetailsCapability; embedded?: boolean }) {
  return <BookingDetailsContent key={`${handle}/${slug}/${capability.nonce}/${capability.startAt}/${capability.inviteeTimezone}`} handle={handle} slug={slug} capability={capability} embedded={embedded} />;
}
function BookingDetailsContent({ handle, slug, capability, embedded }: { handle: string; slug: string; capability: BookingDetailsCapability; embedded: boolean }) {
  const hydrated = useHydrated();
  const order = useRef(new RequestOrder()), attempt = useRef(new ConfirmationAttempt()), submissions = useRef(new RequestOrder()), submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const { nonce, startAt, inviteeTimezone } = capability;
  const initial = seedSelection(useDocumentData<unknown>(), handle, slug, capability);
  const [selection, setSelection] = useState<PublicSelection | undefined>(initial);
  const [data, setData] = useState<PublicEventPayload | undefined>(initial ? { profile: initial.host, eventType: initial.event } : undefined);
  const [missing, setMissing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const refreshSelection = useCallback(async () => {
    if (attempt.current.pending) return;
    const currentRead = order.current.begin();
    setSelectionError("");
    try {
      const response = await publicApi.api.public.book[":handle"][":slug"].selection.$get({ param: { handle, slug }, query: { nonce, startAt, inviteeTimezone } });
      if (!currentRead() || attempt.current.pending) return;
      if (!response.ok) {
        if ([403, 404, 410].includes(response.status)) { forgetSelection(handle, slug, { nonce, startAt, inviteeTimezone }); setMissing(true); }
        else { const message = await errorMessage(response); if (currentRead()) setSelectionError(message); }
        return;
      }
      const current = seedSelection(await response.json(), handle, slug, { nonce, startAt, inviteeTimezone });
      if (!currentRead() || attempt.current.pending) return;
      if (!current) { setSelectionError("Your selected time could not be loaded. Please retry."); return; }
      rememberSelection(handle, slug, current);
      setMissing(false); setSelection(current); setData({ profile: current.host, eventType: current.event });
      setAnswers((previous) => retainConfiguredAnswers(current.event.questions, previous));
    } catch { if (currentRead() && !attempt.current.pending) setSelectionError("Your selected time could not be refreshed. Your details are kept; reload it to retry."); }
  }, [handle, inviteeTimezone, nonce, slug, startAt]);
  useEffect(() => { const reads = order.current, writes = submissions.current; void refreshSelection(); return () => { reads.invalidate(); writes.invalidate(); }; }, [refreshSelection]);
  if (missing) return <PublicRecoveryPage kind="booking" />;
  if (!selection || !data) return <PublicTheme><PublicHeader embedded={embedded} step={2} /><main className="pb-loading">{selectionError ? <><p>{selectionError}</p><button type="button" className="pb-secondary-button" disabled={!hydrated} onClick={() => void refreshSelection()}>Reload selected time</button></> : "Loading your details…"}</main></PublicTheme>;
  const currentSelection = selection;

  async function confirm() {
    if (submitting.current) return;
    if (!attempt.current.pending) {
      const invalid = detailsErrors(name, email, data!.eventType.questions, answers);
      setFields(invalid);
      if (Object.keys(invalid).length) { setNotice("Complete the highlighted fields before confirming."); return; }
    }
    submitting.current = true; order.current.invalidate();
    const currentSubmission = submissions.current.begin();
    const input = attempt.current.begin({ nonce: currentSelection.nonce, startAt: currentSelection.selection.startAt, inviteeTimezone: currentSelection.selection.inviteeTimezone, name, email, answers });
    setPending(true); setSaving(true); setNotice("");
    try {
      const response = await publicApi.api.public.book[":handle"][":slug"].confirm.$post({
        param: { handle, slug },
        json: input,
      });
      if (!currentSubmission()) return;
      if (!response.ok) {
        const failure = await response.clone().json().catch(() => undefined) as { error?: { code?: string } } | undefined;
        if (!currentSubmission()) return;
        const message = await errorMessage(response);
        if (!currentSubmission()) return;
        const refused = attempt.current.refuse(response.status, failure?.error?.code);
        setPending(attempt.current.pending);
        if (refused && response.status === 409 && ["slot_taken", "slot_unavailable"].includes(failure?.error?.code ?? "")) {
          window.location.assign(bookingPath(handle, slug, "", embedded, { notice: "slot_changed" }, search));
          return;
        }
        setNotice(message);
        if (refused && failure?.error?.code === "invalid_answers") await refreshSelection();
        return;
      }
      attempt.current.unknown();
      const confirmation = await response.json() as Confirmation;
      if (!currentSubmission()) return;
      const token = manageToken(confirmation.manageUrl);
      if (!token) { setNotice("Your booking was recorded, but its receipt could not be opened. Check your confirmation email."); return; }
      window.location.assign(bookingPath(handle, slug, "/confirmed", embedded, { token }, search));
    } catch { if (currentSubmission()) { attempt.current.unknown(); setPending(true); setNotice("The result could not be received. Your details are kept; confirm again to retrieve the same booking."); } }
    finally { submitting.current = false; setSaving(false); }
  }

  return <FlowShell data={data} embedded={embedded} step={2}><section className="pb-request-form"><p className="pb-eyebrow">Your details</p><h1>Confirm this time.</h1><p>{format(currentSelection.selection.startAt, currentSelection.selection.inviteeTimezone)} · {currentSelection.selection.inviteeTimezone}. The host and connected calendar provider receive the answers below.</p><p>Host time: {format(currentSelection.selection.startAt, data.profile.timezone)} · {data.profile.timezone}</p><form noValidate onSubmit={(event) => { event.preventDefault(); void confirm(); }}><fieldset className="pb-request-fields" disabled={!hydrated || saving || pending} aria-busy={!hydrated || saving}><legend>About you</legend><p>Fields marked * are required.</p><label><span className="pb-label-text">Name<span aria-hidden="true"> *</span></span><input aria-label="Name" aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? "booking-name-error" : undefined} required maxLength={160} autoComplete="name" value={name} onChange={(event) => { setName(event.target.value); setFields(current => ({ ...current, name: "" })); }} />{fields.name ? <p id="booking-name-error" className="pb-field-error">{fields.name}</p> : null}</label><label><span className="pb-label-text">Email<span aria-hidden="true"> *</span></span><input aria-label="Email" aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? "booking-email-error" : undefined} required maxLength={320} type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setFields(current => ({ ...current, email: "" })); }} />{fields.email ? <p id="booking-email-error" className="pb-field-error">{fields.email}</p> : null}</label>{data.eventType.questions.map((question) => <Question key={question.key} question={question} error={fields[questionErrorKey(question.key)]} value={answers[question.key] ?? ""} onChange={(value) => { setAnswers((current) => ({ ...current, [question.key]: value })); setFields(current => ({ ...current, [questionErrorKey(question.key)]: "" })); }} />)}</fieldset>{selectionError ? <p className="pb-request-notice" role="alert">{selectionError} <button type="button" className="pb-quiet-button" disabled={!hydrated || saving || pending} onClick={() => void refreshSelection()}>Reload selected time</button></p> : null}{pending && !saving ? <p className="pb-request-notice" role="status">Your confirmation is unconfirmed. Retry the original details to retrieve its result.</p> : null}{notice ? <p className="pb-request-notice" role="alert">{notice}</p> : null}<button className="pb-primary-button mt-5" disabled={!hydrated || saving}>{saving ? "Confirming…" : pending ? "Retry confirmation" : "Confirm booking"}</button></form></section></FlowShell>;
}
