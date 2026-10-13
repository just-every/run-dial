import { FeatureList, type Feature } from "./FeatureList";

const essentials: Feature[] = [
  { icon: "calendar", title: "Google Calendar and Meet", text: "Busy times block availability, and each booking lands on your calendar, with a Meet link when you choose Meet." },
  { icon: "file", title: "Calendar files", text: "Every confirmation offers an .ics file, so invitees on any calendar can add the booking." },
  { icon: "mail", title: "Honest email", text: "Confirmations and changes say what actually happened. If the meeting link isn’t ready yet, the email says so, and one more email brings it." },
  { icon: "bell", title: "24-hour and 1-hour reminders", text: "Invitees and your team hear from Dial a day before and an hour before." },
];

/** The pieces around a booking that come built in. */
export function Essentials() {
  return <section className="column" id="essentials" aria-labelledby="essentials-title">
    <h2 id="essentials-title" className="stacked"><span>Everything</span> <span>a booking needs.</span></h2>
    <p className="column-lede">The calendar event, the meeting link, the emails and the reminders come with every booking, so there is nothing to piece together.</p>
    <FeatureList items={essentials} />
  </section>;
}
