type Durations = { durationMinutes: number; durationOptionsMinutes?: number[] };
/** Old write clients express a singleton by supplying only durationMinutes. */
export function eventDurationOptions(event: Durations): number[] {
  return event.durationOptionsMinutes ?? [event.durationMinutes];
}
export function resolveEventDuration(event: Durations, requested?: number, retained?: number): number | undefined {
  const duration = requested ?? event.durationMinutes;
  return Number.isInteger(duration) && duration >= 5 && duration <= 480 && (eventDurationOptions(event).includes(duration) || duration === retained) ? duration : undefined;
}
