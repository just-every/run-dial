export function searchTimezones(query: string, zones = Intl.supportedValuesOf("timeZone"), preferredTimezone?: string) {
  const words = query.trim().toLowerCase().replace(/[_/]+/g, " ").split(/\s+/).filter(Boolean);
  const preferred = preferredTimezone && (preferredTimezone === "UTC" || zones.includes(preferredTimezone)) ? preferredTimezone : undefined;
  return [...new Set([...(preferred ? [preferred] : []), "UTC", ...zones])]
    .filter(zone => words.every(word => zone.toLowerCase().replace(/[_/]+/g, " ").includes(word)));
}
export function deviceTimezone(hostTimezone: string) { return Intl.DateTimeFormat().resolvedOptions().timeZone || hostTimezone; }
