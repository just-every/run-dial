import { useId } from "react";
import type { DetailsQuestion } from "./details-validation";
export function Question({ question, value, onChange, error }: { question: DetailsQuestion; value: string | string[]; onChange: (value: string | string[]) => void; error?: string }) {
  const id = useId();
  const invalid = { "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined };
  const label = <span className="pb-label-text">{question.label}{question.required ? <span aria-hidden="true"> *</span> : <span> (optional)</span>}</span>;
  const message = error ? <p className="pb-field-error" id={`${id}-error`}>{error}</p> : null;
  if (question.kind === "multiple_choice" || question.kind === "checkbox") {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset className="pb-answer-choice sm:col-span-2" {...invalid}><legend>{question.label}{question.required ? <span> (required)</span> : <span> (optional)</span>}</legend>{question.options.map(option => <label key={option.value}><input type="checkbox" {...invalid} checked={selected.includes(option.value)} onChange={event => onChange(event.target.checked ? [...selected, option.value] : selected.filter(entry => entry !== option.value))} />{option.label}</label>)}{message}</fieldset>;
  }
  return <label className={question.kind === "textarea" ? "sm:col-span-2" : undefined}>{label}{question.kind === "textarea" ? <textarea aria-label={question.label} {...invalid} required={question.required} maxLength={4000} value={String(value)} onChange={event => onChange(event.target.value)} /> : question.kind === "single_choice" ? <select aria-label={question.label} {...invalid} required={question.required} value={String(value)} onChange={event => onChange(event.target.value)}><option value="">Choose one</option>{question.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input aria-label={question.label} {...invalid} required={question.required} maxLength={500} value={String(value)} onChange={event => onChange(event.target.value)} />}{message}</label>;
}
