import { useEffect, useState } from "react";
import { Button, Card, type FieldEntity } from "../../core/api/extensions";
import type { FieldDefinition } from "./model";
import { fieldsApi, readResponse } from "./client";
export const controlClass = "min-h-11 w-full min-w-0 rounded-xl border border-line bg-field px-3.5 py-2 text-[15px] text-ink outline-none focus:border-ink in-[.bg-row]:bg-card";
export function CustomFieldSettings() {
  const [fields,setFields] = useState<FieldDefinition[]>([]), [entity,setEntity] = useState<FieldEntity>("booking");
  const [label,setLabel] = useState(""), [kind,setKind] = useState<FieldDefinition["kind"]>("text"), [options,setOptions] = useState("");
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [notice,setNotice] = useState("");
  async function load() { setFields(await readResponse<FieldDefinition[]>(await fieldsApi.$get())); }
  useEffect(() => { void load().catch(() => setError("Custom fields could not be loaded.")); }, []);
  async function create() {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      await readResponse(await fieldsApi.$post({json:{entity,label,kind,options:kind === "single_choice" ? options.split("\n").map(value => value.trim()).filter(Boolean) : []}}));
      setLabel("");setOptions("");await load();setNotice("Custom field added.");
    } catch(e) {setError(e instanceof Error ? e.message : "Custom field could not be added.");} finally {setBusy(false);}
  }
  async function remove(field:FieldDefinition) {
    if (busy || !window.confirm(`Delete ${field.label} and all its saved values?`)) return;
    setBusy(true);setError("");setNotice("");
    try {await readResponse(await fieldsApi[":fieldId"].$delete({param:{fieldId:field.id}}));await load();setNotice("Custom field and its values deleted.");}
    catch(e) {setError(e instanceof Error ? e.message : "Custom field could not be deleted.");} finally {setBusy(false);}
  }
  return <Card className="min-w-0 p-5 sm:p-6 xl:col-span-2"><h2 className="text-[19px] font-[750] leading-[1.25] tracking-[-.01em] text-ink">Custom fields</h2><p className="mt-2 text-sm leading-6 text-soft">Private notes. Edit values on each record. These fields are never shown to invitees or sent in mail.</p>
    {error ? <p role="alert" className="mt-3 rounded-[14px] bg-danger-wash p-3 text-sm text-danger">{error}</p> : null}{notice ? <p role="status" className="mt-3 rounded-[14px] bg-gold-wash p-3 text-sm text-ink">{notice}</p> : null}
    <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-[650] text-ink">Record type<select className={controlClass} value={entity} onChange={e => setEntity(e.target.value as FieldEntity)}><option value="booking">Booking</option><option value="eventType">Event type</option><option value="availabilityRequest">Availability request</option></select></label><label className="grid gap-2 text-sm font-[650] text-ink">Field label<input className={controlClass} value={label} maxLength={120} onChange={e => setLabel(e.target.value)} /></label><label className="grid gap-2 text-sm font-[650] text-ink">Field type<select className={controlClass} value={kind} onChange={e => setKind(e.target.value as FieldDefinition["kind"])}><option value="text">Text</option><option value="long_text">Long text</option><option value="single_choice">Single choice</option><option value="checkbox">Checkbox</option></select></label>{kind === "single_choice" ? <label className="grid gap-2 text-sm font-[650] text-ink">Choices (one per line)<textarea className={controlClass} value={options} onChange={e => setOptions(e.target.value)} /></label> : null}</div>
    <Button className="mt-4" type="button" disabled={busy || !label.trim()} onClick={() => void create()}>Add custom field</Button>
    <ul className="mt-5 grid gap-2">{fields.filter(field => field.entity === entity).map(field => <li className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl bg-row px-4 py-3" key={field.id}><span className="min-w-0 break-words"><strong>{field.label}</strong> <span className="text-sm text-muted">{field.kind.replaceAll("_"," ")}</span></span><Button type="button" variant="quiet" disabled={busy} aria-label={`Delete ${field.label}`} onClick={() => void remove(field)}>Delete</Button></li>)}</ul>
  </Card>;
}
