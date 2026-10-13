import { Input, Select, Textarea } from "../../../app/ui/primitives";
import type { EventQuestionInput } from "../../event-types";

export function OperatorQuestion({ question, value, onChange }: { question: EventQuestionInput; value: string | string[]; onChange(value: string | string[]): void }) {
  const label = `${question.label}${question.required ? " *" : ""}`;
  if (question.kind === "single_choice") return <label className="grid gap-2 text-sm font-[650] text-ink">{label}<Select value={String(value)} onChange={(event) => onChange(event.target.value)} required={question.required}><option value="">Choose one</option>{question.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>;
  if (question.kind === "multiple_choice" || question.kind === "checkbox") {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset className="grid gap-2 sm:col-span-2"><legend className="text-sm font-[650] text-ink">{label}</legend>{question.options.map((option, index) => <label key={option.value} className="flex items-center gap-2 text-[15px]"><input className="h-[18px] w-[18px]" type="checkbox" checked={selected.includes(option.value)} required={question.required && !selected.length && index === 0} onChange={(event) => onChange(event.target.checked ? [...selected, option.value] : selected.filter((entry) => entry !== option.value))} />{option.label}</label>)}</fieldset>;
  }
  return <label className="grid gap-2 text-sm font-[650] text-ink">{label}{question.kind === "textarea" ? <Textarea value={String(value)} onChange={(event) => onChange(event.target.value)} required={question.required} maxLength={4000} /> : <Input value={String(value)} onChange={(event) => onChange(event.target.value)} required={question.required} maxLength={500} />}</label>;
}
