import { useEffect, useId, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Input, Select, Textarea, noticeClassName } from "../../../app/ui/primitives";
import { useHydrated } from "../../../app/use-hydrated";
import { correspondenceTemplateKeys, correspondenceVariables, defaultCorrespondenceConfig, editableCorrespondenceTemplates, invalidTemplateVariables, type CorrespondenceConfig, type CorrespondenceTemplateKey } from "../../../shared/correspondence";
import { CorrespondencePreview } from "./correspondence-preview";
import { RequestRoutingFields } from "./request-routing-fields";

type Props = { eventId: string; hostName: string; eventTitle: string; questions: { key?: string; label: string; private?: boolean }[] };
const kinds = [
  { name: "Calendar invitation", keys: ["calendarTitle", "calendarDescription"] },
  { name: "Confirmation email", keys: ["confirmationSubject", "confirmationBody"] },
  { name: "Reschedule email", keys: ["rescheduleSubject", "rescheduleBody"] },
  { name: "Reschedule request email", keys: ["rescheduleRequestSubject", "rescheduleRequestBody"] },
  { name: "Reschedule request reminder email", keys: ["rescheduleRequestReminderSubject", "rescheduleRequestReminderBody"] },
  { name: "Cancellation email", keys: ["cancellationSubject", "cancellationBody"] },
  { name: "Reminder email", keys: ["reminderSubject", "reminderBody"] },
] as const;
const variables = ["invitee full name", "invitee first name", "host name", "event name", "date and time", "duration", "location"];

function questionVariableNames(questions: readonly { key: string; label: string }[]) {
  const used = new Set<string>([...correspondenceVariables, ...questions.map(question => `answer.${question.key}`)]);
  return new Map(questions.map((question, index) => {
    const label = question.label.replace(/[{}]/gu, "").trim() || `Question ${index + 1}`;
    let name = label, number = 1;
    while (used.has(name)) name = `${label} (question ${number++})`;
    used.add(name);
    return [`answer.${question.key}`, name];
  }));
}

/** Translate whole variables once, preserving literal text and unknown variables for validation. */
function replaceTemplateVariables(text: string, names: ReadonlyMap<string, string>) {
  return text.replace(/\{([^{}]*)\}/gu, (token, name: string) => names.has(name) ? `{${names.get(name)}}` : token);
}

export function CorrespondenceEditor(props: Props) {
  return <CorrespondenceForm key={props.eventId} {...props} />;
}

