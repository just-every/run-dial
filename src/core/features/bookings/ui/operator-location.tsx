import { Input, Select } from "../../../app/ui/primitives";
import type { EventLocationOption } from "../../event-types/client";

export function OperatorLocation({ locations, id, value, onChoose, onInput }: { locations: EventLocationOption[]; id: string; value: string; onChoose(id: string): void; onInput(value: string): void }) {
  const selected = locations.find(location => location.id === id);
  return <><label className="grid gap-2 text-sm font-[650] text-ink">Meeting location<Select required value={id} onChange={event => onChoose(event.target.value)}><option value="" disabled>Choose a location</option>{locations.map(location => <option value={location.id} key={location.id}>{location.label}</option>)}</Select></label>{selected && ["ask_invitee", "invitee_phone"].includes(selected.type) ? <label className="grid gap-2 text-sm font-[650] text-ink">{selected.type === "invitee_phone" ? "Invitee phone number" : selected.prompt || "Invitee meeting place"}<Input required maxLength={1000} type={selected.type === "invitee_phone" ? "tel" : "text"} value={value} onChange={event => onInput(event.target.value)} /></label> : null}</>;
}
