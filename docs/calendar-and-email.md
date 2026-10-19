# Calendar and email

SendGrid delivers sign-in links and booking emails on a deployed Dial. Google Calendar is optional for fixed-link, phone and in-person events. Choosing **Publish event type** enables automatic bookings using saved weekly availability and existing Dial bookings; without a connected calendar, Dial does not check external calendar conflicts. Connect Google Calendar in **Settings** to check busy time and put bookings on your calendar. Google Meet requires a healthy connected calendar that supports Meet.

> [!NOTE]
> Nothing about Google has been proven against a real account yet: connecting, Google Meet links, creating, changing and deleting events, change notifications, and how long a connection lasts. Automated tests use synthetic providers. Try a test calendar first.

## Connect Google Calendar

Dial uses your own Google Cloud project. **Settings** has a guide, "Set up Google Calendar for this installation", that shows your exact redirect address. In short:

1. In your Google Cloud project, enable the Google Calendar API.
2. Under Google Auth platform, fill in **Branding**. Under **Audience**, choose **External**, keep the status **Testing** and add the Google account that owns your calendar as a test user.
3. Under **Data Access**, add the calendar scope the guide shows.
4. Under **Clients**, create a **Web application** client with the **Authorized redirect URI** the guide shows. It is your Dial address followed by `/api/calendar/oauth/callback`.
5. In your own checkout, add `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `CALENDAR_WEBHOOK_SECRET` to the `secrets` array in `deploy.json`, each with matching `binding` and `environment` names. Put the Google client ID and secret, plus a separate random webhook secret of at least 32 characters, in a private, owner-readable `0600` environment file outside the repository. Set each binding in a separate run of `pnpm exec rer deploy --environment production --set-secret NAME --env-file /absolute/private/google-calendar.env`, replacing `NAME` with that binding and using your install's environment name. Run from the checkout that deployed Dial, with your usual Cloudflare deployment credentials available. Keep these declarations in your committed source; `rer` records each new Worker version and later deploys retain the stored secrets.
6. In **Settings**, choose **Connect Google Calendar** and sign in as the test user.

Then pick one writable **Destination calendar** for bookings and tick between one and ten **Conflict calendars** whose busy time should block you. Dial will not save without at least one. Choose **Save calendar selection**, then **Check connection**.

There is one connection for the whole Dial, and reconnecting replaces it. **Disconnect** stops Google syncing and external conflict checks. Published fixed-location events can still accept automatic bookings using saved weekly availability and existing Dial bookings. Google Meet events offer no times without a working calendar connection. To stop new bookings, choose **Disable event type** for the affected events.

Disconnect does not cancel existing bookings, delete their Google events or mark pending calendar delivery as successful. Existing calendar-managed bookings retain their calendar delivery status, and rescheduling them requires a working calendar connection.

> [!WARNING]
> Google documents that refresh tokens for an external app in Testing status expire after seven days. If that applies to you, reconnect weekly until you complete Google's production verification.

### What Dial reads and keeps

From your conflict calendars Dial keeps only identifiers, start and end times, whether a time counts as busy, and whether it was deleted. It never stores the titles, descriptions, guests or locations of your other events. The permission you grant is Google's calendar scope, because Dial also creates, updates and cancels the events it manages.

### What lands on your calendar

With a connected calendar, shortly after a booking the destination calendar gets one event with the title, exact start and end, your location or a new Meet link, and the client as a guest, so Google's own invitations reach them too. If you delete the event in Google, Dial cancels the booking and sends cancellation emails. If you change its time or location, Dial records both times and leaves the booking where it was, and you restore the event or cancel the booking. Bookings made without a calendar connection create no Google event and show **No connected calendar** for calendar delivery.

### When the provider fails

A connected calendar that is unhealthy or missing its destination or conflict selection blocks publication and offers no bookable times, including for fixed-location events. Dial tells clients booking is temporarily unavailable rather than skipping the external checks. If Dial cannot read a selected calendar, operators get one email naming the cause, and one on recovery. **Settings** shows **Needs attention**. This differs from having no connection or explicitly choosing **Disconnect**, when fixed-location events use saved availability and existing Dial bookings.

If creating the event fails after someone has booked, the booking stays confirmed. Dial retries up to five times over an hour. If every try fails, the client sees that calendar setup is incomplete, and you get an error code and a **Retry delivery** action.

## Emails Dial sends

Mail goes out from your verified sender address; Dial never reads replies sent to it. Confirmation pages and client emails offer **Add to calendar**, an `.ics` file. A reschedule updates the same calendar entry, and a cancellation marks it canceled.

- **Confirmation.** The client and every operator get the time, answers and calendar status. The client's copy has their manage link. When a connected calendar receives the booking, Google separately sends the client its own invitation. If the meeting link is not ready, the email says so, and the client gets one more when it is.
- **Changes.** A reschedule or cancellation emails the client and every operator once.
- **Reminders.** The client and every operator get one 24 hours and one 1 hour before the start. A reminder whose time has already passed is never scheduled. Rescheduling replaces them and canceling removes them. These offsets are fixed for now.
- **Requests.** Clients get an acknowledgment, then one more email when you handle or close it. Operators are told of each new request.

To stop booking mail for yourself, tick **Mute booking mail for me** under **Your booking mail** in **Settings**. Client emails are never muted, and sign-in links, requests and connection alerts still reach you. A failed send is retried up to five times over an hour, then marked failed, and you can send it again without a duplicate.

## Send mail with SendGrid

Set this up before deploying a hosted Dial. After deploy claims the owner, the first sign-in requires an emailed link to `OWNER_EMAIL`; use a mailbox you can read. Placeholder credentials cannot deliver that link, and successful deployment does not prove delivery. If mail fails, use `rer signin` with the deploying checkout and Cloudflare credentials as described in [Install Dial](install.md).

1. Choose the sender address, such as `hello@example.com`. Any address works if SendGrid has verified it or its domain.
2. In SendGrid, verify that exact address as a Single Sender, or authenticate its exact domain.
3. Create an API key with Mail Send (`mail.send`) permission and read access to verified senders and authenticated domains.
4. Give the sender as `MAIL_FROM` and the API key as `SENDGRID_API_KEY` to your first deploy, as in [Reference: deploy inputs](install.md#reference-deploy-inputs). Deploy stores them as Worker secrets.
5. After you deploy, choose **Check sender** under **Transactional mail** in **Settings**. It reads your SendGrid account and sends no test email. A successful actual check is required before publishing or opening requests.

The first deploy stops before it creates anything if the API key or sender is missing. Later deploys keep the stored values and do not replace them when you change the variables. Before the first sender check, Settings says **Not yet checked**; a missing-configuration result is only reported after a check finds missing required inputs.

### Optional delivery and bounce tracking

Sender verification and mail sending work without `MAIL_WEBHOOK_KEY`, and events can be published after the required checks pass. Settings shows that delivery and bounce tracking is off. Dial still rejects unsigned callbacks; disabling tracking never accepts unverified events.

To turn tracking on:

1. In SendGrid, enable the Event Webhook with your deployed Dial address followed by `/api/webhooks/sendgrid`. Enable Signature Verification and copy its public verification key.
2. In your own checkout, add this entry to the `secrets` array in `deploy.json` (keep the existing entries):

   ```json
   { "binding": "MAIL_WEBHOOK_KEY", "environment": "MAIL_WEBHOOK_KEY" }
   ```

3. Put `MAIL_WEBHOOK_KEY=your-public-verification-key` in a private, owner-readable `0600` environment file outside the repository. With your usual Cloudflare deployment credentials available, run from the checkout that deployed Dial:

   ```sh
   pnpm exec rer deploy --environment production --set-secret MAIL_WEBHOOK_KEY --env-file /absolute/private/mail-tracking.env
   ```

4. Reload Dial Settings. Tracking shows as on; callbacks must still have a valid signature. Repeated provider events remain idempotent.

This opt-in declaration is needed because the current `rer` deployment tool only provisions declared secrets; it has no optional-secret field. For a first deploy with tracking already enabled, add the declaration first and supply the key alongside your other deploy inputs. Without this opt-in, no webhook key is required. Subsequent deploys retain stored Worker secrets.

Use `rer` for the secret change: it records the Worker's new version in the deployment receipt. Editing the secret directly in the provider dashboard would leave that receipt stale and can block later deployments. To turn tracking off, keep the declaration and run `pnpm exec rer deploy --environment production --unset-secret MAIL_WEBHOOK_KEY`; rer records the removal so later deploys do not require the retired secret. Set it again with the command above to resume tracking.

## Local mail

On your own computer Dial sends no email: outgoing messages are checked and then suppressed, and nothing keeps them. A deployed install sends through its configured provider.
