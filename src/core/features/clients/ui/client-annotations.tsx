import { useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Card, Button, Input, Textarea, noticeClassName } from "../../../app/ui/primitives";
import type { ClientHistory } from "../types";
import { useHydrated } from "../../../app/use-hydrated";

export function ClientAnnotations({ history, onChanged, onMerged }: { history: ClientHistory; onChanged(): void; onMerged(email: string): void }) {
  const hydrated=useHydrated();
  const [body,setBody] = useState(""), [label,setLabel] = useState(""), [value,setValue] = useState(""), [target,setTarget] = useState(""), [busy,setBusy] = useState(false), [notice,setNotice] = useState("");
  async function save(kind: "note" | "field" | "merge") {
    setBusy(true); setNotice("");
    try {
      const response = kind === "note" ? await api.api.app.clients.notes.$post({json:{email:history.email,body}})
        : kind === "field" ? await api.api.app.clients.fields.$post({json:{email:history.email,label,value}})
        : await api.api.app.clients.merge.$post({json:{source:history.email,target}});
      if (!response.ok) { setNotice(await errorMessage(response)); return; }
      if (kind === "merge") { const merged=await response.json() as {email:string}; onMerged(merged.email); }
      else { setBody(""); setLabel(""); setValue(""); onChanged(); }
    } catch { setNotice("The client change could not be saved."); }
    finally { setBusy(false); }
  }
  return <div data-client-annotations-ready={hydrated&&!busy}><Card className="min-w-0 p-5 sm:p-6">
    <h2 className="text-xl font-bold">Client notes and custom fields</h2>
    {history.aliases.length > 1 ? <p className="mt-3 break-all text-sm text-soft">Addresses: {history.aliases.join(", ")}</p> : null}
    <ul className="mt-4 grid gap-3" aria-label="Client notes">{history.notes.map(note=><li key={note.id} className="rounded-xl bg-row p-3"><p className="whitespace-pre-wrap break-words">{note.body}</p><p className="mt-2 break-all text-xs text-muted">Operator {note.operatorId}</p></li>)}</ul>
    <dl className="mt-4 grid gap-3">{history.fields.map(field=><div key={field.id}><dt className="break-words font-semibold">{field.label}</dt><dd className="whitespace-pre-wrap break-words text-sm">{field.value}</dd></div>)}</dl>
    {notice ? <p role="alert" className={noticeClassName("error","mt-4")}>{notice}</p> : null}
    <form className="mt-5 grid gap-3" onSubmit={event=>{event.preventDefault();void save("note");}}><label className="grid gap-2 text-sm font-semibold">New client note<Textarea disabled={!hydrated||busy} required maxLength={5000} value={body} onChange={event=>setBody(event.target.value)} /></label><Button disabled={!hydrated||busy} type="submit" className="justify-self-start">Add note</Button></form>
    <form className="mt-6 grid gap-3 border-t border-line-soft pt-5" onSubmit={event=>{event.preventDefault();void save("field");}}><label className="grid gap-2 text-sm font-semibold">Custom field name<Input disabled={!hydrated||busy} required maxLength={120} value={label} onChange={event=>setLabel(event.target.value)} /></label><label className="grid gap-2 text-sm font-semibold">Custom field value<Input disabled={!hydrated||busy} required maxLength={5000} value={value} onChange={event=>setValue(event.target.value)} /></label><Button disabled={!hydrated||busy} type="submit" variant="secondary" className="justify-self-start">Add client field</Button></form>
    <form className="mt-6 grid gap-3 border-t border-line-soft pt-5" onSubmit={event=>{event.preventDefault();if(window.confirm("Merge these clients? Their bookings, notes and fields will belong to one client. Erasing that client erases every merged address."))void save("merge");}}><label className="grid gap-2 text-sm font-semibold">Merge this client into<Input disabled={!hydrated||busy} type="email" required value={target} onChange={event=>setTarget(event.target.value)} /></label><p className="text-sm text-muted">The other address must already be a client. Every booking stays intact and this address becomes an alias.</p><Button disabled={!hydrated||busy} type="submit" variant="secondary" className="justify-self-start">Merge clients</Button></form>
  </Card></div>;
}
