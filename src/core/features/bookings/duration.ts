/** The selected interval, rather than an event's current default, owns booking length. */
export function intervalDuration(startAt: string, endAt: string): number | undefined {
  const duration = (Date.parse(endAt) - Date.parse(startAt)) / 60_000;
  return Number.isInteger(duration) && duration >= 5 && duration <= 480 ? duration : undefined;
}
