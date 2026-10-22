import type { ReportTileKey } from "./catalog";

const period = "The period is whole days in the host time zone, from the first day's midnight to the last day's end.";
const imported = "Imported bookings count by their source creation time and start, never the time they were imported, and are shown separately.";
const zone = "Days and hours are the host's wall clock in the host time zone, so a daylight-saving change moves no booking to the wrong day.";

/** What each tile counts, stated on the tile itself. */
export const definitions: Record<ReportTileKey, string> = {
  created: `Every booking whose creation time falls inside the period, whatever its state now, including ones canceled later. ${period} ${imported}`,
  rescheduled: `Bookings that were rescheduled at least once inside the period, counted once however often they moved; the figure below counts every move. ${period} ${imported}`,
  cancelled: `Bookings whose cancellation time falls inside the period, grouped by the reason given by the invitee or the operator. ${period} ${imported}`,
  attendance: `Bookings that were not canceled, started inside the period and have ended. The rates use only the existing attended and no-show marks: attendance rate is attended divided by marked, no-show rate is no-show divided by marked, and unmarked bookings are listed apart. ${period} ${imported}`,
  lead_time: `From the booking's creation to the start of its first scheduled time, for bookings created inside the period. Average and median are in hours; a booking that was created after its start is left out. ${period} ${imported}`,
  popular_days: `Bookings that were not canceled and start inside the period, by weekday. ${zone} ${period} ${imported}`,
  popular_hours: `Bookings that were not canceled and start inside the period, by starting hour. ${zone} ${period} ${imported}`,
  source: `Bookings created inside the period, by each UTM and source value the invitee arrived with on a tracked booking link; a booking that arrived with none is counted as untagged. ${period} ${imported}`,
  duration: `Bookings created inside the period, by the length of their current time, which is the length the invitee chose. ${period} ${imported}`,
  revenue: `Money Stripe confirmed inside the period, in USD, counted at the time it settled: revenue is first payments, deposits and balances; fees are the late-cancellation and no-show fees Dial charged under a booking's cancellation policy, not Stripe's own processing fees; refunds are refunds Dial issued; net is revenue plus fees minus refunds. ${period}`,
};
