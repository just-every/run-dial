/** HTML time inputs use 00:00 for an exclusive end at the next midnight. */
export function timeInput(minutes: number) {
  if (!Number.isFinite(minutes)) return "";
  const clock = minutes === 1440 ? 0 : minutes;
  return `${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
}
export function timeMinutes(value: string, end = false) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return Number.NaN;
  const [hour, minute] = value.split(":").map(Number);
  const minutes = hour * 60 + minute;
  return end && minutes === 0 ? 1440 : minutes;
}
export function boundaryLabel(minutes: number) { return minutes === 1440 ? "24:00" : timeInput(minutes); }
