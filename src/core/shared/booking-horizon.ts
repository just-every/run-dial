import seed from "../../../seed.json";

type Horizon = {
  bookingHorizonDays: number;
  bookingHorizonMode?: "calendar_days" | "weekdays" | "fixed_range" | "indefinite";
  bookingStartDate?: string | null;
  bookingEndDate?: string | null;
};
const lookahead = seed.limits.availabilityLookaheadDays;
function plus(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
/** Inclusive host-date boundary, independent of the invitee's device zone. */
export function horizonLastDate(event: Horizon, today: string) {
  const ceiling = plus(today, lookahead);
  if (event.bookingHorizonMode === "indefinite") return ceiling;
  if (event.bookingHorizonMode === "fixed_range") return event.bookingEndDate && event.bookingEndDate < ceiling ? event.bookingEndDate : ceiling;
  if (event.bookingHorizonMode === "weekdays") {
    let date = today, counted = 0;
    while (counted < event.bookingHorizonDays && date < ceiling) {
      date = plus(date, 1);
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (weekday !== 0 && weekday !== 6) counted++;
    }
    return date;
  }
  return plus(today, Math.min(event.bookingHorizonDays, lookahead));
}
export function horizonAllows(event: Horizon, date: string, today: string) {
  if (date < today || date > horizonLastDate(event, today)) return false;
  return event.bookingHorizonMode !== "fixed_range" || Boolean(event.bookingStartDate && event.bookingEndDate && date >= event.bookingStartDate && date <= event.bookingEndDate);
}
