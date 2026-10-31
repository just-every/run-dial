import { useEffect, useId, useMemo, useRef, useState } from "react";
import { deviceTimezone, searchTimezones } from "./timezone-choices";
import "./timezone-picker.css";

type Props = {
  label: string;
  accessibleLabel?: string;
  value: string;
  onChange: (zone: string) => void;
  deviceZone?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Offers an empty choice with this wording; the value is "" while it is chosen. */
  emptyLabel?: string;
};

/** Search text stays local; only choosing a supported result changes the value. */
export function TimezonePicker({ label, accessibleLabel, value, onChange, deviceZone, disabled = false, required = false, className = "", emptyLabel }: Props) {
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  const shown = (zone: string) => zone || emptyLabel || "";
  const [draft, setDraft] = useState(shown(value));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const browserZone = deviceZone ?? deviceTimezone(value);
  const options = useMemo(() => [...(emptyLabel && !query.trim() ? [""] : []), ...searchTimezones(query, undefined, browserZone)], [query, browserZone, emptyLabel]);
  const empty = open && options.length === 0;

  useEffect(() => { setDraft(shown(value)); setQuery(""); setOpen(false); setActive(0); }, [value]);
  useEffect(() => {
    const menu = list.current;
    const option = menu?.children[active];
    if (!open || !menu || !option) return;
    const bounds = menu.getBoundingClientRect(), choice = option.getBoundingClientRect();
    if (choice.top < bounds.top) menu.scrollTop -= bounds.top - choice.top;
    else if (choice.bottom > bounds.bottom) menu.scrollTop += choice.bottom - bounds.bottom;
  }, [active, open, query]);

  function restore() { setDraft(shown(value)); setQuery(""); setOpen(false); setActive(0); }
  function show(input: HTMLInputElement) { setDraft(shown(value)); setQuery(""); setActive(0); setOpen(true); input.select(); }
  function commit(zone: string) { setDraft(shown(zone)); setQuery(""); setOpen(false); setActive(0); onChange(zone); }

  return <div className={`dial-timezone-picker ${className}`}>
    <label htmlFor={id}>{label}</label>
    <div className="dial-timezone-picker__control">
      <input id={id} className="dial-timezone-picker__input" role="combobox" aria-label={accessibleLabel}
        aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined}
        aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
        aria-describedby={empty ? `${id}-empty` : undefined}
        autoComplete="off" spellCheck={false} disabled={disabled} required={required} value={draft}
        onFocus={event => show(event.currentTarget)}
        onClick={event => { if (!open) show(event.currentTarget); else if (!query) event.currentTarget.select(); }}
        onChange={event => { setDraft(event.target.value); setQuery(event.target.value); setActive(0); setOpen(true); }}
        onBlur={restore}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) { show(event.currentTarget); setActive(event.key === "ArrowDown" ? 0 : options.length - 1); }
            else setActive(current => options.length ? (current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length : 0);
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            if (options[active] !== undefined) commit(options[active]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault(); event.stopPropagation(); restore();
          }
        }} />
      {open ? <div className="dial-timezone-picker__menu">
        <ul ref={list} id={`${id}-options`} role="listbox" tabIndex={-1} aria-label="Matching timezones">
          {options.map((zone, index) => <li key={zone || "empty"} id={`${id}-option-${index}`} role="option" tabIndex={-1} aria-selected={index === active}
            onPointerDown={event => event.preventDefault()} onClick={() => commit(zone)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); commit(zone); } }}>{shown(zone)}</li>)}
        </ul>
        {empty ? <p id={`${id}-empty`} role="status">No matching timezones. Choose a result to change your timezone.</p> : null}
      </div> : null}
    </div>
  </div>;
}
