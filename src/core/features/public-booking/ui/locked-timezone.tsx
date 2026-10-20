import { useEffect, useState } from "react";
import { canonicalTimezone, formatZonedTime } from "../../../shared/timezone-lock";

/** Detection is local to the hydrated client; callers send it only with an action. */
export function useBrowserTimezone() {
  const [timezone, setTimezone] = useState<string | null>(null);
  useEffect(() => { setTimezone(canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? null); }, []);
  return timezone;
}

export function LockedTimezoneNotice({ timezone }: { timezone: string }) {
  return <section className="pb-timezone-bar pb-locked-timezone" aria-label="Displayed timezone"><p>Times are shown in <strong>{timezone}</strong> because the meeting happens there.</p></section>;
}

export function LockedBookingTime({ startAt, endAt, timezone, browserTimezone }: { startAt: string; endAt?: string; timezone: string; browserTimezone?: string | null }) {
  const range = (zone: string) => <>{formatZonedTime(startAt, zone)}{endAt ? <> – {formatZonedTime(endAt, zone)}</> : null}</>;
  return <><p>{range(timezone)}</p>{browserTimezone && browserTimezone !== timezone ? <p>Your browser time: {range(browserTimezone)}</p> : null}{!browserTimezone ? <p>Zone not provided by invitee.</p> : null}</>;
}
