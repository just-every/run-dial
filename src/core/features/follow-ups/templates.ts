import { invalidTemplateVariables, renderCorrespondenceTemplate, type CorrespondenceValues } from "../../shared/correspondence";
import { formatTimeRange, renderBrandedMail } from "../delivery/mail";
import type { FollowUpCandidate } from "./types";
export function followUpTemplateIssue(text: string, questionKeys: string[]) {
  const invalid = invalidTemplateVariables(text, questionKeys);
  if (/\{manage link\}/u.test(text)) invalid.push("manage link");
  if (/\{message\}/u.test(text)) invalid.push("message");
  if (invalid.length) return `Unknown follow-up variable: ${[...new Set(invalid)].join(", ")}`;
  if (privateLink(text)) return "Follow-ups cannot include a private manage link.";
}
export function composeFollowUp(run: FollowUpCandidate, appUrl: string) {
  const values: CorrespondenceValues = { "invitee full name": run.inviteeName, "invitee first name": run.inviteeName.trim().split(/\s+/u)[0], "host name": run.hostName, "event name": run.eventTitle,
    "date and time": formatTimeRange(run.startsAt, run.endsAt, run.timeZone, true), duration: `${(Date.parse(run.endsAt) - Date.parse(run.startsAt)) / 60000} minutes`, location: run.location, "manage link": "", message: "", answers: run.answers };
  const text = renderCorrespondenceTemplate(run.text, values);
  if (privateLink(text)) throw new Error("private_link_not_allowed");
  const subject = run.kind === "thank_you" ? `Thank you: ${run.eventTitle}` : run.kind === "rebooking" ? `Book another meeting: ${run.eventTitle}` : `Your feedback: ${run.eventTitle}`;
  const link = run.kind === "rebooking" ? new URL(`/book/${encodeURIComponent(run.hostHandle)}/${encodeURIComponent(run.targetSlug!)}`, appUrl).toString() : undefined;
  return { subject, text: text + (link ? `\n\nBook another meeting: ${link}` : ""), html: renderBrandedMail({ businessName: run.hostName, heading: subject, paragraphs: [text], ...(link ? { actions: [{ label: "Book another meeting", href: link }] } : {}) }) };
}
function privateLink(value: string) { return /\/(?:api\/public\/)?manage\//iu.test(value); }
