import { useEffect, useState } from "react";
import { Button, useAutosave, SavedMark, SaveFailed, type FieldEntity } from "../../core/api/extensions";
import type { FieldEntry, FieldValue } from "./model";
import { fieldsApi, readResponse } from "./client";
const controlClass = "min-h-11 w-full min-w-0 rounded-xl border border-line bg-field px-3.5 py-2 text-[15px] text-ink outline-none focus:border-ink in-[.bg-row]:bg-card";
export function CustomFieldDetail({entity,id,autosave=false,onSaved}:{entity:FieldEntity;id:string;autosave?:boolean;onSaved?():void}) {
  return <FieldDetail key={`${entity}:${id}`} entity={entity} id={id} autosave={autosave} onSaved={onSaved} />;
}
function FieldDetail({entity,id,autosave,onSaved}:{entity:FieldEntity;id:string;autosave:boolean;onSaved?():void}) {
  const [fields,setFields] = useState<FieldEntry[]>(), [error,setError] = useState("");
  useEffect(() => { let active = true;
    void fieldsApi[":entity"][":id"].$get({param:{entity,id}}).then(readResponse<FieldEntry[]>).then(value => {if(active)setFields(value);}).catch(() => {if(active)setError("Custom fields could not be loaded. Reload the record to try again.");});
    return () => {active=false;};
  },[entity,id]);
  if (autosave && fields) return <div className="grid gap-4">{fields.map(field => <AutosaveField key={field.id} entity={entity} id={id} field={field} onSaved={onSaved} />)}</div>;
  return <section className="mt-5 min-w-0 rounded-2xl bg-row p-4 sm:p-5" aria-label="Custom fields"><h3 className="text-base font-bold text-ink">Custom fields</h3><p className="mt-1 text-sm text-muted">Internal annotations · visible only to operators</p>{error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : !fields ? <p role="status" className="mt-3 text-sm">Loading custom fields…</p> : fields.length ? <div className="mt-4 grid gap-4">{fields.map(field => <FieldEditor key={field.id} entity={entity} id={id} field={field} />)}</div> : <p className="mt-3 text-sm text-muted">Define fields for this record type in Settings.</p>}</section>;
}
function FieldEditor({entity,id,field}:{entity:FieldEntity;id:string;field:FieldEntry}) {
  const [value,setValue] = useState<FieldValue>(field.value), [saved,setSaved] = useState<FieldValue>(field.value), [busy,setBusy] = useState(false), [message,setMessage] = useState(""), [error,setError] = useState("");
  async function save(next:FieldValue) {
    if(busy)return; setBusy(true);setMessage("");setError("");
    try {await readResponse(await fieldsApi[":entity"][":id"][":fieldId"].$put({param:{entity,id,fieldId:field.id},json:{value:next}}));setSaved(next);setValue(next);setMessage("Saved.");}
    catch(e){setError(e instanceof Error ? e.message : "The value could not be saved.");}finally{setBusy(false);}
  }
  return <div className="min-w-0"><label className="grid min-w-0 gap-2 text-sm font-[650] text-ink">{field.label}{field.kind === "checkbox" ? <input className="h-[18px] w-[18px] accent-ink" type="checkbox" checked={value === true} onChange={e => setValue(e.target.checked)} /> : field.kind === "single_choice" ? <select className={controlClass} value={typeof value === "string" ? value : ""} onChange={e => setValue(e.target.value || null)}><option value="">Not set</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select> : field.kind === "long_text" ? <textarea className={controlClass} maxLength={5000} rows={3} value={typeof value === "string" ? value : ""} onChange={e => setValue(e.target.value)} /> : <input className={controlClass} maxLength={500} value={typeof value === "string" ? value : ""} onChange={e => setValue(e.target.value)} />}</label><p className="mt-1 break-words whitespace-pre-wrap text-sm text-muted">Saved value: {saved === null ? "Not set" : typeof saved === "boolean" ? saved ? "Yes" : "No" : saved}</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={busy || value === saved} aria-label={`Save ${field.label}`} onClick={() => void save(value)}>Save value</Button><Button type="button" variant="quiet" disabled={busy || saved === null} aria-label={`Clear ${field.label}`} onClick={() => void save(null)}>Clear value</Button></div>{error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : message ? <p role="status" className="mt-2 text-sm font-semibold text-ink">{message}</p> : null}</div>;
}

/** Event settings opt in; other detail slots keep their existing behavior. */
function AutosaveField({entity,id,field,onSaved}:{entity:FieldEntity;id:string;field:FieldEntry;onSaved?():void}) {
  const save = useAutosave(`private:${entity}:${id}:${field.id}`, { value: field.value }, async (next, init) => {
    const response = await fetch(`/api/app/custom-fields/${entity}/${id}/${field.id}`, { ...init, method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    await readResponse(response); onSaved?.();
  });
  const value = save.values.value;
  const controlId = `private-${field.id}`;
  return <div className="grid min-w-0 gap-2"><label htmlFor={controlId} className="flex items-center justify-between gap-2 text-sm font-semibold">{field.label}<SavedMark state={save.state("value")} /></label>{field.kind === "checkbox" ? <label className="flex min-h-11 items-center gap-3 text-sm"><input id={controlId} aria-label={field.label} className="h-5 w-5 accent-ink" type="checkbox" checked={value === true} onChange={event => save.choose("value", event.target.checked)} />Enabled</label> : field.kind === "single_choice" ? <select id={controlId} aria-label={field.label} className={controlClass} value={typeof value === "string" ? value : ""} onChange={event => save.choose("value", event.target.value || null)}><option value="">Not set</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select> : field.kind === "long_text" ? <textarea id={controlId} aria-label={field.label} className={controlClass} rows={3} maxLength={5000} value={typeof value === "string" ? value : ""} onChange={event => save.type("value", event.target.value)} onBlur={save.leave} /> : <input id={controlId} aria-label={field.label} className={controlClass} maxLength={500} value={typeof value === "string" ? value : ""} onChange={event => save.type("value", event.target.value)} onBlur={save.leave} />}<SaveFailed id={`${controlId}-failed`} state={save.state("value")} what={field.label.toLowerCase()} onRetry={save.retry} /></div>;
}
