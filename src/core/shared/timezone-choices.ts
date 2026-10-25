// ICU can list an older identifier even when a current IANA name is accepted.
// Keep the runtime's identifier as the value; the other names are search terms.
const timezoneAliases: Record<string, string[]> = {
  "Africa/Asmera": ["Africa/Asmara"],
  "America/Buenos_Aires": ["America/Argentina/Buenos_Aires"],
  "America/Catamarca": ["America/Argentina/Catamarca"],
  "America/Coral_Harbour": ["America/Atikokan"],
  "America/Cordoba": ["America/Argentina/Cordoba"],
  "America/Godthab": ["America/Nuuk"],
  "America/Indianapolis": ["America/Indiana/Indianapolis"],
  "America/Jujuy": ["America/Argentina/Jujuy"],
  "America/Louisville": ["America/Kentucky/Louisville"],
  "America/Mendoza": ["America/Argentina/Mendoza"],
  "Asia/Calcutta": ["Asia/Kolkata"],
  "Asia/Katmandu": ["Asia/Kathmandu"],
  "Asia/Rangoon": ["Asia/Yangon"],
  "Asia/Saigon": ["Asia/Ho_Chi_Minh"],
  "Europe/Kiev": ["Europe/Kyiv"],
  "Pacific/Enderbury": ["Pacific/Kanton"],
  "Pacific/Ponape": ["Pacific/Pohnpei"],
  "Pacific/Truk": ["Pacific/Chuuk"],
};
const normalize = (value: string) => value.toLowerCase().replace(/[_/]+/g, " ");
export function searchTimezones(query: string, zones = Intl.supportedValuesOf("timeZone"), preferredTimezone?: string) {
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const preferred = preferredTimezone && (preferredTimezone === "UTC" || zones.includes(preferredTimezone)) ? preferredTimezone
    : Object.keys(timezoneAliases).find(zone => zones.includes(zone) && timezoneAliases[zone].includes(preferredTimezone ?? ""));
  return [...new Set([...(preferred ? [preferred] : []), "UTC", ...zones])]
    .filter(zone => {
      const names = normalize([zone, ...(timezoneAliases[zone] ?? [])].join(" "));
      return words.every(word => names.includes(word));
    });
}
export function deviceTimezone(hostTimezone: string) { return Intl.DateTimeFormat().resolvedOptions().timeZone || hostTimezone; }
