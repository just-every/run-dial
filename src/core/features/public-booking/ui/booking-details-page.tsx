import { GuestFields, guestEmails } from "./guest-fields";
import { RememberDetails } from "../../clients/client";
import { PayStepNotice } from "./pay-step";
import { BillingTax, useTaxQuote } from "./billing-tax";
import { formatUsd } from "../../../shared/event-price";
import { BookingLocation, bookingLocationError } from "./booking-location";
import { BookingChangeTerms } from "./booking-change-terms";
import { resolveLockedTimezone } from "../../../shared/timezone-lock";
import { LockedBookingTime, LockedTimezoneNotice, useBrowserTimezone } from "./locked-timezone";
import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHydrated } from "../../../app/use-hydrated";
import { useDocumentData } from "../../../app/document-data";
import { errorMessage, publicApi } from "../../../api/client";
import { bookingPath, manageToken } from "./navigation";
import { PublicHeader, PublicTheme } from "./public-shell";
import { PublicRecoveryPage } from "./recovery-page";
import { FlowShell, formatRange } from "./flow-shell";
import { RequestOrder } from "./request-order";
import { ConfirmationAttempt } from "./confirmation-attempt";
import { retainConfiguredAnswers } from "./answer-retention";
import { seedSelection } from "./document-seeds";
import { forgetSelection, rememberSelection } from "./selection-storage";
import { detailsErrors, questionErrorKey } from "./details-validation";
import { Question } from "./public-question";
import { forgetRecoveryDraft, readRecoveryDraft, rememberRecoveryDraft } from "./booking-recovery-draft";
import { dateInZone } from "./day-picker-model";
import { prefilledAnswers, readLinkContext } from "./link-context";
import { completeBooking, type CommittedConfirmation } from "./booking-completion";
import type { PublicEventPayload } from "./types";
import type { BookingDetailsCapability, PublicSelection } from "./selection-types";

