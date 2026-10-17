import type { PublicLocationOption } from "../../event-types/client";
import { normalizePhoneNumber } from "../../../shared/phone";

export function bookingLocationError(locations: PublicLocationOption[] | undefined, id: string, value: string): string | undefined {
  if (!locations) return undefined;
  const location = locations.find(location => location.id === id);
  if (!location) return "Choose a meeting location.";
  if (location.input === "phone" && !normalizePhoneNumber(value)) return "Enter a valid US or international phone number.";
  if (location.input === "place" && !value.trim()) return "Enter the meeting location.";
  return undefined;
}
export function BookingLocation({ locations, id, value, onChoose, onInput, error }: { locations?: PublicLocationOption[]; id: string; value: string; onChoose(id: string): void; onInput(value: string): void; error?: string }) {
  if (!locations?.length) return null;
  const selected = locations.find(location => location.id === id);
  return <><label><span className="pb-label-text">Meeting location<span aria-hidden="true"> *</span></span><select aria-label="Meeting location" required value={id} onChange={event => onChoose(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "booking-location-error" : undefined}><option value="" disabled>Choose a location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.label}</option>)}</select></label>{selected?.input ? <label><span className="pb-label-text">{selected.prompt || (selected.input === "phone" ? "Phone number the host should call" : "Where should we meet?")}<span aria-hidden="true"> *</span></span><input aria-label={selected.input === "phone" ? "Phone number the host should call" : selected.prompt || "Where should we meet?"} type={selected.input === "phone" ? "tel" : "text"} autoComplete={selected.input === "phone" ? "tel" : "off"} required maxLength={1000} value={value} onChange={event => onInput(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "booking-location-error" : undefined} /></label> : null}{error ? <p className="pb-field-error" id="booking-location-error">{error}</p> : null}</>;
}
