<p align="center">
  <a href="https://run-dial.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.webp">
      <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.webp">
      <img src=".github/assets/banner-light.webp" width="100%" alt="Dial: Pick a time. That’s it. 100% free, open source alternative to Calendly, Acuity Scheduling and SavvyCal.">
    </picture>
  </a>
</p>

<p align="center"><a href="https://run-dial.com">run-dial.com</a> · <a href="https://justevery.com">Part of Just Every</a> · <a href="LICENSE">MIT licensed</a></p>

<p align="center">
  <a href="https://justevery.com/#vol-dial"><img src=".github/assets/media/preview.gif" width="800" alt="Dial: Priya picks a time in her own zone, confirms with her name and email and sees the booking confirmed"></a>
</p>
<p align="center"><a href="https://justevery.com/#vol-dial"><b>Watch the full demo</b></a> · 48 seconds</p>

<p align="center">
  <img src=".github/assets/media/flow.webp" width="800" alt="Priya picks three dates for her request, and the host sees her window in her zone, Europe/London, and his own, America/New_York">
</p>

<p align="center">
  <img src=".github/assets/media/screen-1.webp" width="800" alt="Maya Chen's public Dial page: her focus areas and the Product kickoff session, 30 minutes on Google Meet, with View session"><br>
  <sub>A public booking page for each host: no account needed to book or ask.</sub>
</p>

<p align="center">
  <img src=".github/assets/media/screen-2.webp" width="800" alt="Maya's Requests inbox: Priya Shah's request with each window shown in Priya's Europe/London time and Maya's America/New_York time"><br>
  <sub>The host sees every requested window in both time zones.</sub>
</p>

<p align="center">
  <img src=".github/assets/media/screen-3.webp" width="800" alt="Dial's Bookings list after a Calendly move-in: six confirmed bookings marked Imported, and Sofia Martinez's booking in host and invitee time"><br>
  <sub>Moving from Calendly brings your bookings with you.</sub>
</p>

# Dial

Dial is a self-hosted scheduler for one business or independent host. Invitees
book available time, manage a booking through its private link, or ask the host
for another window. Operators manage event types, availability, bookings,
requests, and calendar connections.

