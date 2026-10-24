# Install

Dial runs as one Cloudflare Worker with a D1 database, an R2 bucket, queues, a Durable Object and a schedule that runs every minute. This page takes you from a fresh source clone to a signed-in local Dial, then explains deployment to your own Cloudflare account.

## What you need

- **Git.** Git is required; rer brings Node and pnpm. It selects the exact
  Node and pnpm versions pinned by Dial when needed.
- **A Cloudflare account on the Workers Paid plan,** with a workers.dev subdomain and an API token for that account. [Deploy to Cloudflare](#deploy-to-cloudflare) lists the permissions.
- **Working mail before self-hosted deployment:** the SendGrid path below needs an API key, any sender address on a verified domain, and an owner mailbox you can read. Hosted sign-in requires an emailed link. See [Calendar and email](calendar-and-email.md#send-mail-with-sendgrid).
- **A Google Cloud project** is optional, for Google Calendar integration and Google Meet. See [Calendar and email](calendar-and-email.md#connect-google-calendar).

For a **Managed installation through RER**, Configure supplies mail automatically: no provider account or provider API key is needed. RER configures the sender, relay URL and private relay credential for that installation. The Cloudflare deployment instructions below are for self-hosting.

You need none of the provider accounts to try Dial on your computer. A deployed Dial lives on a `workers.dev` address; deploy accepts no custom domain. For cost and limits, see [the overview](overview.md#cost-and-limits).

## Run it on your computer

1. One line installs the latest `rer`, clones the source into `run-dial` and starts Dial. In a Dial checkout, `rer` runs the exact version Dial pins in `package.json`:

   ```bash
   curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-dial
   ```

   Git is required; rer brings Node and pnpm. Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-dial` does the same. If the installer prints a line that puts `rer` on your PATH, run that line too. To start it again later, run the same line from the same folder, or `cd run-dial && rer dev`. The default clone follows
   `main`. For the tagged **v0.5.0** release instead, clone it yourself:

   ```bash
   git clone --branch v0.5.0 https://github.com/just-every/run-dial.git run-dial
   cd run-dial
   ```

   A tag retains its own dependency pins. This guide describes current `main`,
   which pins **rer 0.2.77**.

2. From a checkout you cloned yourself, start Dial:

   ```bash
   rer dev
   ```

On a fresh checkout, `rer dev` selects Dial's pinned Node **22.20.0** and pnpm
**10.12.4**, fetching either into its own cache when needed. It installs the
locked dependencies and prepares a local development owner automatically. You
do not need to select those versions or run `rer install` or `rer setup` first.
Allow network access for the initial downloads. When ready it prints
`RER_READY`, `RER_SIGNED_IN EMAIL` and `RER_OPEN URL`. Open `RER_OPEN` on this
computer to start signed in at the local `/setup` workspace. The generated owner
is local to this checkout. The URL's fragment carries its local development key;
treat it as a credential and do not share it.

If a local workflow needs a chosen owner address, fetch a fresh checkout without
starting it (`npx -y @runeditrun/rer install just-every/run-dial`) and run explicit
setup in `run-dial` before its first `rer dev` launch:

```bash
rer setup --owner-email you@example.com
rer dev
```

Setup applies migrations, writes private settings to `.dev.vars`, prepares the
owner, requests a local sign-in message and then exits. It keeps the saved owner,
data and settings when repeated, and refuses a conflicting owner or origin. A
normal fresh-checkout `rer dev` already does this preparation with its local
development owner. Once the default owner has been created, keep using it on
later runs; choose a custom owner before the first launch.

Local Dial sends no email and keeps no outbox: outgoing messages are checked
and then suppressed. The older `rer dev --login` flag is still accepted and uses
the same automatic sign-in. Email-link sign-in is for a deployed install.

`rer dev` reloads the app as you edit the source. Stop it with Ctrl-C or with
the command below:

```bash
rer dev --stop
```

`rer preview` serves the production build of the same install instead. Run one
of the two at a time, and stop dev with `rer dev --stop` before `rer build`:
the build refuses while dev owns the local state.

`rer doctor` confirms that your Node and pnpm versions match the pinned ones. It
reads the process environment, not `.dev.vars`, so on a working local install it
still lists `ENVIRONMENT`, `APP_URL` and `SESSION_SECRET` as missing and exits 3;
those names matter when you deploy.

On a manual setup, `--port 8788` picks another port and `--owner-name` sets the
display name.

To start over, export anything you want to keep (see [Backups and export](backups.md)), then reset:

```bash
rer reset --yes
```

Reset prints exactly what it removes: your local data, the owner, the generated
settings and setup's own records. It keeps the source, the dependencies, your
archives in `exports/` and your deploy records in `.rer/deploy`. The next
`rer dev` prepares a fresh, empty Dial whose owner starts setup again.

Local setup does not connect Google Calendar. Choosing **Publish event type** turns on automatic bookings for fixed-link, phone and in-person event types using saved weekly availability, existing Dial bookings; locally, booking mail is checked and suppressed, never delivered. Without a connected calendar, external calendar conflicts are not checked. Google Meet requires a healthy connected Google Calendar that supports Meet. To explore calendar integration, run the review demo, which uses a synthetic calendar and mail at `http://127.0.0.1:15702`. Sign in as `operator@dial.test` through its local outbox. Never use it for real bookings.

```bash
pnpm run review
```

The review demo is an optional package script that needs pnpm 10.12.4 on your
`PATH`; it is not part of the normal `rer dev` path.

> [!WARNING]
> Local mode is for one person on one machine. The `RER_OPEN` link and the dev-key cookie it leaves sign in as the owner, so any process or user on your computer that can read them can sign in as the owner. Keep `.dev.vars`, `.wrangler`, `.seed` and `exports/` private, and out of git.

## Deploy to Cloudflare

**Or let Run Edit Run host it.** [Run Edit Run](https://app.runeditrun.com/?product=dial&plan=assisted) can set Dial up on your own Cloudflare account and keep it updated; sign-ups are by request for now.

To do it yourself: one command, `rer deploy`, builds your committed source, creates what Dial needs in your own Cloudflare account, applies the migrations in order, uploads the Worker and checks its health. Prepare these first:

1. **A workers.dev subdomain.** In the Cloudflare dashboard, open Workers & Pages and choose your account's workers.dev subdomain. Without one, deploy stops with `workers-subdomain-missing` before it creates anything.
2. **An API token.** Create an account API token for that one account with these account permissions: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit and Queues Edit. If one is missing, deploy names it, for example `token-scope-missing-d1`.
3. **Your Dial address.** It is your Worker's name, `dial-production`, on your workers.dev subdomain: `https://dial-production.<your-subdomain>.workers.dev`. After deployment, use it to sign in and, if you choose, connect Google or enable SendGrid delivery tracking.
4. **Working mail and a reachable owner.** Prepare a real SendGrid API key and any sender address on your verified domain in [Send mail with SendGrid](calendar-and-email.md#send-mail-with-sendgrid). Set `OWNER_EMAIL` to a mailbox you can read, even if you previously used a generated local development owner. Check the address carefully: the hosted owner signs in by email link immediately after deployment. Keep the deploying checkout and its Cloudflare credentials for `rer signin` recovery. No webhook key is required to deploy, check the sender or send mail; [delivery and bounce tracking](calendar-and-email.md#optional-delivery-and-bounce-tracking) is a separate opt-in.
5. **Committed source.** Commit your changes. Deploy refuses to run with uncommitted changes to tracked files and stops with `owner-source-not-committed`.

Configure the inputs before the dry run:

1. Create an owner-only file outside the repository, for example
   `/absolute/private/dial-deploy.env`, with mode `0600`. Replace every example
   value below with your real values. The SendGrid path uses these inputs:

   ```dotenv
   CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
   CLOUDFLARE_API_TOKEN=synthetic-cloudflare-api-token
   OWNER_EMAIL=you@your-domain.example
   MAIL_FROM=bookings@your-verified-domain.example
   SENDGRID_API_KEY=synthetic-sendgrid-api-key
   ```

   The deploy declaration sets `MAIL_PROVIDER=sendgrid` and maps
   `SENDGRID_API_KEY` to the private runtime binding `MAIL_API_KEY`.
   `MAIL_FROM` may use any local part on the verified domain; it need not start
   with `noreply` or `no-reply`. See [Reference: deploy inputs](#reference-deploy-inputs)
   for the runtime names, relay configuration and generated secrets. Keep API
   keys out of source, shell history and shared logs.

2. Check the deploy on your computer first, using that file. This builds Dial
   and checks the deploy declaration in `deploy.json`, including required input
   presence. Nothing is deployed and nothing is sent to Cloudflare. This does
   not check provider credentials, sender verification or email delivery; it
   cannot establish that hosted sign-in will work.

   ```bash
   rer deploy --dry-run --env-file /absolute/private/dial-deploy.env
   ```

3. Deploy with the same configured inputs. This creates the Worker
   `dial-production`, the D1 database `dial-production-db`, the R2 bucket
   `dial-production-files`, the queues `dial-production-jobs` and
   `dial-production-jobs-dead`, the booking Durable Object and the one-minute
   schedule, then checks health.

   ```bash
   rer deploy --env-file /absolute/private/dial-deploy.env
   ```

Deploy records what it created in `.rer/deploy/production.json`, a private file in your checkout. Keep it, and keep a copy somewhere private outside the checkout after each deploy: it is the only proof of which resources are yours. Without it, a later deploy refuses with `resource-name-collision` rather than take over resources it cannot prove it made. Deploy from the same checkout each time, one run at a time.

The default environment is `production`. To deploy a separate install with its own resources and address, name another environment. This one is named `dial-staging`:

```bash
rer deploy --environment staging --env-file /absolute/private/dial-deploy.env
```

After a healthy deploy, `rer` claims the hosted owner and removes the one-time setup token. Open `/signin` on the deployed address, enter the deployed owner email, choose **Send magic link**, then open the email and confirm its link. There is no separate first-operator setup step or hosted local outbox. On the first sign-in, Dial opens the setup workspace: work through [Finish setup](#finish-setup), and [Calendar and email](calendar-and-email.md) for the connections.

If the email does not arrive, check the owner address, SendGrid credentials, verified sender and mailbox delivery. A successful deploy or health check does not prove email delivery. A setup token cannot sign you in after the owner has been claimed.

Dial pins **rer 0.2.77**, including hosted owner sign-in without email delivery. From the same checkout that deployed the installation, with its deployment receipt and the same Cloudflare credentials, run:

```bash
rer signin
# For a separately named deployment:
rer signin --environment staging
```

The default environment is `production`. Open the printed private link and choose **Confirm**. It works once, expires after 15 minutes and signs in the active owner; it does not create a new owner. Keep it out of logs and messages. Email sign-in remains the normal path, and working transactional mail is still required for booking notifications.

[OPERATIONS.md](../OPERATIONS.md#owner-account-deployment-and-release) describes the deployment and release boundaries for maintainers.

## Finish setup

Until you finish setup, signing in opens the setup workspace at `/setup`, and any `/app` page sends you back there. Its heading is "Set up your scheduling workspace", and it shows "Set up your booking link" with seven steps, each linking to its fix:

1. **Host profile.** See [Your booking page](booking-page.md#your-host-profile).
2. **Mail check.** Run **Check sender** in Settings. It reads your SendGrid account; see [Calendar and email](calendar-and-email.md#send-mail-with-sendgrid).
3. **Google Calendar connection.** Connect and check it in Settings if you want calendar integration or Google Meet.
4. **An availability window.** Add weekly hours to an event type.
5. **An event type.** Create your first one.
6. **Publish or Open requests.** Choose **Publish event type** to enable automatic bookings with saved availability, or **Open requests** to take requests only.
7. **Copy the booking link.** Copy the event's public booking link. If your browser blocks clipboard access, Dial shows the link in a box to select and copy yourself; choose **I have shared it** to record the step.

You need not finish every step. **Finish setup** asks for a saved host profile and a copied (or shared) link to an event that is published, or open for requests. **Open requests** needs a working mail sender, but no Google Calendar or availability windows. Publishing for bookable times needs saved availability and verified mail, including the local outbox in local mode. A calendar is optional for fixed locations: publishing enables bookings using saved weekly availability and existing Dial bookings, without checking external calendar conflicts. A connected calendar that is unhealthy or missing its selection blocks publication and bookable times until fixed; Google Meet requires a healthy connected calendar that supports Meet. Finishing checks the current readiness again, then opens the operator app at `/app`.

Setup stays finished. Later connection problems show in Settings and on Overview, where the same steps appear under "Booking configuration", and they never send you back to setup. The Mail step and, when connected, the Google step count only a check that passed in the last 24 hours, so they return to "To do" until you run the check again; without a Google connection, that step shows "Optional" and counts as done.

## Reference: deploy inputs

`rer deploy` reads the process environment and, optionally, `--env-file /absolute/private/dial-deploy.env`. The file must be owned by you, readable only by you (`0600`), and contain `KEY=VALUE` entries. Keep it outside the repository. Values in the file override process environment values. See `rer deploy --help` for the pinned command's supported flags.

Every real deploy needs:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: the API token from step 2 above.

For a new Worker using the supplied SendGrid deploy declaration, supply these
before either the dry run or a real deploy:

- `OWNER_EMAIL`: the hosted owner's mailbox, which you can read. If omitted, rer uses the saved local setup owner; a generated development address is unsuitable for hosted sign-in.
- `SENDGRID_API_KEY`: a working SendGrid API key, stored as the private runtime binding `MAIL_API_KEY`.
- `MAIL_FROM`: any sender address on your verified domain.

The declaration sets the runtime binding `MAIL_PROVIDER=sendgrid`; it does not
ask you for a provider selector. Missing required inputs stop deployment before
resource creation. A dry run checks input presence, not whether those values
work: placeholder values cannot deliver your sign-in link.

The runtime mail inputs are `MAIL_PROVIDER`, `MAIL_FROM`, and private
`MAIL_API_KEY`. With `MAIL_PROVIDER=rer`, `MAIL_RELAY_URL` is also required,
`MAIL_FROM` is the assigned sender, and `MAIL_API_KEY` is the installation's
private relay credential. Managed RER Configure supplies all of these
automatically; a Managed customer does not obtain or paste a provider API key.
The self-hosted SendGrid declaration above uses the `SENDGRID_API_KEY` input
alias; setting `MAIL_API_KEY` alone does not supply that declaration's input.

`SESSION_SECRET` and `SETUP_TOKEN` are optional inputs for a new Worker: rer generates fresh values when they are omitted. If you supply them, use random values of at least 32 characters. The session secret is needed for archive continuity; keep it securely with your recovery settings. The setup token is used by rer to claim the owner and then removed from the Worker; it is not a sign-in credential to enter in the browser.

Later deploys retain stored Worker secrets by name. Changing an environment variable or env-file value does not replace an existing Worker secret. Use the explicit `rer deploy --set-secret NAME --env-file /absolute/private/dial-deploy.env` operation for an intentional secret change; it records the new Worker version. Changing `OWNER_EMAIL` is not an owner-transfer or recovery workflow.

### Stripe payments (optional, PAY-001)

Paid event types need three operator-held secrets from your own Stripe platform account. Free event types work without them.

- `STRIPE_SECRET_KEY`: the platform secret key (`sk_…`). Dial uses it to exchange the Connect OAuth code, create and expire Checkout Sessions on the host's connected account, and revoke access on disconnect.
- `STRIPE_CONNECT_CLIENT_ID`: the Connect client ID (`ca_…`) from Stripe Dashboard → Connect → Settings, with OAuth for Standard accounts turned on and the redirect URI that Dial's Settings shows (your Dial address followed by `/api/payments/stripe/oauth/callback`).
- `STRIPE_WEBHOOK_SECRET`: the signing secret (`whsec_…`) of a webhook endpoint that listens to events on connected accounts at your Dial address followed by `/api/webhooks/stripe`, with the events Settings lists.

Declare each in the `secrets` array of your `deploy.json` and set it with a separate `rer deploy --environment production --set-secret NAME --env-file /absolute/private/dial-deploy.env`. Never put them in source or in ordinary variables. Payment methods (cards, Apple Pay, Google Pay, Link) come from your Stripe Dashboard's payment method settings; ACH Direct Debit is offered only when the host turns it on in Dial's Settings. Archives do not carry these secrets; restore them with the other private settings.

`MAIL_WEBHOOK_KEY` is optional. Without it, sending and sender verification work but delivery and bounce tracking is off. To enable tracking, opt in to its deploy declaration and set the signed Event Webhook public verification key through `rer deploy --set-secret MAIL_WEBHOOK_KEY`. See [Optional delivery and bounce tracking](calendar-and-email.md#optional-delivery-and-bounce-tracking). The guide includes the declaration and exact command needed by the current deploy tool; existing Worker secrets are retained on later deploys.

## Remove a hosted installation

Export any data you want to keep first; see [Backups and export](backups.md#export-from-a-hosted-install). Keep the deployment receipt in `.rer/deploy/` and use the checkout that deployed this installation, with its Cloudflare credentials available:

```bash
rer deploy --remove --yes
```

For an installation deployed under another environment, name that same environment:

```bash
rer deploy --remove --yes --environment staging
```

Removal permanently deletes the Worker and the D1, R2, KV and queue resources that this environment's deploy record proves rer created, then reads back that each is gone. For Dial this includes the hosted database and stored files. It touches no resources outside that record. Do not delete the receipt before removal. Removal also deletes `.rer/deploy/<environment>.secrets.env`, which holds the installation's `SESSION_SECRET`; a hosted backup cannot be restored without it, so copy that file somewhere private first (see [Backups and export](backups.md#keep-your-session-secret)). `rer reset --yes` only clears local state and does not remove a hosted installation.
