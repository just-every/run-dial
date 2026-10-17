import { isCanonicalIanaTimeZone } from "./scheduling";

export function searchTimezones(query: string, zones = Intl.supportedValuesOf("timeZone")) {
  const words = query.trim().toLowerCase().replace(/[_/]+/g, " ").split(/\s+/).filter(Boolean);
  return [...new Set(["UTC", ...zones])].filter(zone => words.every(word => zone.toLowerCase().replace(/[_/]+/g, " ").includes(word))).slice(0, 8);
}
export function validTimezone(value: string) { const zone = value.trim(); return isCanonicalIanaTimeZone(zone) ? zone : undefined; }
export function deviceTimezone(hostTimezone: string) { return Intl.DateTimeFormat().resolvedOptions().timeZone || hostTimezone; }
