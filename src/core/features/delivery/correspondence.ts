import { appendInvitationManageLink, renderCalendarCorrespondence, renderMailCorrespondence } from "../../shared/correspondence";
import { formatTimeRange } from "./booking-mail-times";
import { inviteeCalendarUrl, renderBrandedMail } from "./branded-layout";
import type { BookingCorrespondence } from "./correspondence-repository";

export function templatedCalendar<T extends { title: string; description: string; startAt: string; endAt: string; timeZone: string }>(event: T, data?: BookingCorrespondence): T {
  if (!data) return event;
  const publicKeys = new Set(data.questions.filter(question => !question.private).map(question => question.key));
  const values = { ...data.values, "date and time": formatTimeRange(event.startAt, event.endAt, event.timeZone, true), answers: Object.fromEntries(Object.entries(data.values.answers).filter(([key]) => publicKeys.has(key))) };
  const rendered = data.configured ? renderCalendarCorrespondence(data.config, values, data.questions) : event;
  if (!data.config.invitationManageLinkEnabled) return { ...event, ...rendered };
  if (!data.invitationManageUrl) throw new TypeError("Calendar correspondence requires an invitation manage URL.");
  return { ...event, ...rendered, description: appendInvitationManageLink(rendered.description, data.invitationManageUrl) };
}

export function templatedMail(payload: Record<string, unknown>, kind: "confirmation" | "reschedule" | "cancellation" | "reminder" | "rescheduleRequest" | "rescheduleRequestReminder", data: BookingCorrespondence, manageUrl: string) {
  const template = payload.mailTemplate as { reason?: unknown } | undefined;
  const values = { ...data.values, "manage link": manageUrl, message: typeof template?.reason === "string" ? template.reason : typeof payload.changeReason === "string" ? payload.changeReason : "" };
  const message = renderMailCorrespondence(data.config, kind, values, { questions: data.questions });
  const calendarUrl = inviteeCalendarUrl(manageUrl);
  const text = `${message.text}${message.text.includes(manageUrl) ? "" : `\n\nManage this booking: ${manageUrl}`}\nAdd to calendar: ${calendarUrl}`;
  return { ...payload, ...message, text, manageUrl, html: renderBrandedMail({ businessName: data.values["host name"], heading: message.subject, paragraphs: [message.text], actions: [{ label: "Manage booking", href: manageUrl }, { label: "Add to calendar", href: calendarUrl }] }) };
}