Public source: [just-every/run-dial](https://github.com/just-every/run-dial), release 0.2.0.
Licensed under the [MIT License](LICENSE).

## Run it on your computer

With Node 22 or later and Git, one line installs the latest `rer`, clones Dial and starts it (without Node, `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-dial` brings its own). Dial pins **rer 0.2.68**:

```sh
npx -y @runeditrun/rer dev just-every/run-dial
```

To start it again later, run `cd run-dial && rer dev`. The default clone follows
`main`. To start from the tagged **v0.4.2** release instead, clone it yourself and
run `rer dev` in the checkout:

```sh
git clone --branch v0.4.2 https://github.com/just-every/run-dial.git dial
cd dial && rer dev
```

A tag retains its own dependency pins; the commands and **rer 0.2.68** pin here
describe current `main`.

On a fresh checkout, `rer dev` selects Dial's pinned Node **22.20.0** and pnpm
**10.12.4**, fetching either into its own cache when needed. It installs the
locked dependencies and creates a local development owner automatically; you do
not need to select those versions or run `rer install` or `rer setup` first.
Allow network access for the first launch. After health checks it prints
`RER_READY`, `RER_SIGNED_IN EMAIL` and `RER_OPEN URL`. Open `RER_OPEN` on this
computer to start signed in at the authenticated `/setup` workspace. The
automatically created owner is local to this checkout. `RER_OPEN` carries this
checkout's local dev key in its fragment, which the page trades for a cookie:
treat the line as a credential and do not share it.

If your local workflow needs a chosen owner address, fetch the checkout without
starting it (`npx -y @runeditrun/rer install just-every/run-dial`), run explicit
setup in `run-dial` before its first dev launch, then start dev:

```sh
rer setup --owner-email you@example.com
rer dev
```

Setup builds and migrates the app, writes private settings, prepares the owner
and exits. It keeps the saved owner, domain data and private settings on repeat
runs, and refuses a conflicting owner or origin. The ordinary fresh-checkout
`rer dev` path needs no separate setup command.

To look around with sample data, run `rer demo` after setup: a throwaway Dial
signed in as the owner, with a week of bookings and simulated external sends, that is
deleted when it stops. See [DEMO.md](DEMO.md).

The nav and title read **Dial Dev** locally and **Dial Demo** in a demo.
Open the printed `RER_OPEN` link to enter as the owner. Mail is silently
suppressed in dev and demo. There is no injected bar or captured-mail inbox.

Stop dev with `rer dev --stop` (or Ctrl-C) before
`rer verify`. Stop preview with `rer preview --stop` before changing modes,
building, verifying, resetting, or moving data.

## First-run workspace setup

In `/setup`, save the real host profile, check the configured mail sender, and
publish an eligible event or choose Open requests. Open requests requires a
working mail sender but does not require Google Calendar or availability
windows. Copy the canonical booking link, then select **Finish setup**; Dial
rechecks the relevant current connections and opens `/app`. Unfinished `/app`
documents return to `/setup`, while completed owners are sent to `/app`.
Connection-health changes, profile/event edits or deletion, and operator removal
or reinvitation do not reopen completed setup. Current archives preserve its
completion marker; confirmed reset and fresh setup leave the new owner pending.
Upgraded existing owners retain their prior creation time as compatibility
metadata, not as evidence that historical setup actions occurred.

## Local runtime and data

Dev serves source edits through Vite HMR. Run `rer preview`
to serve the fixed production Worker and assets. Both are managed foreground
servers on loopback, share the same owner and durable data, and print readiness
only after application health passes. Compatible repeat starts reuse the
registered server. Use
`--idle-timeout SECONDS` to change its inactivity limit, and `--port PORT` to
choose an available loopback port.

`rer dev` runs Dial's deployed Cron schedule (every minute) on its minute and
prints one `RER_SCHEDULED TIME "* * * * *" ok MSms` line per run. Each run is the
deployed scheduled pass: connection checks and alerts, calendar sync and channel
renewal, then due reminders and mail or calendar retries. The root
`wrangler.jsonc` repeats the template's `triggers.crons` because rer reads its
schedule only from that file; rendering refuses (so build, setup and verify fail)
when the two differ. `rer preview` runs the same schedule from fixed production output. Fixed-link, phone and
in-person events can publish without a calendar; their reminders use the
configured mail sender; local dev and demos suppress those sends. The journey `node scripts/verify-lifecycle-journey.mjs`
proves reminders, retries, alerts and sync on this schedule against synthetic
provider HTTP. See [OPERATIONS.md](OPERATIONS.md).

The browser installer and Base's sign-in confirmation page wear Dial's look through one file, `public/rer-theme.css` (the landing's paper, ink and
Figtree, and the Dial mark). The Worker serves it with the font and mark it names; the installer descriptor and the operator-auth branding both
declare it, and the installer refuses a theme that breaks Base's grammar or contrast rules.

Private settings live in `.dev.vars` with mode `0600`; canonical D1 and R2 state
lives in `.wrangler/state`; private installer captures live in
`.seed/installer`. The checkout's dev key lives in `.rer/local/dev-key.env`
(mode `0600`); `rer setup` creates it and `rer reset --yes` removes it. Dev sign-in and persona endpoints answer only a local runtime holding the key
and a request that presents it; a tunnel or proxy without the key gets 404.
Dev sessions and personas never reach a deployment or an export: `rer build`
refuses output that bundles the dev layer and `rer deploy` refuses the key.

`rer reset --yes` removes only the inventoried local runtime
state, CLI bookkeeping, installer state, and generated private settings. Stop
all RER processes first. Reset refuses active operations and unsafe or
ambiguous state; it preserves source, dependencies, `exports/` archives, and
`.rer/deploy/` receipts. Export anything needed before resetting. A fresh setup
then starts an empty local installation. Reset does not delete deployed
Cloudflare resources.

## Export and restore

Stop dev or preview before data movement. Export to a new archive path under
`exports/`:

```sh
rer export --output exports/dial.rer
```

The owner-only JSON-lines archive includes Dial's durable database records and
the original R2 objects with their metadata. It preserves durable owner and
booking facts while excluding private credentials, sessions, sign-in and invitation
links, booking capabilities, OAuth credentials, webhook authority, development
mail, and pending admissions. The private `SESSION_SECRET` is never exported;
its non-secret continuity hash protects restored retry and erasure guards.
Export refuses to overwrite an existing archive. Hosted export is supported
through an authenticated owner session; remote restore is not exposed. See
[Backups and export](docs/backups.md#export-from-a-hosted-install) for the hosted
command and rehearse restoration into an empty local install using the same
source revision that made the archive.

Restore only to an empty destination. Keep a private copy of the original
`.dev.vars`; after a reset or on a new machine, restore those settings securely
with the same `SESSION_SECRET` before importing. Do not run setup first, because
that creates an owner and makes the destination nonempty:

```sh
rer import --input exports/dial.rer --yes
rer setup --owner-email you@example.com
```

Import applies the local migrations, validates the complete archive and schema,
then restores through Base portability. D1 and R2 have no shared transaction;
if a restore fails or is interrupted, leave that destination unpublished and
recover there or use another clean destination. After restore, sign in with a
fresh link, reconnect Google Calendar, and recheck mail. Export again and
compare the `contentHash` to confirm round-trip equivalence.

For old `dial-export.v2` archives, use the original revision to restore into an
isolated installation, then export with the current command. Existing migration
files are preserved byte for byte.

## Deploy and release

For a self-hosted deployment, configure the Cloudflare account and mail inputs
**before** running the dry run. Set `OWNER_EMAIL` to a mailbox you can read.
Dial's runtime mail inputs are `MAIL_PROVIDER`, `MAIL_FROM`, and the private
`MAIL_API_KEY`; `MAIL_PROVIDER=rer` also requires `MAIL_RELAY_URL`. For the
SendGrid deploy path, the declaration sets `MAIL_PROVIDER=sendgrid`; supply a
working SendGrid key as `SENDGRID_API_KEY` (bound privately as `MAIL_API_KEY`),
and any sender address on your verified domain as `MAIL_FROM`
(for example, `bookings@your-domain.example`). See
[Install: deploy inputs](docs/install.md#reference-deploy-inputs) for the exact
private env-file example and generated secrets.

Then run `rer deploy --dry-run --env-file /absolute/private/dial-deploy.env`.
It builds and validates locally without provider requests; it still requires
the declared inputs. It does not verify credentials, sender verification,
email delivery, Google Calendar access, or remote health. A real deployment is a
separate owner-account operation:
`rer deploy --environment production --env-file /absolute/private/dial-deploy.env`.
After a healthy deploy, rer claims the hosted owner and removes the one-time
setup token. Open `/signin` on the deployed address and request an email link;
no separate first-operator setup step is needed. If mail is unavailable, run
`rer signin` from the checkout that deployed it, with the same Cloudflare
credentials, for a one-time owner link valid for 15 minutes. Use
`--environment NAME` for a named environment (the default is `production`).
Keep the link private and confirm it once.

For a **Managed installation through RER**, Configure supplies mail
automatically. You do not need a provider account or a provider API key; RER
provides the sender, relay URL and private relay credential for that installation.
Local checks and a dry run do not establish production acceptance.

To permanently remove a hosted installation, export any needed data first, then
run `rer deploy --remove --yes` from the checkout holding its deployment receipt.
Add `--environment NAME` if you deployed with a nondefault environment. See
[Remove a hosted installation](docs/install.md#remove-a-hosted-installation) for
what is deleted.

`rer release --repo PATH --output PATH` creates the declared
local release artifact and receipt. It does not push, publish, or deploy. No
tag, public publication, or production deployment is claimed here.

## Product and development references

The product requirements are in [CONTRACT.md](CONTRACT.md), shared security and
privacy requirements in [BASELINE.md](BASELINE.md), and local, restore, and
deployment procedures in [OPERATIONS.md](OPERATIONS.md). The supported command
flags and effects are in [SEED-COMMAND-CONTRACT.md](SEED-COMMAND-CONTRACT.md).
That contract and [RUN-LOCALLY.md](RUN-LOCALLY.md) are unchanged Base guides.
Archives live under the checkout's unserved `exports/` or at an absolute path
outside the checkout; the CLI refuses any other location (see the
[Dial commands above](#export-and-restore)).
[HANDOVER.md](HANDOVER.md) records what remains unverified. The synthetic
`pnpm run review` runtime is isolated from the real local owner and provider
configuration.

The full `verify` target runs lint, boundary and contract checks,
typechecking, the test suite, migration validation, a production build, and
Base copy verification. The browser suite includes a fresh local clone of the
public CLI journey at 1440 and 390 pixel widths, with setup, pre-hydration
sign-in, reset, export/import, and preview. Generated evidence goes outside the
checkout by default, and the run checks that tracked inputs were not changed.
Synthetic providers are confined to tests and the separate review runtime;
these checks do not prove live provider access or deployment acceptance.

Useful read-only commands are `rer describe`, `doctor`, and
`check --profile first-party`. Describe reports the current checkout's actual
commands, flags, aliases, pins, and effects. Check validates the declared
contract; doctor inspects local tools and configuration. Neither proves app
acceptance, remote deployment, or live provider health.

Use the `rer` verbs directly for supported Dial commands. For package scripts,
use `pnpm run SCRIPT -- FLAGS`; `pnpm deploy` is pnpm's built-in dependency
command.

Move an existing schedule with the [saved-data importing guide](docs/importing.md).
