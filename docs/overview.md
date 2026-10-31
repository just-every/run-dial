# Overview

Dial is a self-hosted scheduler for one business or one independent host. Clients pick a time on your booking page, and Dial records the booking, emails everyone and gives the client a private link to move or cancel it. If you connect Google Calendar, Dial also creates a calendar event. It runs on your own Cloudflare account. Bookings are stored there, and Dial sends booking details to your own SendGrid account and, when connected, Google account, not to a service Dial's authors run. Think of it as a Calendly alternative that you own.

## Who it is for

Dial is for a single host: a consultant, a clinic, a studio, a small business that takes appointments. You set up one host profile and one or more event types, such as a 30-minute intro call. You can invite other people to run the workspace with you, and they all have the same access.

An event type can be free or paid. For a paid one, you connect your own Stripe account and set a price in US dollars, or a price for each length you offer; see [Stripe payments](install.md#stripe-payments-optional). Your client pays on Stripe's checkout page while Dial holds the time for 10 minutes, and the booking is confirmed only when Stripe's signed payment event reaches Dial. The receipt, the client's manage page, the emails and your booking record show the amount and Stripe's reference. You can take a deposit and have Dial email your client a link to pay the balance before the meeting, and state a cancellation policy: cancelling inside the free window refunds your client automatically, and after it a late-cancellation fee you stated is charged to a card your client agreed to save; a no-show fee works the same way after you mark the no-show. You refund in full or in part, with a reason, from the booking record. Without a cancellation policy, your client's own cancellation refunds nothing automatically. Turn on Stripe Tax to add US sales tax by your client's billing address: the tax is shown before they pay and on their receipt. Every payment sends one receipt with your business name, the amount, the tax and Stripe's reference to your client and to you, and you can invoice an unpaid booking from its record on an invoice Stripe hosts. Try a paid event type in Stripe's test mode before you take real payments.

If you need several hosts or team round-robin, Dial is not the right tool. See [what Dial does not do](#what-dial-does-not-do).

## How a booking works

Here is the whole journey, first from your client's side and then from yours.

**Your client:**

1. Opens your booking page and picks an event type.
2. Chooses a day and a time. Times show in their own timezone, and Dial suggests up to five good ones first.
3. Fills in their name, email and any questions you asked, then confirms.
4. Sees a receipt, gets a confirmation email, and can add the booking to their calendar.
5. Uses a private link to reschedule or cancel, with no account needed.

If nothing suits them, they can send you a request with other dates and times instead.

**You:**

1. Set up your profile, mail and availability, and publish an event type. Google Calendar is optional for fixed links, phone calls and in-person bookings; Google Meet requires it.
2. Share the booking link, or embed the booking flow on your own site.
3. When someone books, Dial rechecks your saved schedule and existing Dial bookings, then records the booking and emails you and your client. With a connected calendar, it also rechecks live busy times and creates a calendar event; if the calendar cannot be checked, confirmation stops.
4. Manage bookings and requests from your Dial workspace. You can reschedule, cancel, mark attendance or create a booking for someone yourself. Filter bookings by lifecycle state, future or past start, event type, date range or failed external delivery, then search invitee names and email addresses. Add private annotations to event types, bookings and requests. Open the scheduling report from Bookings to see, for a period and an event type, what was booked, moved, canceled, attended, paid for and refunded; each figure says what it counts and lists those bookings.

Read [Your booking page](booking-page.md) for every setting, and [Calendar and email](calendar-and-email.md) for what Dial sends and reads.

## What Dial does not do

Dial stays small on purpose. It does not offer:

- Multiple hosts or workspaces, or roles and permissions.
- Team round-robin or collective scheduling.
- Group events, classes, waitlists or resource capacity.
- Extra guests on a booking.
- Bookings that wait for your approval before they are confirmed.
- Packages, coupons and payment reconciliation. Paid bookings through your own Stripe account, with deposits, refunds, cancellation or no-show fees, sales tax, receipts and invoices, are included.
- Recurring booking series or scheduling polls.
- A marketplace, ratings or reviews from clients.
- Text messages, WhatsApp, phone automation, a CRM or marketing campaigns.
- Changing reminder times. Reminders always go out 24 hours and 1 hour before a booking.
- Automatic acceptance of time or location changes made by hand to a booking's calendar event. Dial records the difference and leaves the booking time as it is.
- AI ranking of times. Suggested times follow fixed rules.
- Native mobile apps. Your Dial workspace and booking pages work in a browser.

## Before you rely on it

Try a test calendar and a test event type before you take real appointments, and use Stripe's test mode before real payments. A Google connection set up as a test app needs reconnecting every week; [Calendar and email](calendar-and-email.md#connect-google-calendar) explains when.

You can export your data from a local install or, from Settings, a hosted one. Restore goes into an empty local installation; hosted restore is not offered. See [Backups and export](backups.md) for the commands and the private settings to keep.

Booking search uses literal, full Unicode case-insensitive substring matching. Operator annotations are private to the workspace and are not included in public pages or outgoing mail.

## Cost and limits

These figures are estimates for planning. For one host and 1,000 bookings a month, the estimate covers Cloudflare: the Workers Paid plan, about 5 US dollars a month. It does not price SendGrid, which sends Dial's email, so check SendGrid's plans against your mail volume. Google Calendar has no charge inside its standard quota.

- Up to 10 operators and 100 event types.
- Up to about 10,000 bookings a month and 100,000 in all.
- Per visitor address: 120 public requests a minute, 10 booking changes a minute and 5 alternative requests an hour. The app's own script, style and font files count against the same 120 a minute; only its fingerprinted scripts are cached by browsers for a year.

## Start here

1. [Install](install.md) takes you from the source to a working Dial, on your computer or on Cloudflare.
2. [Your booking page](booking-page.md) covers your profile, event types, availability and the client experience.
3. [Calendar and email](calendar-and-email.md) connects Google Calendar and SendGrid.
4. [Backups and export](backups.md) saves a private copy of local or hosted data and restores it into an empty local install.
5. [Updating](updating.md) shows how to take a new version safely.

The [changelog](../CHANGELOG.md) lists what is in each version. Dial is MIT licensed; the license is in [LICENSE](../LICENSE).
