import { isCanonicalIanaTimeZone } from "./scheduling";

/** The persisted event setting: null means the invitee may choose their zone. */
export type TimezoneLock = string | null;

/** Accept the same canonical identifiers as scheduling validation, including UTC. */
export function canonicalTimezone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const zone = value.trim();
  return isCanonicalIanaTimeZone(zone) ? zone : undefined;
}

/** Missing settings on existing event types are unlocked; malformed locks fail loudly. */
export function resolveLockedTimezone(value: string | null | undefined): TimezoneLock {
  if (value === null || value === undefined) return null;
  return requireTimezone(value);
}

/** Browser detection belongs to the caller and must never run during server rendering. */
export function resolveDisplayTimezone(lockedTimezone: string | null | undefined, inviteeTimezone: string): string {
  return resolveLockedTimezone(lockedTimezone) ?? requireTimezone(inviteeTimezone);
}

/** Name and numeric offset at this instant, including across daylight-saving changes. */
export function formatTimezoneLabel(value: string | number | Date, timezone: string): string {
  const zone = requireTimezone(timezone);
  const instant = instantDate(value);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(instant).find(part => part.type === "timeZoneName")?.value;
  if (!offset) throw new RangeError(`No UTC offset could be resolved for ${zone}.`);
  return `${zone} (${offset === "GMT" ? "UTC+00:00" : offset.replace(/^GMT/, "UTC")})`;
}

/** Each formatted time carries its own zone and offset, even when used in a range. */
export function formatZonedTime(value: string | number | Date, timezone: string): string {
  const zone = requireTimezone(timezone);
  const instant = instantDate(value);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(instant);
  return `${time} · ${formatTimezoneLabel(instant, zone)}`;
}

function requireTimezone(value: string): string {
  const zone = canonicalTimezone(value);
  if (!zone) throw new RangeError(`Use a canonical IANA timezone: ${value}.`);
  return zone;
}

function instantDate(value: string | number | Date): Date {
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new RangeError("A valid instant is required to format a timezone.");
  return instant;
}
