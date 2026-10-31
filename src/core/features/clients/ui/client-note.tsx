import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Textarea, noticeClassName } from "../../../app/ui/primitives";
import { InlineConfirm } from "../../../app/ui/autosave/inline-confirm";
import { operatorDateTime } from "../../../shared/operator-format";
import type { ClientHistory } from "../types";

const quiet = "min-h-11 min-w-11 rounded px-2 text-sm font-semibold text-soft underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 sm:min-h-8";

/** One saved note: who wrote it and when on the meta line, with Edit and Remove on hover and focus (always on touch). */
export function ClientNote({ note, email, timezone, disabled, onChanged }: { note: ClientHistory["notes"][number]; email: string; timezone: string; disabled: boolean; onChanged(): void }) {
  const form = useRef<HTMLFormElement>(null), [mode, setMode] = useState<"view" | "edit" | "remove">("view"), [body, setBody] = useState(note.body), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => { if (mode === "edit") form.current?.querySelector("textarea")?.focus(); }, [mode]);
  async function run(change: () => Promise<{ ok: boolean; json(): Promise<unknown> }>) {
    setBusy(true); setNotice("");
    try {
      const response = await change();
      if (!response.ok) { setNotice(await errorMessage(response)); return; }
      setMode("view"); onChanged();
    } catch { setNotice("The note could not be changed."); }
    finally { setBusy(false); }
  }
  const param = { id: note.id };
  return <li className="group rounded-xl bg-row p-3">
    {mode === "edit" ? <form ref={form} className="grid gap-3" onSubmit={event => { event.preventDefault(); void run(() => api.api.app.clients.notes[":id"].edit.$post({ param, json: { email, body } })); }}>
      <label className="grid gap-2 text-sm font-semibold">Edit note<Textarea disabled={busy} required maxLength={5000} value={body} onChange={event => setBody(event.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><Button disabled={busy} type="submit">Save note</Button><Button disabled={busy} type="button" variant="secondary" onClick={() => { setBody(note.body); setNotice(""); setMode("view"); }}>Cancel</Button></div>
    </form> : <p className="whitespace-pre-wrap break-words">{note.body}</p>}
    {mode === "remove" ? <InlineConfirm question="Remove this note?" detail="It is deleted for good." action="Remove note" keep="Keep it" onAction={() => void run(() => api.api.app.clients.notes[":id"].remove.$post({ param, json: { email } }))} onKeep={() => setMode("view")} /> : null}
    {notice ? <p role="alert" className={noticeClassName("error", "mt-3")}>{notice}</p> : null}
    {mode === "view" ? <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted">
      <span className="break-words">{note.author || "A former teammate"} · {operatorDateTime(note.createdAt, timezone)}</span>
      <span className="flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <button type="button" disabled={disabled} className={quiet} aria-label="Edit note" onClick={() => setMode("edit")}>Edit</button>
        <button type="button" disabled={disabled} className={quiet} aria-label="Remove note" onClick={() => setMode("remove")}>Remove</button>
      </span>
    </div> : null}
  </li>;
}