export function BookingDetailsPage({ handle, slug, capability, embedded = false }: { handle: string; slug: string; capability: BookingDetailsCapability; embedded?: boolean }) {
  return <BookingDetailsContent key={`${handle}/${slug}/${capability.nonce}/${capability.startAt}/${capability.inviteeTimezone}`} handle={handle} slug={slug} capability={capability} embedded={embedded} />;
}
function BookingDetailsContent({ handle, slug, capability, embedded }: { handle: string; slug: string; capability: BookingDetailsCapability; embedded: boolean }) {
  const hydrated = useHydrated();
  const browserTimezone = useBrowserTimezone();
  const order = useRef(new RequestOrder()), attempt = useRef(new ConfirmationAttempt()), submissions = useRef(new RequestOrder()), submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const { nonce, startAt, inviteeTimezone } = capability;
  const initial = seedSelection(useDocumentData<unknown>(), handle, slug, capability);
  const [linkContext] = useState(() => readLinkContext(search));
  const initializedQuestions = useRef(Boolean(initial));
  const [selection, setSelection] = useState<PublicSelection | undefined>(initial);
  const [data, setData] = useState<PublicEventPayload | undefined>(initial ? { profile: initial.host, eventType: initial.event } : undefined);
  const [missing, setMissing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() => initial ? prefilledAnswers(initial.event.questions, linkContext) : {});
  const [guests,setGuests]=useState("");
  const [name, setName] = useState(linkContext.name ?? "");
  const [email, setEmail] = useState(linkContext.email ?? "");
  const [locationId, setLocationId] = useState(initial?.event.locations?.length === 1 ? initial.event.locations[0].key : "");
  const [locationInput, setLocationInput] = useState("");
  const link = new URLSearchParams(search).get("link") || undefined;
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [consented, setConsented] = useState(false);
  const tax = useTaxQuote({ handle, slug, nonce, startAt, inviteeTimezone, ...(link ? { link } : {}) }, Boolean(selection?.payment?.taxRequired));
  const refreshSelection = useCallback(async () => {
    if (attempt.current.pending) return;
    const currentRead = order.current.begin();
    setSelectionError("");
    try {
      const response = await publicApi.api.public.book[":handle"][":slug"].selection.$get({ param: { handle, slug }, query: { nonce, startAt, inviteeTimezone, ...(link ? { link } : {}) } });
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
      setLocationId(previous => current.event.locations?.some(location => location.key === previous) ? previous : current.event.locations?.length === 1 ? current.event.locations[0].key : "");
      setMissing(false); setSelection(current); setData({ profile: current.host, eventType: current.event });
      const initialize = !initializedQuestions.current;
      initializedQuestions.current = true;
      setAnswers((previous) => initialize ? prefilledAnswers(current.event.questions, linkContext) : retainConfiguredAnswers(current.event.questions, previous));
    } catch { if (currentRead() && !attempt.current.pending) setSelectionError("Your selected time could not be refreshed. Your details are kept; reload it to retry."); }
  }, [handle, inviteeTimezone, nonce, slug, startAt, linkContext, link]);
  useEffect(() => {
    const reads = order.current, writes = submissions.current;
    const draft = readRecoveryDraft(handle, slug);
    if (draft) { initializedQuestions.current = true; setName(draft.name); setEmail(draft.email); setLocationId(draft.locationId || (initial?.event.locations?.length === 1 ? initial.event.locations[0].key : "")); setLocationInput(draft.locationInput ?? ""); setAnswers(initial ? retainConfiguredAnswers(initial.event.questions, draft.answers) : draft.answers); }
    void refreshSelection();
    return () => { reads.invalidate(); writes.invalidate(); };
  }, [handle, slug, refreshSelection]);
  if (missing) return <PublicRecoveryPage kind="booking" />;
  if (!selection || !data) return <PublicTheme><PublicHeader embedded={embedded} step={2} /><main className="pb-loading">{selectionError ? <><p>{selectionError}</p><button type="button" className="pb-secondary-button" disabled={!hydrated} onClick={() => void refreshSelection()}>Reload selected time</button></> : "Loading your details…"}</main></PublicTheme>;
  const currentSelection = selection;
  const chosenLocationId = data.eventType.locations?.length === 1 ? data.eventType.locations[0].key : locationId;
  const lockedTimezone = resolveLockedTimezone(data.eventType.bookingPolicy?.lockedTimezone);

  async function confirm() {
    if (submitting.current) return;
    if (!attempt.current.pending) {
      const invalid = detailsErrors(name, email, data!.eventType.questions, answers);
      const locationError = bookingLocationError(data!.eventType.locations, chosenLocationId, locationInput);
      if (locationError) invalid.location = locationError;
      if (currentSelection.payment?.consent && !consented) invalid.cardConsent = "Agree to the saved card and the stated fees to book this event.";
      if (currentSelection.payment?.taxRequired && (!tax.address || !tax.quote)) invalid.billingAddress = "Enter your billing address so the sales tax is shown before you pay.";
      setFields(invalid);
      if (Object.keys(invalid).length) { setNotice("Complete the highlighted fields before confirming."); return; }
    }
    submitting.current = true; order.current.invalidate();
    const currentSubmission = submissions.current.begin();
    const input = attempt.current.begin({ ...(new URLSearchParams(search).get("routeToken")?{routeToken:new URLSearchParams(search).get("routeToken")!}:{}), ...(currentSelection.guestLimit ? {guests:guestEmails(guests)} : {}), nonce: currentSelection.nonce, startAt: currentSelection.selection.startAt, inviteeTimezone: currentSelection.selection.inviteeTimezone, name, email, answers, ...(chosenLocationId ? { locationId: chosenLocationId } : {}), ...(locationInput ? { locationInput } : {}), ...(link ? { link } : {}), ...(Object.keys(linkContext.attribution).length ? { attribution: linkContext.attribution } : {}), ...(currentSelection.payment?.consent ? { cardConsent: { accepted: consented, version: currentSelection.payment.consent.version } } : {}), ...(currentSelection.approval && currentSelection.payment?.mode === "payment" ? { shownPriceCents:currentSelection.payment.priceCents, shownPaymentCents: tax.quote?.dueNowTotalCents ?? currentSelection.payment.amountCents } : {}), ...(currentSelection.payment?.taxRequired && tax.address && tax.quote ? { billingAddress: tax.address, shownTaxCents: tax.quote.dueNowTaxCents } : {}) });
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
        if (refused && ((response.status === 409 && ["slot_taken", "slot_unavailable"].includes(failure?.error?.code ?? "")) || failure?.error?.code === "invalid_duration")) {
          if (!rememberRecoveryDraft(handle, slug, { name: input.name, email: input.email, answers: input.answers, locationId: input.locationId, locationInput: input.locationInput })) {
            setNotice("That choice is no longer available. Your browser could not save your details. Allow session storage, then confirm again to choose another time.");
            return;
          }
          forgetSelection(handle, slug, capability);
          const currentSearch = window.location.search;
          window.location.assign(bookingPath(handle, slug, "", embedded, {
            notice: "slot_changed", day: dateInZone(input.startAt, lockedTimezone ?? input.inviteeTimezone), timezone: lockedTimezone ?? input.inviteeTimezone,
            week: new URLSearchParams(currentSearch).get("week") || dateInZone(input.startAt, data!.profile.timezone),
          }, currentSearch));
          return;
        }
        setNotice(message);
        if (refused && failure?.error?.code === "invalid_answers") await refreshSelection();
        if (refused && failure?.error?.code === "tax_changed") tax.refresh();
        if (refused && ["card_consent_required", "payment_terms_changed"].includes(failure?.error?.code ?? "")) {
          setConsented(false);
          await refreshSelection();
          if (currentSelection.payment?.taxRequired) tax.refresh();
          setNotice("The payment terms changed. Review the current fees and agree again before continuing.");
        }
        return;
      }
      attempt.current.unknown();
      if (response.status === 202) {
        // PAY-001: the slot is held while the invitee pays; Stripe's signed event confirms the booking.
        const step = await response.json() as unknown as { payment?: { checkoutUrl: string }; approvalRequired?: boolean; approval?: {url:string} };
        if (!currentSubmission()) return;
        forgetRecoveryDraft(handle, slug);
        if(step.approvalRequired&&step.approval){window.location.assign(step.approval.url);return;}
        if(!step.payment)throw new Error("Confirmation result is missing its next step");
        window.location.assign(step.payment.checkoutUrl);
        return;
      }
      const confirmation = await response.json() as CommittedConfirmation;
      if (!currentSubmission()) return;
      forgetRecoveryDraft(handle, slug);
      if (completeBooking(confirmation, embedded, search)) return;
      const token = manageToken(confirmation.manageUrl);
      if (!token) { setNotice("Your booking was recorded, but its receipt could not be opened. Check your confirmation email."); return; }
      window.location.assign(bookingPath(handle, slug, "/confirmed", embedded, { token }, search));
    } catch { if (currentSubmission()) { attempt.current.unknown(); setPending(true); setNotice("The result could not be received. Your details are kept; confirm again to retrieve the same booking."); } }
    finally { submitting.current = false; setSaving(false); }
  }

  return <FlowShell data={data} embedded={embedded} step={2}><section className="pb-request-form"><p className="pb-eyebrow">Your details</p><h1>{currentSelection.approval?"Request this time.":"Confirm this time."}</h1>{currentSelection.approval?<p>The host must approve this request within {currentSelection.approval.windowHours} hours, or before the meeting starts if sooner. Your time is held while the host decides. The booking and calendar invitation are confirmed only after approval and, for a priced request, Stripe confirms the capture.</p>:null}{lockedTimezone ? <><LockedTimezoneNotice timezone={lockedTimezone} /><LockedBookingTime startAt={currentSelection.selection.startAt} endAt={currentSelection.selection.endAt} timezone={lockedTimezone} browserTimezone={browserTimezone} /></> : <><p>{formatRange(currentSelection.selection.startAt, currentSelection.selection.endAt, currentSelection.selection.inviteeTimezone)}</p><p>Times in <strong>{currentSelection.selection.inviteeTimezone}</strong></p></>}<p>Your details are shared for this booking. <a href="/privacy" target={embedded ? "_blank" : undefined} rel={embedded ? "noreferrer" : undefined}>Privacy notice</a>.</p><BookingChangeTerms policy={data.eventType.bookingPolicy} />{currentSelection.payment ? <PayStepNotice approval={Boolean(currentSelection.approval)} payment={currentSelection.payment} timezone={lockedTimezone ?? currentSelection.selection.inviteeTimezone} consented={consented} error={fields.cardConsent} onConsent={value => { setConsented(value); setFields(current => ({ ...current, cardConsent: "" })); }} /> : null}{currentSelection.payment?.taxRequired ? <BillingTax tax={tax} disabled={!hydrated || saving || pending} error={fields.billingAddress} /> : null}<form noValidate onSubmit={(event) => { event.preventDefault(); void confirm(); }}><fieldset className="pb-request-fields" disabled={!hydrated || saving || pending} aria-busy={!hydrated || saving}><legend>About you</legend><p>Fields marked * are required.</p><label><span className="pb-label-text">Name<span aria-hidden="true"> *</span></span><input aria-label="Name" aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? "booking-name-error" : undefined} required maxLength={160} autoComplete="name" value={name} onChange={(event) => { setName(event.target.value); setFields(current => ({ ...current, name: "" })); }} />{fields.name ? <p id="booking-name-error" className="pb-field-error">{fields.name}</p> : null}</label><label><span className="pb-label-text">Email<span aria-hidden="true"> *</span></span><input aria-label="Email" aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? "booking-email-error" : undefined} required maxLength={320} type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setFields(current => ({ ...current, email: "" })); }} />{fields.email ? <p id="booking-email-error" className="pb-field-error">{fields.email}</p> : null}</label><RememberDetails handle={handle} slug={slug} email={email} disabled={!hydrated || saving || pending} onDetails={details => { setName(details.name); setEmail(details.email); setAnswers(retainConfiguredAnswers(data.eventType.questions,details.answers)); if(details.phone && data.eventType.locations?.some(location => location.key === chosenLocationId && location.input === "phone")) setLocationInput(details.phone); setFields({}); }} /><GuestFields limit={currentSelection.guestLimit??0} value={guests} onChange={setGuests} /><BookingLocation locations={data.eventType.locations} id={chosenLocationId} value={locationInput} onChoose={value => { setLocationId(value); setLocationInput(""); setFields(current => ({ ...current, location: "" })); }} onInput={value => { setLocationInput(value); setFields(current => ({ ...current, location: "" })); }} error={fields.location} />{data.eventType.questions.map((question) => <Question key={question.key} question={question} error={fields[questionErrorKey(question.key)]} value={answers[question.key] ?? ""} onChange={(value) => { setAnswers((current) => ({ ...current, [question.key]: value })); setFields(current => ({ ...current, [questionErrorKey(question.key)]: "" })); }} />)}</fieldset>{selectionError ? <p className="pb-request-notice" role="alert">{selectionError} <button type="button" className="pb-quiet-button" disabled={!hydrated || saving || pending} onClick={() => void refreshSelection()}>Reload selected time</button></p> : null}{pending && !saving ? <p className="pb-request-notice" role="status">Your confirmation is unconfirmed. Retry the original details to retrieve its result.</p> : null}{notice ? <p className="pb-request-notice" role="alert">{notice}</p> : null}<button className="pb-primary-button mt-5" disabled={!hydrated || saving}>{currentSelection.payment ? saving ? "Opening Stripe…" : pending ? "Retry payment" : currentSelection.payment.mode === "setup" ? "Continue to save your card" : `${currentSelection.approval ? "Authorize payment" : "Continue to payment"} · ${formatUsd(tax.quote?.dueNowTotalCents ?? currentSelection.payment.amountCents)}` : saving ? "Confirming…" : pending ? "Retry confirmation" : currentSelection.approval ? "Request booking" : "Confirm booking"}</button></form></section></FlowShell>;
}
