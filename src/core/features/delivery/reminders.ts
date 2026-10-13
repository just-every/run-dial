import { bookingJoinUrl, bookingReminderHtml } from "./booking-mails";
import { inviteeCalendarUrl } from "./branded-layout";

export type ReminderBooking = { title: string; hostName: string; durationMinutes: number; startAt: string; endAt: string; hostTimezone: string; inviteeTimezone: string; locationType: string; locationValue: string; locationLabel: string; meetingUrl: string | null; calendarState: string };
export function reminderMessage(booking: ReminderBooking, payload: Record<string, unknown>) {
  if (typeof payload.to !== "string" || !["invitee", "operator"].includes(String(payload.recipientRole))) return undefined;
  const invitee = payload.recipientRole === "invitee";
  if (invitee && typeof payload.manageUrl !== "string") throw new Error("Missing reminder manage capability");
  const zone = invitee ? booking.inviteeTimezone : booking.hostTimezone;
  const format = (instant: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, dateStyle: "full", timeStyle: "long" }).format(new Date(instant));
  const location = booking.locationType === "google_meet" ? booking.meetingUrl ?? "Meeting link pending — contact the host if it is not ready." : booking.locationValue;
  const timeRange = `${format(booking.startAt)} – ${format(booking.endAt)} (${zone})`;
  const manageUrl = invitee && typeof payload.manageUrl === "string" ? payload.manageUrl : undefined;
  if (invitee && !manageUrl) return undefined;
  const joinUrl = bookingJoinUrl(booking);
  const originalText = `${booking.title}\n${timeRange}\n${booking.locationLabel}: ${location}${invitee ? `\nManage this booking: ${manageUrl}` : ""}`;
  const text = [
    originalText,
    "",
    `Host: ${booking.hostName}`,
    `Duration: ${booking.durationMinutes} minutes`,
    `Calendar setup: ${booking.calendarState}.`,
    ...(joinUrl ? [`Join session: ${joinUrl}`] : []),
    ...(invitee && manageUrl ? [`Add to calendar: ${inviteeCalendarUrl(manageUrl)}`] : []),
  ].join("\n");
  return {
    to: payload.to,
    subject: `Reminder: ${booking.title}`,
    text,
    html: bookingReminderHtml({
      hostName: booking.hostName,
      eventTitle: booking.title,
      startAt: booking.startAt,
      endAt: booking.endAt,
      durationMinutes: booking.durationMinutes,
      inviteeTimezone: booking.inviteeTimezone,
      hostTimezone: booking.hostTimezone,
      locationType: booking.locationType,
      locationLabel: booking.locationLabel,
      locationValue: booking.locationValue,
      meetingUrl: booking.meetingUrl,
      calendarState: booking.calendarState,
      recipientRole: invitee ? "invitee" : "operator",
      timeRange,
      location,
      ...(manageUrl ? { manageUrl } : {}),
    }),
  };
}
