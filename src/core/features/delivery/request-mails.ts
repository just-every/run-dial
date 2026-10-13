import { renderBrandedMail, type BrandedMailFact } from "./branded-layout";

export type RequestMailDetails = {
  hostName: string;
  eventTitle: string;
  inviteeName: string;
  inviteeEmail: string;
  inviteeTimezone: string;
  windows: Array<{ date: string; startMinute: number; endMinute: number }>;
  note?: string | null;
};

export function requestSubmissionMail(input: RequestMailDetails, recipientRole: "invitee" | "operator") {
  const invitee = recipientRole === "invitee";
  const windows = formatWindows(input.windows);
  const subject = invitee ? `We received your time request for ${input.eventTitle}` : `New alternative time request from ${input.inviteeName}`;
  const text = invitee
    ? `We received your request for ${input.eventTitle}. The host will follow up by email.\n\nYour timezone: ${input.inviteeTimezone}\n${windows}${input.note ? `\n\nYour note: ${input.note}` : ""}\n\nHost: ${input.hostName}`
    : `${input.inviteeName} (${input.inviteeEmail}) requested another time for ${input.eventTitle}.\n\nTimezone: ${input.inviteeTimezone}\n${windows}${input.note ? `\n\nNote: ${input.note}` : ""}\n\nHost: ${input.hostName}`;
  const facts: BrandedMailFact[] = [
    { label: invitee ? "Your timezone" : "Timezone", value: input.inviteeTimezone },
    { label: invitee ? "Your requested windows" : "Requested windows", value: windows },
  ];
  if (input.note) facts.push({ label: invitee ? "Your note" : "Note", value: input.note });
  if (!invitee) facts.unshift({ label: "Invitee", value: `${input.inviteeName} <${input.inviteeEmail}>` });
  const html = renderBrandedMail({
    businessName: input.hostName,
    heading: invitee ? `We received your request for ${input.eventTitle}` : `New alternative time request for ${input.eventTitle}`,
    intro: invitee
      ? "The host will follow up by email."
      : `${input.inviteeName} (${input.inviteeEmail}) requested another time for ${input.eventTitle}.`,
    facts,
  });
  return { subject, text, html };
}

export function requestUpdateMail(input: { hostName: string; eventTitle: string; state: "handled" | "closed" }) {
  const handled = input.state === "handled";
  const subject = handled ? `Your time request for ${input.eventTitle} is being handled` : `Update on your time request for ${input.eventTitle}`;
  const text = handled
    ? `The host is handling your request for ${input.eventTitle} and will follow up by email.\n\nHost: ${input.hostName}`
    : `The host cannot offer a time for your request for ${input.eventTitle}.\n\nHost: ${input.hostName}`;
  const html = renderBrandedMail({
    businessName: input.hostName,
    heading: handled ? "Your time request is being handled" : "Update on your time request",
    intro: text,
    facts: [{ label: "Event", value: input.eventTitle }],
  });
  return { subject, text, html };
}

function formatWindows(windows: RequestMailDetails["windows"]) {
  return windows.map((window) => `${window.date} ${minutesToTime(window.startMinute)}–${minutesToTime(window.endMinute)}`).join("\n");
}

function minutesToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
