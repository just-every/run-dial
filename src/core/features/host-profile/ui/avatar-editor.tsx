import { useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Input } from "../../../app/ui/primitives";
import type { ProfileRecord } from "../repository";

export function AvatarEditor({ saved, avatarKey, disabled, onSaved }: { saved: boolean; avatarKey?: string | null; disabled: boolean; onSaved: (profile: ProfileRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(file?: File) {
    if (disabled || busy || !saved) return;
    setBusy(true); setError("");
    try {
      const response = file
        ? await fetch("/api/app/profile/avatar", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": file.type }, body: file })
        : await api.api.app.profile.avatar.$delete();
      if (response.ok) onSaved(await response.json());
      else setError(await errorMessage(response));
    } catch { setError("The avatar change could not be checked. Reload the profile and try again."); }
    finally { setBusy(false); }
  }
  return <Card className="p-5 sm:p-6"><h2 className="text-[19px] font-[750] leading-[1.25] tracking-[-.01em]">Host avatar</h2><p id="avatar-help" className="mt-2 text-sm leading-6 text-soft">JPEG, PNG, WebP or AVIF, up to 5 MiB. {saved ? "Shown on your public scheduling pages." : "Save host details before adding an avatar."}</p>
    <label className="mt-4 grid gap-2 text-sm font-[650] text-ink"><span>{busy ? "Updating avatar…" : avatarKey ? "Replace avatar" : "Upload avatar"}</span><Input className="py-1.5 file:mr-3 file:min-h-8 file:cursor-pointer file:rounded-full file:border file:border-solid file:border-line file:bg-card file:px-4 file:text-sm file:font-semibold file:text-ink" type="file" accept="image/jpeg,image/png,image/webp,image/avif" aria-describedby="avatar-help" disabled={disabled || busy || !saved} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void change(file); }} /></label>
    {avatarKey ? <Button className="mt-3" type="button" variant="quiet" disabled={disabled || busy} onClick={() => void change()}>Remove avatar</Button> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
  </Card>;
}
