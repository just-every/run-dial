import { bookingTimeFacts, timeFactsText, renderBrandedMail, inviteeCalendarUrl } from "../delivery/mail";
import type { BookingMailDetails, BrandedMailInput, BrandedMailFact } from "../delivery/mail";
import { spanishConfirmation as text } from "./catalog";

/** Render the Spanish built-in without changing operator-entered values. */
export function spanishConfirmationMail(input: BookingMailDetails & {
  manageUrl: string;
  renderedLocation: string;
  joinUrl?: string;
  paymentFacts: BrandedMailFact[];
  paymentText: string;
  answers: Array<{ label: string; value: string }>;
}) {
  const times = bookingTimeFacts(input, "", "es");
  const location = `${input.locationLabel}: ${input.renderedLocation}`;
  const joinUrl = input.joinUrl;
  const layout: BrandedMailInput = {
    language: "es", businessName: input.hostName, heading: input.eventTitle, intro: text.confirmed,
    facts: [
      { label: text.event, value: input.eventTitle }, ...times,
      { label: text.duration, value: `${input.durationMinutes} ${text.minutes}` }, ...input.paymentFacts,
      { label: text.location, value: location }, ...input.answers,
    ],
    actions: [...(joinUrl ? [{ label: text.join, href: joinUrl }] : []), { label: text.manage, href: input.manageUrl }, { label: text.calendar, href: inviteeCalendarUrl(input.manageUrl) }, ...(input.payment?.balanceUrl ? [{ label: "Pay the balance", href: input.payment.balanceUrl }] : [])],
  };
  const answers = input.answers.length ? `\n\n${text.answers}:\n${input.answers.map(({ label, value }) => `${label}: ${value}`).join("\n")}` : "";
  const body = `${text.confirmed}\n${input.eventTitle} con ${input.hostName}\n${text.event}: ${input.eventTitle}\n${timeFactsText(times)}\n${text.duration}: ${input.durationMinutes} ${text.minutes}${input.paymentText}\n${text.location}: ${location}${answers}${joinUrl ? `\n\n${text.join}: ${joinUrl}` : ""}\n\n${text.manageText}: ${input.manageUrl}\n${text.calendar}: ${inviteeCalendarUrl(input.manageUrl)}\n\n${text.sentBy}`;
  return { text: body, html: renderBrandedMail(layout), confirmationLayout: layout };
}
