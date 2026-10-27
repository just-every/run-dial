import { useState } from "react";
import { Input, buttonClassName } from "../../../app/ui/primitives";

const lengths = [15, 30, 45, 60, 90];
export function StepLength({ minutes, onChange }: { minutes: number; onChange(value: number): void }) {
  const [other, setOther] = useState(!lengths.includes(minutes));
  return <div className="grid gap-4">
    <div role="group" aria-label="Length" className="flex flex-wrap gap-2">{lengths.map(value => <button key={value} type="button" aria-pressed={!other && minutes === value} className={buttonClassName("secondary", !other && minutes === value ? "!border-transparent !bg-gold-wash" : "")} onClick={() => { setOther(false); onChange(value); }}>{value} min</button>)}<button type="button" aria-pressed={other} className={buttonClassName("secondary", other ? "!border-transparent !bg-gold-wash" : "")} onClick={() => setOther(true)}>Other</button></div>
    {other ? <label className="grid gap-2 text-sm font-semibold">Length (minutes)<Input type="number" required min={5} max={480} value={minutes || ""} onChange={event => onChange(Number(event.target.value))} /></label> : null}
  </div>;
}
