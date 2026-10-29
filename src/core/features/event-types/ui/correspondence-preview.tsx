import { useState } from "react";
import { operatorDateTime } from "../../../shared/operator-format";
import { appendInvitationManageLink, renderCorrespondenceTemplate } from "../../../shared/correspondence";

type PreviewValues = Parameters<typeof renderCorrespondenceTemplate>[1];

export function CorrespondencePreview({ templates, keys, questionKeys, hostName, eventTitle, questions, calendar, invitationManageLinkEnabled, invalid }: {
  templates: Record<string, string>;
  keys: readonly [string, string];
  questionKeys: string[];
  hostName: string;
  eventTitle: string;
  questions: { key: string; label: string }[];
  calendar: boolean;
  invitationManageLinkEnabled: boolean;
  invalid: boolean;
}) {
  const [date] = useState(() => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 7);
    future.setUTCHours(14, 0, 0, 0);
    return future;
  });
  const dateAndTime = operatorDateTime(date.toISOString());
  const values: PreviewValues = {
    "invitee full name": "Taylor Morgan",
    "invitee first name": "Taylor",
    "host name": hostName,
    "event name": eventTitle,
    "date and time": dateAndTime,
    duration: "30 minutes",
    location: "Example meeting location",
    "manage link": "[Booking management link]",
    message: "Please use the updated booking details.",
    answers: Object.fromEntries(questions.map(question => [question.key, `Example answer to ${question.label}`])),
  };
  let preview: [string, string] | undefined;
  let error = "";
  if (!invalid) {
    try {
      preview = [renderCorrespondenceTemplate(templates[keys[0]], values, questionKeys, true), renderCorrespondenceTemplate(templates[keys[1]], values, questionKeys, false)];
      if (calendar && invitationManageLinkEnabled) preview[1] = appendInvitationManageLink(preview[1], "[Invitation manage link]");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "This template could not be previewed.";
    }
  }
  return <section aria-label="Template preview" className="min-w-0 rounded-2xl bg-row p-4 sm:p-5">
    <h3 className="font-semibold text-ink">Example booking</h3>
    <p className="mt-1 text-sm leading-6 text-soft">Taylor Morgan with {hostName} · {eventTitle}. Sample time: {dateAndTime}. Duration, location and answers below are examples.</p>
    {invalid ? <p className="mt-4 text-sm text-danger">Fix the template errors to see its preview.</p> : error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : preview ? <dl className="mt-4 grid min-w-0 gap-2 text-sm leading-6">
      <dt className="font-semibold text-ink">{calendar ? "Title" : "Subject"}</dt>
      <dd className="m-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{preview[0]}</dd>
      <dt className="mt-2 font-semibold text-ink">{calendar ? "Description" : "Body"}</dt>
      <dd className="m-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{preview[1]}</dd>
    </dl> : null}
  </section>;
}
