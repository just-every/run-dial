import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";

export function PublicPrivacyPage() {
  return <PublicTheme><PublicHeader /><main className="mx-auto w-[calc(100%-40px)] max-w-3xl min-h-[calc(100vh-80px)] py-9"><section className="grid gap-5 rounded-[24px] bg-card p-5 leading-[1.6] [&>p]:text-muted shadow-[var(--shadow)] sm:p-10"><p className="pb-eyebrow">Privacy notice</p><h1 className="text-[clamp(32px,5vw,47px)] leading-none">Your booking information</h1>
    <p>Dial keeps the details you submit to arrange your meeting. Your host and their connected calendar and email services receive the details needed for your booking.</p>
    <p>Booking links can suggest your name, email and answers. You can change them before confirming; they do not verify your identity. Campaign and link source information is saved with your booking and shown to the host.</p>
    <p>When the host configures them, booking pages and routing forms use Google Analytics 4, Google Tag Manager, Meta Pixel, Google Ads or LinkedIn Insight Tag to measure page views, routing-form submissions, time selection and confirmed bookings. These providers may use cookies. Embedded bookings and routing forms report events to the parent website instead. Connected Google Ads and LinkedIn accounts receive the click ID from your booking or routing-form link, a conversion reference and its time when you book, never your answers. The host controls these connections and their providers’ data policies.</p>
    <p>A host’s thank-you page may receive contact details, answers and source information they chose to share. Dial never adds private answers, payment details or private booking links.</p>
    <p>Bookings and requests stay until the host erases them. Unsubmitted booking choices and request reviews expire after 30 minutes; submitted records stay. The host can erase personal information kept by Dial, with cleanup at connected services tracked separately.</p>
    <p>A booking or request may be saved before its email arrives. Contact the host about your information or a missing confirmation.</p>
  </section></main><PublicFooter /></PublicTheme>;
}
