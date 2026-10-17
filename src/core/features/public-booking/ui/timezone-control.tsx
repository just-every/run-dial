import { useEffect, useId, useMemo, useState } from "react";
import { deviceTimezone, searchTimezones, validTimezone } from "../../../shared/timezone-choices";

export function TimezoneControl({ timezone, hostTimezone, onChange, disabled = false }: { timezone: string; hostTimezone: string; onChange: (zone: string) => void; disabled?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState(timezone), [open, setOpen] = useState(false), [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const options = useMemo(() => searchTimezones(draft), [draft]);
  useEffect(() => { setDraft(timezone); setError(""); setOpen(false); }, [timezone]);
  function commit(zone: string) { setDraft(zone); setError(""); setOpen(false); onChange(zone); }
  function validate() {
    const zone = validTimezone(draft);
    if (zone) { if (zone !== timezone) commit(zone); else setOpen(false); }
    else { setError("Choose a canonical IANA timezone. Your current zone and times are unchanged."); setOpen(false); }
  }
  return <section className="pb-timezone-bar" aria-label="Displayed timezone"><div>Times in <strong>{timezone}</strong></div><div className="pb-zone-control"><label htmlFor={id}>View in timezone</label><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open && options.length > 0} aria-controls={`${id}-options`} aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} disabled={disabled} value={draft} onChange={event => { setDraft(event.target.value); setError(""); setActive(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={event => { if (event.relatedTarget instanceof Node && event.currentTarget.parentElement?.contains(event.relatedTarget)) return; validate(); }} onKeyDown={event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(current => options.length ? (current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length : 0); }
    if (event.key === "Enter") { event.preventDefault(); const zone = validTimezone(draft) ?? (open ? options[active] : undefined); if (zone) commit(zone); else validate(); }
    if (event.key === "Escape") { event.preventDefault(); setDraft(timezone); setError(""); setOpen(false); }
  }} /><ul hidden={!open || !options.length} id={`${id}-options`} role="listbox" aria-label="Matching timezones">{options.map((zone, index) => <li role="option" tabIndex={-1} id={`${id}-option-${index}`} aria-selected={index === active} key={zone} onMouseDown={event => event.preventDefault()} onClick={() => commit(zone)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") commit(zone); }}>{zone}</li>)}</ul>{error ? <p id={`${id}-error`} role="alert">{error}</p> : null}</div><button type="button" className="pb-quiet-button" disabled={disabled} onClick={() => commit(deviceTimezone(hostTimezone))}>Device zone</button></section>;
}
