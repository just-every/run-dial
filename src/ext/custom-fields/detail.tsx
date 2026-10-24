import { useEffect, useId, useState } from "react";
import { SaveFailed, SavedMark, useAutosave, type FieldEntity } from "../../core/api/extensions";
import type { FieldEntry, FieldValue } from "./model";
import { fieldsApi, readResponse } from "./client";
const controlClass = "min-h-11 w-full min-w-0 rounded-xl border border-line bg-field px-3.5 py-2 text-[15px] text-ink outline-none focus:border-ink in-[.bg-row]:bg-card";
export function CustomFieldDetail({entity,id}:{entity:FieldEntity;id:string}) {
  return <FieldDetail key={`${entity}:${id}`} entity={entity} id={id} />;
}
function FieldDetail({entity,id}:{entity:FieldEntity;id:string}) {
  const [fields,setFields] = useState<FieldEntry[]>(), [error,setError] = useState("");
  useEffect(() => { let active = true;
    void fieldsApi[":entity"][":id"].$get({param:{entity,id}}).then(readResponse<FieldEntry[]>).then(value => {if(active)setFields(value);}).catch(() => {if(active)setError("Custom fields could not be loaded. Reload the record to try again.");});
    return () => {active=false;};
  },[entity,id]);
  return <section className="mt-5 min-w-0 rounded-2xl bg-row p-4 sm:p-5" aria-label="Custom fields"><h3 className="text-base font-bold text-ink">Custom fields</h3><p className="mt-1 text-sm text-muted">Internal annotations · visible only to operators</p>{error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : !fields ? <p role="status" className="mt-3 text-sm">Loading custom fields…</p> : fields.length ? <div className="mt-4 grid gap-4">{fields.map(field => <FieldEditor key={field.id} entity={entity} id={id} field={field} />)}</div> : <p className="mt-3 text-sm text-muted">Define fields for this record type in Settings.</p>}</section>;
}
function FieldEditor({entity,id,field}:{entity:FieldEntity;id:string;field:FieldEntry}) {
  const control = useId(), failure = `${control}-failed`;
  // Each private field is its own form, since its endpoint takes the field's whole value: it saves as it changes (DL2).
  const form = useAutosave<{value:FieldValue}>(`custom-field:${entity}:${id}:${field.id}`, {value:field.value}, async (next,init) => {await readResponse(await fieldsApi[":entity"][":id"][":fieldId"].$put({param:{entity,id,fieldId:field.id},json:next},{init}));});
  const {value} = form.values, state = form.state("value"), text = typeof value === "string" ? value : "", described = state.failed ? failure : undefined;
  // Clearing a text field saves it empty.
  const typed = (next:string) => form.type("value", next || null);
  return <div className="min-w-0"><div className="flex min-w-0 items-center justify-between gap-3"><label htmlFor={control} className="min-w-0 break-words text-sm font-[650] text-ink">{field.label}</label><SavedMark state={state} /></div>{field.kind === "checkbox" ? <input id={control} className="mt-2 block h-[18px] w-[18px] accent-ink" type="checkbox" aria-describedby={described} checked={value === true} onChange={e => form.choose("value", e.target.checked)} /> : field.kind === "single_choice" ? <select id={control} className={`${controlClass} mt-2`} aria-describedby={described} value={text} onChange={e => form.choose("value", e.target.value || null)}><option value="">Not set</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select> : field.kind === "long_text" ? <textarea id={control} className={`${controlClass} mt-2`} aria-describedby={described} maxLength={5000} rows={3} value={text} onChange={e => typed(e.target.value)} onBlur={form.leave} /> : <input id={control} className={`${controlClass} mt-2`} aria-describedby={described} maxLength={500} value={text} onChange={e => typed(e.target.value)} onBlur={form.leave} />}<SaveFailed id={failure} state={state} what={field.label} choice={field.kind === "checkbox" || field.kind === "single_choice"} onRetry={form.retry} /></div>;
}
