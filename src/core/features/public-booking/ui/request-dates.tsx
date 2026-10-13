export function RequestDates({ dates, selected, onToggle }: { dates: { value: string; label: string; date: string }[]; selected: string[]; onToggle: (date: { value: string; label: string; date: string }) => void }) {
  return <fieldset className="pb-request-step"><legend>1. Pick future dates</legend><p>Choose each date that could work.</p><div className="pb-day-row">{dates.map((date) => <button className="pb-day-choice" type="button" aria-pressed={selected.includes(date.value)} onClick={() => onToggle(date)} key={date.value}><span>{date.label}</span><strong>{date.date}</strong></button>)}</div></fieldset>;
}


export function nextTenDates(instant: string) { const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); return Array.from({ length: 10 }, (_, index) => { const date = new Date(instant); date.setUTCDate(date.getUTCDate() + index + 1); const [label, month, number] = formatter.format(date).replace(",", "").split(" "); return { value: date.toISOString().slice(0, 10), label, date: `${month} ${number}` }; }); }
