import { useEffect, useId, useRef, useState } from "react";
import { Input } from "../../../app/ui/primitives";
import { canonicalTimezone } from "../../../shared/timezone-lock";
import { searchTimezones } from "../../../shared/timezone-choices";

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
  hostTimezone: string;
  disabled?: boolean;
};

const invalidZoneMessage = "Choose a canonical IANA timezone, such as America/New_York.";

/** Controlled editor only: persistence and the surrounding form belong to its parent. */
export function LockedZoneFields({ value, onChange, hostTimezone, disabled = false }: Props) {
  const id = useId();
  const fields = useRef<HTMLFieldSetElement | null>(null);
  const [draft, setDraft] = useState(value ?? hostTimezone);
  const [error, setError] = useState("");
  const hostZone = canonicalTimezone(hostTimezone);
  const locked = value !== null;
  const options = searchTimezones(draft);

  useEffect(() => {
    setDraft(value ?? hostTimezone);
    setError("");
    fields.current?.querySelector<HTMLInputElement>("input[list]")?.setCustomValidity("");
  }, [value, hostTimezone]);

  return <fieldset ref={fields} disabled={disabled} className="grid gap-3 border-0 p-0">
    <legend className="mb-3 text-sm font-semibold">Displayed timezone</legend>
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
      <input type="checkbox" checked={locked} disabled={!locked && !hostZone} onChange={event => {
        if (!event.target.checked) onChange(null);
        else if (hostZone) onChange(hostZone);
      }} className="h-4 w-4 accent-ink" />
      Lock timezone
    </label>
    <p id={`${id}-note`} className="text-sm leading-6 text-soft">Show meeting times in one timezone because the meeting happens there. The host timezone is selected when you turn this on.</p>
    {!hostZone && !locked ? <p role="status" className="text-sm text-danger">Set a valid host timezone before locking meeting times.</p> : null}
    {locked ? <label className="grid gap-2 text-sm font-semibold" htmlFor={id}>
      Meeting timezone
      <Input id={id} list={`${id}-options`} required autoComplete="off" value={draft}
        aria-invalid={Boolean(error)} aria-describedby={`${id}-note${error ? ` ${id}-error` : ""}`}
        onChange={event => {
          const next = event.target.value;
          const zone = canonicalTimezone(next);
          setDraft(next);
          setError("");
          event.currentTarget.setCustomValidity(zone ? "" : invalidZoneMessage);
          if (zone && zone !== value) onChange(zone);
        }}
        onBlur={event => {
          const zone = canonicalTimezone(event.currentTarget.value);
          event.currentTarget.setCustomValidity(zone ? "" : invalidZoneMessage);
          setError(zone ? "" : invalidZoneMessage);
          if (zone) { setDraft(zone); if (zone !== value) onChange(zone); }
        }}
        onInvalid={() => setError(invalidZoneMessage)} />
      <datalist id={`${id}-options`}>{options.map(zone => <option key={zone} value={zone} />)}</datalist>
      {error ? <span id={`${id}-error`} role="alert" className="text-sm font-normal text-danger">{error}</span> : null}
    </label> : null}
  </fieldset>;
}