function CorrespondenceForm({ eventId, hostName, eventTitle, questions }: Props) {
  const hydrated = useHydrated(), id = useId();
  const [value, setValue] = useState<CorrespondenceConfig>(defaultCorrespondenceConfig);
  const [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const [kindIndex, setKindIndex] = useState(0), [loadAttempt, setLoadAttempt] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await api.api.app["event-types"][":id"].correspondence.$get({ param: { id: eventId } });
        if (!response.ok) throw new Error(await errorMessage(response));
        const config = await response.json();
        if (active) { setValue(config); setLoaded(true); setError(""); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Templates could not be loaded. Try loading them again."); }
    })();
    return () => { active = false; };
  }, [eventId, loadAttempt]);

  const stableQuestions = questions.filter((question): question is { key: string; label: string; private?: boolean } => typeof question.key === "string" && question.key.length > 0);
  const questionNames = questionVariableNames(stableQuestions);
  const storedNames = new Map([...questionNames].map(([stored, label]) => [label, stored]));
  const displayText = (text: string) => replaceTemplateVariables(text, questionNames);
  const templates = editableCorrespondenceTemplates(value, stableQuestions);
  const calendar = kindIndex === 0, selected = kinds[kindIndex];
  const availableQuestions = stableQuestions.filter(question => !calendar || !question.private);
  const questionKeys = availableQuestions.map(question => question.key);
  const issues = Object.fromEntries(correspondenceTemplateKeys.map(key => {
    const isCalendar = key.startsWith("calendar"), text = templates[key];
    const allowedQuestions = stableQuestions.filter(question => !isCalendar || !question.private).map(question => question.key);
    const unknown = invalidTemplateVariables(text, allowedQuestions);
    if (isCalendar) for (const token of ["manage link", "message"]) if (text.includes(`{${token}}`)) unknown.push(token);
    const errors = [...new Set(unknown)].map(name => `Unknown or unavailable variable: ${displayText(`{${name}}`)}.`);
    if (!text.trim()) errors.push("Enter template text or restore the default.");
    const singleLine = key === "calendarTitle" || key.endsWith("Subject");
    if (text.length > (singleLine ? 500 : 10_000)) errors.push("This template exceeds its length limit.");
    if (singleLine && [...text].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) errors.push("A title or subject must be a single line.");
    return [key, errors];
  })) as Record<CorrespondenceTemplateKey, string[]>;
  const invalid = correspondenceTemplateKeys.filter(key => issues[key].length);
  const disabled = !hydrated || !loaded || saving;
  function update(key: CorrespondenceTemplateKey, text: string | null) {
    setValue(current => ({ ...current, templates: { ...current.templates, [key]: text === null ? null : replaceTemplateVariables(text, storedNames) } }));
    setStatus(""); setError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || busy.current) return;
    if (invalid.length) { setError(invalid.map(key => `${key}: ${issues[key].join(" ")}`).join(" ")); return; }
    if (value.requestRouting?.mode === "selected" && !value.requestRouting.operatorIds.length) { setError("Choose at least one person to email about requests, or choose No email."); return; }
    busy.current = true; setSaving(true); setError(""); setStatus("");
    try {
      const response = await api.api.app["event-types"][":id"].correspondence.$put({ param: { id: eventId }, json: value });
      if (!response.ok) throw new Error(await errorMessage(response));
      setValue(await response.json()); setStatus("Invitation and email templates saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The save result could not be received. Your edits are kept here; reload to check the saved templates."); }
    finally { busy.current = false; setSaving(false); }
  }
  return <form aria-label="Invitation and email templates" onSubmit={save} className="mt-7 grid min-w-0 gap-5">
    <Card className="min-w-0 p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-ink">Invitation and email templates</h2>
      <p className="mt-2 text-sm leading-6 text-soft">Edit the calendar invitation and booking emails for this event type. Saving applies these templates to future messages. Restore a default to use the wording shown below.</p>
      <label className="mt-5 flex items-start gap-3 text-sm font-semibold">
        <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-ink" checked={value.inviteeConfirmationEnabled} disabled={disabled} onChange={event => { setValue(current => ({ ...current, inviteeConfirmationEnabled: event.target.checked })); setStatus(""); setError(""); }} />
        <span>Send Dial confirmation to invitees<span className="mt-1 block font-normal leading-6 text-soft">When off, a successful calendar invitation replaces this email. Dial still sends its confirmation when no calendar is connected or a calendar write fails. This applies to confirmations that have not yet been sent.</span></span>
      </label>
      <label className="mt-5 flex items-start gap-3 text-sm font-semibold">
        <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-ink" checked={value.invitationManageLinkEnabled} disabled={disabled} onChange={event => { setValue(current => ({ ...current, invitationManageLinkEnabled: event.target.checked })); setStatus(""); setError(""); }} />
        <span>Include invitation manage link<span className="mt-1 block font-normal leading-6 text-soft">Add a link to the calendar description that emails a booking management link only to the invitee. Guests and shared-calendar viewers cannot use it to see or change the booking.</span></span>
      </label>
      {loaded ? <RequestRoutingFields value={value.requestRouting} disabled={disabled} onChange={requestRouting => { setValue(current => ({ ...current, requestRouting })); setStatus(""); setError(""); }} /> : null}
      {!loaded ? <p role="status" className="mt-4 text-sm text-soft">{error ? "Templates are unavailable." : "Loading templates…"}</p> : null}
      <div className="mt-5 grid min-w-0 gap-5">
        <label className="grid gap-2 text-sm font-semibold">Template
          <Select value={kindIndex} disabled={disabled} onChange={event => setKindIndex(Number(event.target.value))}>{kinds.map((kind, index) => <option key={kind.name} value={index}>{kind.name}</option>)}</Select>
        </label>
        {selected.keys.map((key, index) => {
          const label = calendar ? index === 0 ? "Title" : "Description" : index === 0 ? "Subject" : "Body";
          const control = { id: `${id}-${key}`, value: displayText(templates[key]), disabled, required: true, "aria-invalid": loaded && issues[key].length > 0, "aria-describedby": issues[key].length ? `${id}-${key}-errors` : undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, event.target.value) };
          return <div key={key} className="grid min-w-0 gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={control.id} className="text-sm font-semibold">{label} <span className="font-normal text-muted">· {value.templates[key] == null ? "Default" : "Custom"}</span></label><Button type="button" variant="quiet" disabled={disabled || value.templates[key] == null} onClick={() => update(key, null)}>Restore default</Button></div>
            {index === 0 ? <Input {...control} maxLength={500} /> : <Textarea {...control} maxLength={10_000} rows={9} />}
            {loaded && issues[key].length ? <p id={`${id}-${key}-errors`} className="text-sm leading-6 text-danger">{issues[key].join(" ")}</p> : null}
          </div>;
        })}
        <details className="min-w-0 text-sm leading-6 text-soft"><summary className="cursor-pointer font-semibold text-ink">Available variables</summary>
          <p className="mt-2">Use the braces exactly as shown.</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{[...variables, ...(calendar ? [] : ["manage link", "message"])].map(variable => <li key={variable}><code className="break-all">{`{${variable}}`}</code></li>)}</ul>
          {availableQuestions.length ? <ul className="mt-3 grid gap-1">{availableQuestions.map(question => <li key={question.key} className="break-words [overflow-wrap:anywhere]">{question.label}: <code>{displayText(`{answer.${question.key}}`)}</code>{question.private ? " (private answer; email only)" : ""}</li>)}</ul> : null}
          {calendar ? <p className="mt-3">Calendar invitations are shared with guests and delegates. Use private answers and manage booking links in emails.</p> : <p className="mt-3">The message variable contains the sender’s message when one is available.</p>}
        </details>
        {loaded ? <CorrespondencePreview templates={templates} keys={selected.keys} questionKeys={questionKeys} hostName={hostName} eventTitle={eventTitle} questions={availableQuestions} calendar={calendar} invitationManageLinkEnabled={value.invitationManageLinkEnabled} invalid={selected.keys.some(key => issues[key].length > 0)} /> : null}
      </div>
    </Card>
    {error ? <p role="alert" className={`${noticeClassName("error")} break-words [overflow-wrap:anywhere]`}>{error}</p> : null}
    {status ? <p role="status" className={noticeClassName("success")}>{status}</p> : null}
    <div className="flex flex-wrap gap-3">{!loaded && error ? <Button type="button" variant="secondary" disabled={!hydrated} onClick={() => { setError(""); setLoadAttempt(attempt => attempt + 1); }}>Reload templates</Button> : null}<Button type="submit" disabled={disabled}>{saving ? "Saving…" : "Save templates"}</Button></div>
  </form>;
}
