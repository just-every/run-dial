import type { ReportTileKey } from "./catalog";

/** Rules shared by every figure, displayed once above the report. */
export const countingNotes = [
  "The period runs from the first day's midnight through the last day's end in the host time zone.",
  "Imported bookings use their source creation and start times, never their import time, and are shown separately.",
  "Days and hours follow the host's wall clock, including daylight-saving changes.",
] as const;

/** Each tile states only its own counting rule. */
export const definitions: Record<ReportTileKey, string> = {
  created: "Bookings created in the period, including those cancelled later.",
  rescheduled: "Bookings moved in the period, counted once each; total moves counts every reschedule.",
  cancelled: "Bookings cancelled in the period, grouped by the reason given.",
  attendance: "Ended, uncancelled bookings starting in the period; each rate divides its attended or no-show marks by all marked bookings, with unmarked bookings listed separately.",
  lead_time: "Hours from creation to the first scheduled start for bookings created in the period, excluding bookings created after that start, shown as average and median.",
  popular_days: "Uncancelled bookings starting in the period, grouped by weekday.",
  popular_hours: "Uncancelled bookings starting in the period, grouped by starting hour.",
  source: "Bookings created in the period, grouped by their tracked-link UTM and source values, with bookings carrying none counted as untagged.",
  duration: "Bookings created in the period, grouped by the invitee's chosen length at their current scheduled time.",
  revenue: "Money settled by Stripe in the period: revenue is USD payments, deposits, balances and paid invoices including tax; fees are Dial cancellation/no-show charges, excluding Stripe processing fees; refunds are issued refunds; net is revenue plus fees minus refunds.",
};
