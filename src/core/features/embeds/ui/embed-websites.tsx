import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input } from "../../../app/ui/primitives";

export type EmbedMode = "inline" | "modal";

type Props = {
  origins: string[];
  disabled: boolean;
  copyMode?: EmbedMode;
  onCancelCopy(): void;
  onSave(origins: string[], mode?: EmbedMode): Promise<boolean>;
};

export function EmbedWebsites({ origins, disabled, copyMode, onCancelCopy, onSave }: Props) {
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const open = adding || Boolean(copyMode);
  const site = websiteOrigin(address);
  const kept = origins.filter(origin => origin !== removing);

  useEffect(() => { if (open) form.current?.querySelector("input")?.focus(); }, [open]);

  function close() {
    setAdding(false); setAddress(""); setError(""); onCancelCopy();
  }

  async function allow(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    if (!site) { setError("Enter a website address, such as https://example.com."); return; }
    if (origins.includes(site)) { setError("This website already allows embeds."); return; }
    if (await onSave([...origins, site], copyMode)) close();
  }

  return <div className="mt-6 grid gap-3 text-sm leading-6">
    {origins.length ? <>
      <p className="font-semibold text-ink">Websites</p>
      <ul aria-label="Embed websites" className="grid gap-2">
        {origins.map(origin => <li key={origin} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 [overflow-wrap:anywhere]">{origin}</span>
          <Button type="button" variant="quiet" aria-label={`Remove ${origin}`} disabled={disabled || open} onClick={() => { setRemoving(origin); setError(""); }}>Remove</Button>
        </li>)}
      </ul>
    </> : null}
    {removing ? <div className="rounded-xl bg-wash p-4">
      <p className="font-semibold [overflow-wrap:anywhere]">Remove {removing}?</p>
      {kept.length ? <><p className="mt-2">Keep embeds on:</p><ul className="mt-1 grid gap-1">{kept.map(origin => <li className="[overflow-wrap:anywhere]" key={origin}>{origin}</li>)}</ul></> : <p className="mt-2">Embeds will stop on every website.</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" variant="danger" disabled={disabled} onClick={async () => { if (await onSave(kept)) setRemoving(undefined); }}>Remove website</Button>
        <Button type="button" variant="quiet" disabled={disabled} onClick={() => setRemoving(undefined)}>Keep website</Button>
      </div>
    </div> : open ? <form ref={form} onSubmit={event => void allow(event)} noValidate className="grid gap-3">
      <label className="grid gap-2 font-semibold text-ink">Website address
        <Input value={address} onChange={event => { setAddress(event.target.value); setError(""); }} placeholder="https://example.com" autoComplete="url" inputMode="url" maxLength={2048} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? "embed-website-error" : undefined} />
      </label>
      {site ? <p className="[overflow-wrap:anywhere]">Allow embeds on <strong>{site}</strong>?</p> : null}
      {error ? <p id="embed-website-error" className="text-danger" role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={disabled}>{disabled ? "Saving…" : copyMode ? "Allow website and copy" : "Allow website"}</Button>
        <Button type="button" variant="quiet" disabled={disabled} onClick={close}>Cancel</Button>
      </div>
    </form> : origins.length < 30 ? <div><Button type="button" variant="quiet" disabled={disabled} onClick={() => setAdding(true)}>Add website</Button></div> : null}
  </div>;
}

/** A pasted page address grants its exact site, retaining loopback ports for local previews. */
function websiteOrigin(address: string) {
  const value = address.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !local) || url.username || url.password || url.hostname.includes("*") || url.origin.length > 300) return undefined;
    return url.origin;
  } catch { return undefined; }
}
