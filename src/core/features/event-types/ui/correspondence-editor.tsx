import { useId, useRef, useState } from "react";
import { Button, Input, Select, Textarea } from "../../../app/ui/primitives";
import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { SettingReadState, useSettingRead, writeSetting } from "../../../app/ui/autosave-setting";
import { correspondenceTemplateKeys, correspondenceVariables, editableCorrespondenceTemplates, invalidTemplateVariables, type CorrespondenceConfig, type CorrespondenceTemplateKey } from "../../../shared/correspondence";
import { CorrespondencePreview } from "./correspondence-preview";
import { RequestRoutingFields } from "./request-routing-fields";

type Props = { eventId: string; hostName: string; eventTitle: string; questions: { key?: string; label: string; private?: boolean }[]; initial?: CorrespondenceConfig; operators?: { id: string; email: string; status: string }[]; onSaved?(): void };
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
  const read = useSettingRead<CorrespondenceConfig>(`/api/app/event-types/${props.eventId}/correspondence`, props.initial);
  return read.value ? <CorrespondenceForm key={props.eventId} {...props} initial={read.value} /> : <SettingReadState error={read.error} retry={read.retry} />;
}

function CorrespondenceForm({ eventId, hostName, eventTitle, questions, initial, operators, onSaved }: Props & { initial: CorrespondenceConfig }) {
  const id = useId();
  const positions = useRef<Partial<Record<CorrespondenceTemplateKey, { start: number; end: number }>>>({});
  const save = useAutosave(`event:${eventId}:correspondence`, initial, async (next, init) => {
    await writeSetting(`/api/app/event-types/${eventId}/correspondence`, next, init); onSaved?.();
  });
  const value = save.values;
  const [kindIndex, setKindIndex] = useState(0), [lastTemplate, setLastTemplate] = useState<CorrespondenceTemplateKey>();
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
  const disabled = false;
  function update(key: CorrespondenceTemplateKey, text: string | null) {
    setLastTemplate(key);
    save.type("templates", { ...value.templates, [key]: text === null ? null : replaceTemplateVariables(text, storedNames) });
  }
  return <form aria-label="Invitation and email templates" onSubmit={event => event.preventDefault()} onBlur={save.leave} className="grid min-w-0 gap-4">
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input type="checkbox" aria-label="Send Dial confirmation to invitees" className="h-5 w-5 shrink-0 accent-ink" checked={value.inviteeConfirmationEnabled} onChange={event => save.choose("inviteeConfirmationEnabled", event.target.checked)} />
        <span>Send Dial confirmation to invitees</span><SavedMark state={save.state("inviteeConfirmationEnabled")} />
      </label>
      <SaveFailed id={`${id}-confirmation-failed`} state={save.state("inviteeConfirmationEnabled")} what="confirmation email" choice onRetry={save.retry} />
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input type="checkbox" aria-label="Include invitation manage link" className="h-5 w-5 shrink-0 accent-ink" checked={value.invitationManageLinkEnabled} onChange={event => save.choose("invitationManageLinkEnabled", event.target.checked)} />
        <span>Include invitation manage link</span><SavedMark state={save.state("invitationManageLinkEnabled")} />
      </label>
      <SaveFailed id={`${id}-manage-failed`} state={save.state("invitationManageLinkEnabled")} what="the manage link" choice onRetry={save.retry} />
      <RequestRoutingFields value={value.requestRouting} operators={operators} disabled={disabled} onChange={routing => save.choose("requestRouting", routing)} />
      <SavedMark state={save.state("requestRouting")} /><SaveFailed id={`${id}-routing-failed`} state={save.state("requestRouting")} what="request email" choice onRetry={save.retry} />
      <div className="mt-5 grid min-w-0 gap-5">
        <label className="grid gap-2 text-sm font-semibold">Template
          <Select value={kindIndex} disabled={disabled} onChange={event => setKindIndex(Number(event.target.value))}>{kinds.map((kind, index) => <option key={kind.name} value={index}>{kind.name}</option>)}</Select>
        </label>
        {selected.keys.map((key, index) => {
          const label = calendar ? index === 0 ? "Title" : "Description" : index === 0 ? "Subject" : "Body";
          const control = { onSelect: (event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => { positions.current[key] = { start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 }; }, "aria-label": label, id: `${id}-${key}`, value: displayText(templates[key]), disabled, required: true, "aria-invalid": issues[key].length > 0, "aria-describedby": issues[key].length ? `${id}-${key}-errors` : undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, event.target.value) };
          return <div key={key} className="grid min-w-0 gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={control.id} className="text-sm font-semibold">{label} <span className="font-normal text-muted">· {value.templates[key] == null ? "Default" : "Custom"}</span>{lastTemplate === key ? <SavedMark state={save.state("templates")} /> : null}</label><Button type="button" variant="quiet" disabled={disabled || value.templates[key] == null} onClick={() => update(key, null)}>Restore default</Button></div>
            {index === 0 ? <Input {...control} maxLength={500} /> : <Textarea {...control} maxLength={10_000} rows={9} />}
            <Select aria-label={`Insert a detail in ${label.toLowerCase()}`} value="" className="max-w-64" onChange={event => {
              if (!event.target.value) return;
              const text = displayText(templates[key]);
              const position = positions.current[key] ?? { start: text.length, end: text.length };
              const token = `{${event.target.value}}`;
              update(key, text.slice(0, position.start) + token + text.slice(position.end));
              requestAnimationFrame(() => {
                const field = document.getElementById(control.id) as HTMLInputElement | HTMLTextAreaElement | null;
                field?.focus(); field?.setSelectionRange(position.start + token.length, position.start + token.length);
              });
            }}><option value="">Insert a detail</option>{[...variables, ...(calendar ? [] : ["manage link", "message"]), ...availableQuestions.map(question => questionNames.get(`answer.${question.key}`)!)].map(variable => <option key={variable} value={variable}>{variable}</option>)}</Select>
            {issues[key].length ? <p id={`${id}-${key}-errors`} className="text-sm leading-6 text-danger">{issues[key].join(" ")}</p> : null}
          </div>;
        })}
        {<CorrespondencePreview templates={templates} keys={selected.keys} questionKeys={questionKeys} hostName={hostName} eventTitle={eventTitle} questions={availableQuestions} calendar={calendar} invitationManageLinkEnabled={value.invitationManageLinkEnabled} invalid={selected.keys.some(key => issues[key].length > 0)} />}
      </div>
    <SaveFailed id={`${id}-templates-failed`} state={save.state("templates")} what="the wording" onRetry={save.retry} />
  </form>;
}
