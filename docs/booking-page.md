# Your booking page

Your booking page is what clients see: your profile, your event types, and a three-step flow for picking a time. Your profile lives at `/book/your-handle` and each event type at `/book/your-handle/your-slug`. The address `/` on your install is Dial's front page, with a link to your booking profile once you have set one up.

## Your host profile

Open **Profile** in the operator app. Dial has one host and one profile. Fill in:

- **Name**, **Title** and **Biography**.
- **Public handle.** This is the address of your booking page: lowercase letters, digits and hyphens, up to 80 characters. If you change it, the old address stops working.
- **Host timezone.** Use a full timezone name, such as Australia/Brisbane. Every availability window uses this timezone.
- **Focus areas.** Up to six labels.
- **Social proof.** Up to three quotes with attributions, typed by you. Dial never collects reviews.

**Avatar.** In Profile, choose an image within the size and file-type limits to add or replace your picture. Choose **Remove avatar** there to clear it. The current picture appears on your public profile and event pages.

## Event types

Open **Event types** and choose **New event type**. Each has an **Event name**, a **Description**, a **Duration** from 5 to 480 minutes and a **Slug** for its address, which you find under **More options**. A slug follows the handle rules. If you change it, the old link and any embeds stop working, but the manage links of existing bookings keep working.

**Location.** Pick **Google Meet**, **Fixed link**, **Host phone number** or **In-person address**. Clients see only the label until they book, then the link, number or address appears in the receipt, email and any connected calendar event. Google Meet requires a connected Google Calendar; the other locations can work without one.

**Questions.** Name and email are always asked. Add your own, up to 25, as text, textarea, single choice, multiple choice or checkbox, each required or optional. New event types start with an optional Agenda question.

**Scheduling rules.** Also under **More options**:

| Setting | Range | New event type |
|---|---|--:|
| Start increment | 5, 10, 15, 30 or 60 minutes | 15 minutes |
| Minimum notice | 0 minutes to 7 days, entered in minutes | 240 minutes |
| Booking horizon | 1 to 365 days | 60 days |
| Before and after buffers | 0 to 120 minutes each | none |
| Host-day cap | optional bookings per day | no cap |

A buffer keeps free time around a booking without changing the times clients see. A host day is one date in your host timezone.

**Visibility.** Tick **List this event on the public profile**, or leave it off for an unlisted event reached only by its link. Disabling or deleting an event type removes its public page but keeps existing bookings.

**Publishing.** The **Event type readiness** panel names anything missing: an open availability window, a saved location and a passing mail check. If a calendar is connected, it must pass its checks; Google Meet also requires a destination calendar that supports Meet. Fixed-link, phone and in-person events can be published without a calendar. **Publish event type** turns on real bookings from your saved weekly availability and existing Dial bookings. Without a connected calendar, Dial does not check external calendar conflicts. Keep commitments outside Dial out of your weekly windows or close those times with date overrides before publishing.

**Private annotations.** Operators can define fields for event types, bookings and availability requests in Settings, then edit values on each record. The available kinds are text, long text, single choice and checkbox. These annotations are private to operators and are not shown to clients or included in email. Use **Questions** above when you want to collect answers from clients.

## Availability

Availability belongs to each event type. Open **Availability**, choose an event type, and add **Weekly windows** in your host timezone. An end of 00:00 means midnight at the end of that date. **Add date override** replaces the weekly windows for one date, closing the day or opening different hours. Changes never move a confirmed booking.

A time is offered only if it fits your saved schedule, respects your scheduling rules, and clashes with no existing Dial booking. When a calendar is connected, Dial also checks its busy times; if that check fails, no times are offered.

**Timezones and daylight saving.** Clients see times in their own timezone, which starts as their browser's and which they can change. Each time shows its UTC offset. A time skipped when clocks jump forward is never offered, a time repeated when clocks go back is shown twice with different offsets, and a booking keeps its exact moment through any clock change.

**Suggested times.** Each day lists up to five first, each with its reason. Times inside 09:00 to 17:00 for both of you come first, then those with the most free time around them. The rest appear under **Other times**.

## What your client sees

1. **Choose a day and time.**
2. **Details.** The client sees **Confirm this time** with your questions and who receives their answers, then chooses **Confirm booking**.
3. **Confirmed.** A receipt shows the time in both timezones, the location, **Add to calendar** and **Manage booking**.

Dial rechecks your saved schedule and existing Dial bookings at confirmation, plus live busy times when a calendar is connected. If the time was taken, the client chooses again; if a connected calendar cannot be checked, confirmation stops.

**Manage booking** opens a private link, with no account. Until the start time the client can reschedule on the same picker or cancel with an optional reason. The link works for 90 days after the start.

## Alternative requests

Switch alternative requests on with **Enable alternative requests** on the event type's page; the same button turns them off. With them on, clients see **None of these work?** under the times. They pick up to ten future dates and twenty time windows, add their details and an optional note, review, and send. A request never holds a time or makes a booking, and the client gets an acknowledgement email.

Open **Requests** to see them as Submitted, Handled or Closed. **Create agreed booking** turns one into a booking, and **Mark handled** or **Close request** emails the client once.

**Open requests** lets you start before your calendar is ready. On an unpublished event type it shows only the request form, with no times. It needs a saved profile, alternative requests turned on and a passing mail check.

## Embed it on your site

In **Settings**, under **Origin-gated embeds**, add the exact address of your site, such as one starting with `https://`. Wildcards and paths are refused. Choose a published event type, then **Copy inline tag** or **Copy modal tag**, and paste it where you want the flow. Modal adds a button that opens it in a window.

Next, set up mail and optional calendar integration in [Calendar and email](calendar-and-email.md).
