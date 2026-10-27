import { Input, Select } from "../../../app/ui/primitives";
import type { EventLocationOption } from "../locations";

export const newEventLocationLabels = { google_meet: "Google Meet", fixed_link: "Meeting link", phone: "Host phone number", invitee_phone: "Invitee phone number", in_person: "In-person address", ask_invitee: "Ask invitee", custom: "Custom instruction" } as const;
export function StepWhere({ location, onChange }: { location: EventLocationOption; onChange(value: EventLocationOption): void }) {
  return <div className="grid items-start gap-4">
    <label className="grid gap-2 text-sm font-semibold">Location kind<Select value={location.type} onChange={event => { const type = event.target.value as EventLocationOption["type"]; onChange({ ...location, type, label: newEventLocationLabels[type], value: "", prompt: type === "ask_invitee" ? "Where should we meet?" : undefined }); }}>{Object.entries(newEventLocationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
    {location.type === "ask_invitee" ? <label className="grid gap-2 text-sm font-semibold">Required invitee prompt<Input required maxLength={500} value={location.prompt ?? ""} onChange={event => onChange({ ...location, prompt: event.target.value })} /></label> : !["google_meet", "invitee_phone"].includes(location.type) ? <label className="grid gap-2 text-sm font-semibold">Private link, number, or address<Input required maxLength={1000} value={location.value} onChange={event => onChange({ ...location, value: event.target.value })} /></label> : null}
  </div>;
}
