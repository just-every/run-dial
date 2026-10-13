# Calendar and email

Dial needs two outside services. Google Calendar tells it when you are busy and holds your bookings. SendGrid delivers sign-in links and booking emails. You connect both in **Settings**.

> [!NOTE]
> Nothing about Google has been proven against a real account yet: connecting, Google Meet links, creating, changing and deleting events, change notifications, and how long a connection lasts. Automated tests use synthetic providers. Try a test calendar first.

## Connect Google Calendar

Dial uses your own Google Cloud project. **Settings** has a guide, "Set up Google Calendar for this installation", that shows your exact redirect address. In short:

1. In your Google Cloud project, enable the Google Calendar API.
2. Under Google Auth platform, fill in **Branding**. Under **Audience**, choose **External**, keep the status **Testing** and add the Google account that owns your calendar as a test user.
3. Under **Data Access**, add the calendar scope the guide shows.
4. Under **Clients**, create a **Web application** client with the **Authorized redirect URI** the guide shows. It is your Dial address followed by `/api/calendar/oauth/callback`.
5. In the Cloudflare dashboard, add encrypted secrets to your Worker named `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, plus `CALENDAR_WEBHOOK_SECRET` with a random value of at least 32 characters. Save and deploy those bindings.
6. In **Settings**, choose **Connect Google Calendar** and sign in as the test user.

> [!WARNING]
> Saving secrets in the dashboard deploys a new version of your Worker that `pnpm run deploy` did not make. The next `pnpm run deploy` then stops with `owned-resource-replaced` rather than overwrite a version it cannot account for, and the deploy declaration in `deploy.json` does not yet include these three Google settings. Plan how you will take updates before you add them, and see [Updating](updating.md).

Then pick one writable **Destination calendar** for bookings and tick between one and ten **Conflict calendars** whose busy time should block you. Dial will not save without at least one. Choose **Save calendar selection**, then **Check connection**.

There is one connection for the whole Dial, and reconnecting replaces it. **Disconnect** stops syncing: pages stay up but offer no times, and existing bookings are unchanged.

> [!WARNING]
> Google documents that refresh tokens for an external app in Testing status expire after seven days. If that applies to you, reconnect weekly until you complete Google's production verification.

### What Dial reads and keeps

From your conflict calendars Dial keeps only identifiers, start and end times, whether a time counts as busy, and whether it was deleted. It never stores the titles, descriptions, guests or locations of your other events. The permission you grant is Google's calendar scope, because Dial also creates, updates and cancels the events it manages.

### What lands on your calendar

Shortly after a booking, the destination calendar gets one event with the title, exact start and end, your location or a new Meet link, and the client as a guest, so Google's own invitations reach them too. If you delete the event in Google, Dial cancels the booking and sends cancellation emails. If you change its time or location, Dial records both times and leaves the booking where it was, and you restore the event or cancel the booking.

### When the provider fails

If Dial cannot read a selected calendar, it offers no times and tells clients booking is temporarily unavailable. Operators get one email naming the cause, and one on recovery. **Settings** shows **Needs attention**.

If creating the event fails after someone has booked, the booking stays confirmed. Dial retries up to five times over an hour. If every try fails, the client sees that calendar setup is incomplete, and you get an error code and a **Retry delivery** action.

## Emails Dial sends

Mail goes out from a no-reply address. Confirmation pages and client emails offer **Add to calendar**, an `.ics` file. A reschedule updates the same calendar entry, and a cancellation marks it cancelled.

- **Confirmation.** The client and every operator get the time, answers and calendar status. The client's copy has their manage link, and Google separately sends the client its own invitation. If the meeting link is not ready, the email says so, and the client gets one more when it is.
- **Changes.** A reschedule or cancellation emails the client and every operator once.
- **Reminders.** The client and every operator get one 24 hours and one 1 hour before the start. A reminder whose time has already passed is never scheduled. Rescheduling replaces them and cancelling removes them. These offsets are fixed for now.
- **Requests.** Clients get an acknowledgement, then one more email when you handle or close it. Operators are told of each new request.

To stop booking mail for yourself, tick **Mute booking mail for me** under **Your booking mail** in **Settings**. Client emails are never muted, and sign-in links, requests and connection alerts still reach you. A failed send is retried up to five times over an hour, then marked failed, and you can send it again without a duplicate.

## Send mail with SendGrid

1. Choose a sender starting with `noreply@` or `no-reply@`. Dial refuses to send from anything else.
2. In SendGrid, verify that exact address as a Single Sender, or authenticate its exact domain.
3. Create an API key with Mail Send (`mail.send`) permission and read access to verified senders and authenticated domains.
4. In SendGrid, enable the Event Webhook with your Dial address followed by `/api/webhooks/sendgrid`, so bounces reach Dial. Your address is known before you deploy; see [Deploy to Cloudflare](install.md#deploy-to-cloudflare). Turn on its signed requests option (Signature Verification) to reveal the public verification key.
5. Give all three to your first deploy: the sender as `MAIL_FROM`, the API key as `SENDGRID_API_KEY` and the verification key as `MAIL_WEBHOOK_KEY`, as in [Reference: deploy inputs](install.md#reference-deploy-inputs). Deploy stores them as Worker secrets.
6. After you deploy, choose **Check sender** under **Transactional mail** in **Settings**. It reads your SendGrid account and sends no test email.

The first deploy stops before it creates anything if any of the three is missing. Later deploys keep the stored values and do not replace them when you change the variables. Without the verification key the sender check fails, and no event type can be published or opened for requests.

## The local outbox

On your own computer Dial sends no email. Messages go to a local outbox at `/__dev/outbox`, which keeps up to 100 messages from the last seven days. It never runs on a deployed install.
