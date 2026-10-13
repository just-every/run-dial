# Install

Dial runs as one Cloudflare Worker with a D1 database, an R2 bucket, queues, a Durable Object and a schedule that runs every minute. This page takes you from the source to a signed-in Dial, first on your computer and then on your own Cloudflare account.

## What you need

- **The source.** Clone it with git, or use your own copy of it:

  ```bash
  git clone \
    https://github.com/just-every/run-dial
  ```

- **Node 22.20.0 and pnpm 10.12.4.** Select these versions yourself before you run anything. Dial checks them and never changes your global tools.
- **A Cloudflare account on the Workers Paid plan,** with a workers.dev subdomain and an API token for that account. [Deploy to Cloudflare](#deploy-to-cloudflare) lists the permissions.
- **A SendGrid account** with an API key and a verified `noreply@` or `no-reply@` sender. See [Calendar and email](calendar-and-email.md#send-mail-with-sendgrid).
- **A Google Cloud project** is optional, for Google Calendar integration and Google Meet. See [Calendar and email](calendar-and-email.md#connect-google-calendar).

You need none of the accounts to try Dial on your computer. A deployed Dial lives on a `workers.dev` address; deploy accepts no custom domain. For cost and limits, see [the overview](overview.md#cost-and-limits).

> [!NOTE]
> Run Dial's commands with `pnpm run`, as written on this page. Plain `pnpm setup`, `pnpm deploy` and `pnpm import` are different built-in pnpm commands.

## Run it on your computer

1. In the Dial source folder, install the exact locked dependencies. This is the same as `pnpm install --frozen-lockfile`.

   ```bash
   pnpm run deps
   ```

2. Set yourself up as the first owner, using your own address. Setup builds Dial, applies the migrations, writes private settings to `.dev.vars`, makes you the first owner, puts a sign-in message in the local outbox and then stops.

   ```bash
   pnpm run setup -- \
     --owner-email you@example.com
   ```

3. Start Dial. When it is ready it prints a `RER_READY` line with its address, `http://127.0.0.1:8787` unless you chose another port, and a `RER_SIGN_IN` line with the address of the local outbox.

   ```bash
   pnpm run dev
   ```

4. Open the outbox, choose the newest message, then choose **Open this link** and **Confirm**. No email is sent. Your first sign-in opens the setup workspace; see [Finish setup](#finish-setup).

Each sign-in link works once. While Dial is running, this prints the outbox address again:

```bash
pnpm run outbox
```

And this puts a fresh sign-in message there:

```bash
pnpm run outbox -- \
  --owner-email you@example.com
```

`pnpm run dev` reloads the app as you edit the source. Stop it with Ctrl-C or with the command below, and it also stops by itself after 30 minutes with no activity.

```bash
pnpm run dev -- --stop
```

`pnpm run preview` serves the production build of the same install instead. Run one of the two at a time, and stop dev with `pnpm run dev -- --stop` before `pnpm run build`: the build refuses while dev owns the local state.

`pnpm run doctor` confirms that your Node and pnpm versions match the pinned ones. It reads the process environment, not `.dev.vars`, so on a working local install it still lists `ENVIRONMENT`, `APP_URL` and `SESSION_SECRET` as missing and exits 3; those names matter when you deploy.

Running setup again keeps your owner, your data and your private settings exactly as they are, and applies any new migrations. It refuses a different owner email or address rather than replace them, and there is no option to force it. On the first run, `--port 8788` picks another port and `--owner-name` sets your display name.

To start over, export anything you want to keep (see [Backups and export](backups.md)), then reset:

```bash
pnpm run reset -- --yes
```

Reset prints exactly what it removes: your local data, the owner, the generated settings and setup's own records. It keeps the source, the dependencies, your archives in `exports/` and your deploy records in `.rer/deploy`. The next setup makes a fresh, empty Dial whose owner starts setup again.

Local setup does not connect Google Calendar. Fixed-link, phone and in-person event types can offer bookable times using saved availability, existing Dial bookings and the local outbox. Google Meet requires a connected Google Calendar. To explore calendar integration, run the review demo, which uses a synthetic calendar and mail at `http://127.0.0.1:15702`. Sign in as `operator@dial.test` through its local outbox. Never use it for real bookings.

```bash
pnpm run review
```

> [!WARNING]
> Local mode is for one person on one machine. The local outbox shows sign-in links in plain view, so any process or user on your computer that can reach it can sign in as the owner. Keep `.dev.vars`, `.wrangler`, `.seed` and `exports/` private, and out of git.

## Deploy to Cloudflare

One command, `pnpm run deploy`, builds your committed source, creates what Dial needs in your own Cloudflare account, applies the migrations in order, uploads the Worker and checks its health. Prepare these first:

1. **A workers.dev subdomain.** In the Cloudflare dashboard, open Workers & Pages and choose your account's workers.dev subdomain. Without one, deploy stops with `workers-subdomain-missing` before it creates anything.
2. **An API token.** Create an account API token for that one account with these account permissions: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit and Queues Edit. If one is missing, deploy names it, for example `token-scope-missing-d1`.
3. **Your Dial address.** It is your Worker's name, `dial-production`, on your workers.dev subdomain: `https://dial-production.<your-subdomain>.workers.dev`. You need it for SendGrid's webhook before you deploy, and for Google afterwards.
4. **Your mail settings and secrets.** Follow [Send mail with SendGrid](calendar-and-email.md#send-mail-with-sendgrid) for the sender, the API key and the webhook key, and choose a random session secret and setup token of at least 32 characters each.
5. **Committed source.** Commit your changes. Deploy refuses to run with uncommitted changes to tracked files and stops with `owner-source-not-committed`.

Then deploy:

1. Check the deploy on your computer first. This builds Dial and checks the deploy declaration in `deploy.json`. Nothing is deployed and nothing is sent to Cloudflare.

   ```bash
   pnpm run deploy -- --dry-run
   ```

2. Set the environment variables listed in [Reference: deploy inputs](#reference-deploy-inputs), then deploy. This creates the Worker `dial-production`, the D1 database `dial-production-db`, the R2 bucket `dial-production-files`, the queues `dial-production-jobs` and `dial-production-jobs-dead`, the booking Durable Object and the one-minute schedule, then checks health.

   ```bash
   pnpm run deploy
   ```

Deploy records what it created in `.rer/deploy/production.json`, a private file in your checkout. Keep it, and keep a copy somewhere private outside the checkout after each deploy: it is the only proof of which resources are yours. Without it, a later deploy refuses with `resource-name-collision` rather than take over resources it cannot prove it made. Deploy from the same checkout each time, one run at a time.

The default environment is `production`. To deploy a separate install with its own resources and address, name another environment. This one is named `dial-staging`:

```bash
pnpm run deploy -- \
  --environment staging
```

Then open `/signin` on your new address, choose **Set up the first operator**, and enter your name and your setup token once. The operator email is the owner email you deployed with. Dial then opens the setup workspace: work through [Finish setup](#finish-setup), and [Calendar and email](calendar-and-email.md) for the connections.

[OPERATIONS.md](../OPERATIONS.md) also describes an older reviewed-plan deployment that maintainers use for isolated test accounts. You do not need it to run your own Dial.

## Finish setup

Until you finish setup, signing in opens the setup workspace at `/setup`, and any `/app` page sends you back there. Its heading is "Set up your scheduling workspace", and it shows "Set up your booking link" with seven steps, each linking to its fix:

1. **Host profile.** See [Your booking page](booking-page.md#your-host-profile).
2. **Mail check.** Run **Check sender** in Settings. It reads your SendGrid account; see [Calendar and email](calendar-and-email.md#send-mail-with-sendgrid).
3. **Google Calendar connection.** Connect and check it in Settings if you want calendar integration or Google Meet.
4. **An availability window.** Add weekly hours to an event type.
5. **An event type.** Create your first one.
6. **Publish or Open requests.** Publish it with saved availability, or take requests only.
7. **Copy the booking link.** Copy the event's public booking link.

You need not finish every step. **Finish setup** asks for a saved host profile and a copied link to an event that is published, or open for requests. **Open requests** needs a working mail sender, but no Google Calendar or availability windows. Publishing for bookable times needs saved availability and verified mail, including the local outbox in local mode. A calendar is optional for fixed locations; connected calendars must pass their checks, and Google Meet requires a connected calendar that supports Meet. Finishing checks the current readiness again, then opens the operator app at `/app`.

Setup stays finished. Later connection problems show in Settings and on Overview, where the same steps appear under "Booking configuration", and they never send you back to setup. The Mail step and, when connected, the Google step count only a check that passed in the last 24 hours, so they return to "To do" until you run the check again; without a Google connection, that step shows "Optional" and counts as done.

## Reference: deploy inputs

Each input is an environment variable that `pnpm run deploy` reads.

Every deploy needs:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: the API token from step 2 above.

The first deploy also needs the values it stores as Worker secrets. It stops before creating anything if one is missing. Later deploys keep the stored values by name, and changing a variable does not replace a stored secret.

- `OWNER_EMAIL`: the first operator's email.
- `SESSION_SECRET`: random, at least 32 characters. Keep it; a restore needs it.
- `SETUP_TOKEN`: random, at least 32 characters, used once to set up the first operator.
- `SENDGRID_API_KEY`: your SendGrid API key, stored as `MAIL_API_KEY`.
- `MAIL_FROM`: your verified `noreply@` or `no-reply@` sender.
- `MAIL_WEBHOOK_KEY`: the public verification key of SendGrid's signed Event Webhook.
