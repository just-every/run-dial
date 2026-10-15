# Operations

## Command path

Run commands from the checkout root. The first-party entry point is
rer; its command and flag contract is
[SEED-COMMAND-CONTRACT.md](SEED-COMMAND-CONTRACT.md). Public package aliases
delegate to the same CLI. With pnpm, forward flags as
pnpm run VERB -- FLAGS; use pnpm run deploy -- --dry-run for Dial's deploy
command, because pnpm deploy is a pnpm command.

The contract and [RUN-LOCALLY.md](RUN-LOCALLY.md) retain Base's generic examples.
Archives live under the checkout's unserved `exports/` (for example
`exports/dial.rer`) or at an absolute path outside the checkout; the CLI refuses
any other location, including public, source and build folders. See the
[Dial export and restore commands below](#local-export-and-restore).

OPERATIONS.json version 2 declares the first-party profile, runtime pins,
commands, inputs, effects, environment sources, and required worker and
sign-in-mail loops. The CLI owns command validation, state locks, cleanup,
readiness, confirmation, local data transfer, and exit mapping. Dial's adapter
owns its setup answers, build and verify targets, provider bindings, deployment
declaration, and archive policy.

These inspection commands have separate scopes:

- rer check --profile first-party validates the declared
  command and operations contract without credentials or app acceptance.
- node scripts/operations.mjs check and describe forward to the corresponding
  RER commands. Check validates source declarations; a passing check does not
  establish that configuration or providers are ready.
- rer doctor inspects the process environment through Dial's
  configuration validator and required loops, the private local settings,
  canonical state location, and installed Node/pnpm versions. It reports
  aggregate local readiness, missing input names and their declared sources;
  it does not expose input values or contact providers. A failure with no
  missing names can mean invalid supplied configuration or an unmet local
  prerequisite. Review the configuration and tool requirements below.
- rer describe reports the commands, aliases, flags, pins,
  effects, and local state this checkout actually supports.

None of them proves deployment health or live provider access.

## Local installation and sign-in

Use Node 22.20.0 and pnpm 10.12.4. Install frozen dependencies with
rer install; pnpm install --frozen-lockfile is the
equivalent package-manager operation.

Setup takes the actual first owner's email through an interactive prompt or
--owner-email EMAIL. A private --answers FILE can provide declared installer
answers for automation; --non-interactive never guesses an owner. Secrets are
generated or read through the installer and private settings, never accepted as
CLI values.

rer setup --owner-email you@example.com
rer dev

Setup builds the app, applies local migrations, records the first owner and exits
without leaving an app running. It preserves the saved owner, domain data, and
private settings on rerun. Conflicting owner or origin answers are refused;
setup does not rotate secrets or replace an owner. Native setup and dev sign-in
requests prove possession of the private SESSION_SECRET, so local restarts do
not consume the owner's sign-in rate limit. Ordinary sign-in attempts remain
rate-limited, and remote authentication ignores that local CLI proof.

Dev starts the real app with source edits and Vite HMR, and runs Dial's Cron
schedule locally on its minute as the generic capability in
[SEED-COMMAND-CONTRACT.md](SEED-COMMAND-CONTRACT.md) describes, printing one
`RER_SCHEDULED` line per run. Each run is the deployed scheduled pass: calendar
and mail connection checks with their alerts, calendar sync, push-channel
renewal, due reminders, and mail or calendar retries. Dial's Worker configuration
is `deploy/wrangler.template.toml` (rendered to `wrangler.toml`), while the
maintained CLI reads Cron Triggers only from root `wrangler.jsonc`, so that file
declares the same `triggers.crons`; `scripts/render-wrangler.mjs` refuses to
render, and with it build, setup and verify, when the two differ. Reminders and
retries need bookings, and bookings need a checked destination calendar, so a
local install without Google has nothing to remind; `node
scripts/verify-lifecycle-journey.mjs` drives the whole lifecycle on this schedule
against synthetic provider HTTP. Preview runs no schedule and serves the fixed
production Worker and assets after setup. Both are managed foreground servers
on loopback and share the same owner and canonical data. Readiness output appears
only after application health succeeds. Open the
printed RER_SIGN_IN URL, choose the newest ordinary sign-in message, and
follow its link. No email is sent.

Local dev and demos silently suppress mail. Open the printed RER_OPEN link
for one-click owner sign-in. The nav/title identify Dial Dev or Dial Demo,
without an injected bar or captured-mail inbox.

The default local state is .wrangler/state; CLI bookkeeping is .rer/local;
installer drafts and captures are in .seed/installer. Private settings are in
.dev.vars with mode 0600, and containing private directories use mode 0700.
Setup records the selected loopback origin there. The installer uses the declared
rer-setup.json fields; it does not introduce a second setup schema.

Dev and preview remain in the foreground. Stop one with
rer dev --stop or
rer preview --stop, or with Ctrl-C. The stop command is
idempotent if no server exists. The default idle timeout is 1800 seconds;
--idle-timeout SECONDS overrides it. A compatible repeated start reuses a
healthy registered server. Conflicting modes, hosts, ports, or timeouts refuse
instead of moving the server to a different address. The machine-wide managed
server cap is two.

Dev and preview bind only to 127.0.0.1, localhost, or ::1. An explicit
occupied port fails; it never silently chooses another port. Stop the active
mode before switching modes, building, verifying, resetting, or transferring
data. Preview does not use Vite HMR or rebuild automatically.

## First-run workspace setup

For a fresh owner, ordinary sign-in first opens authenticated `/setup`; after
completion, sign-in returns the owner to `/app`. Save the real host profile,
check the configured mail sender, then publish an eligible event or use Open
requests. This option needs a working mail sender and enabled alternative
requests, but no Google Calendar connection or availability windows; it offers
requests rather than bookable times. Copy the canonical booking link and select
**Finish setup**. Completion rechecks the current profile, link-copy record,
event state, and applicable live connections, then sends the owner to `/app`.
Until completion, authenticated `/app`
documents redirect to `/setup`; once complete, `/setup` redirects to `/app`.

Setup completion is durable. Later connection-health changes, profile or event
edits/deletion, and operator removal or reinvitation do not reopen the first-run
flow. On upgrade, an existing owner keeps the prior `created_at` as compatibility
metadata; it does not attest that the former checklist was completed. Archive
restore preserves the completion marker, while a confirmed local reset followed
by fresh setup starts the new owner with setup pending.

## Product and provider readiness

Dial stores authoritative records in D1 and uploaded assets in R2. Queues carry
delivery work, a Durable Object coordinates booking mutations, and Cron runs
scheduled work. Preserve applied migration files byte for byte; add forward
migrations for schema changes and verify recovery against existing data.

The local setup explicitly selects the guarded development-mail provider. It
does not fall back to local mail when hosted credentials are missing or a
provider request fails. The current deployment declaration selects SendGrid.
It maps the owner-supplied SENDGRID_API_KEY to the private MAIL_API_KEY
binding and requires a verified MAIL_FROM sender. The SendGrid
MAIL_WEBHOOK_KEY is an optional webhook verification key. Without it, delivery
and bounce tracking is off and callbacks return 401 without changes; sender
readiness still checks the API key and verified sender before publication.
Opt in to its declaration in deploy.json, then use rer deploy --set-secret
MAIL_WEBHOOK_KEY to add it while retaining deployment receipt custody. See
docs/calendar-and-email.md for the private input file and exact command.
Later deploys retain existing Worker secrets. An absent health row is unchecked,
not evidence of missing configuration. The MAIL_FROM sender must be a verified noreply@ or no-reply@ address.
The read-only SendGrid connection check accepts an exact verified Single Sender
or an exact authenticated domain marked valid. Matching ignores case but does
not extend to parent domains or subdomains; the check sends no test message.

The runtime also accepts an explicit Resend provider configuration. When
MAIL_PROVIDER is absent, the declared compatibility path selects Resend and
requires its legacy RESEND_API_KEY, RESEND_FROM_EMAIL, and
RESEND_WEBHOOK_SECRET inputs. Local setup sets MAIL_PROVIDER=development
and a loopback APP_URL; this mode must never be used for production.

Google Calendar OAuth and any Google Meet provisioning need real owner-controlled
provider configuration and successful connection checks. Calendar reads fail
closed: when a required calendar is unavailable, Dial offers no bookable slot.
A local fixture or structural command check does not prove Google access,
OAuth longevity, live invitations, or conference creation.

Dial watches the calendar connection so that a failure alerts every operator
within 60 seconds of its onset (NOTIFY-007). The one-minute scheduled pass runs
the full check: a destination calendar lookup and a free/busy read over the
conflict calendars, 2,880 Calendar API calls a day. From the moment a
connection reads healthy (connect, reconnect or re-authorise), a Durable Object
alarm probes it 30 seconds after each healthy check with the same two reads, so
at about the half minute: another 2,880 calls a day. That is about 5,760
connection-check calls a day per connection, plus an access-token refresh
about once an hour. The probe makes no call while the connection is unhealthy
and stops once it is disconnected. A failure that a request, the pass or a
probe sees on a healthy connection starts an incident: the full check runs
again 10 and 20 seconds later, and only a failure that every one of those
checks still sees is alerted, once per incident. A check that reads healthy
ends the incident, so a brief error sends nothing and a later failure starts
its own incident.

## Verification

Run the product's complete local check with
rer verify after stopping dev and preview. It executes the
declared Dial verification target, including its contract, type, build,
schema, migration, product, and browser checks. The browser suite includes a
fresh local clone of the public CLI journey at 1440 and 390 pixels. Generated
evidence is stored outside the checkout by default, and verification checks
that tracked inputs were not changed. A green local run describes only the
checkout and provider fixtures it exercised; it is not remote health, email
delivery, production installation, or complete accessibility and capacity
acceptance. Record remaining evidence separately in [HANDOVER.md](HANDOVER.md).

rer build creates the production Worker and assets. Private
settings are excluded from build output and restored after the build. Use
rer preview to serve that fixed output locally; stop it
before building or changing modes.

## Reset and recovery

Reset is destructive local cleanup. Stop dev, preview, and other local
operations, then review the exact inventory with:

    rer reset --yes

Reset removes only .wrangler/state, .rer/local, .seed/installer, and the
declared generated private settings such as .dev.vars and
.dev.vars.previous. It preserves source, lockfiles, rer-setup.json,
dependencies, exports/ archives, and .rer/deploy/ receipts. It refuses
active operations, unsafe or linked paths, interrupted settings recovery, and
ambiguous state. --non-interactive also requires --yes.

If the legacy .wrangler/local-build or .wrangler/local-setup directory
contains anything, RER refuses setup/build/reset. Stop the old process and
recover the original settings and data to safe custody; only an empty legacy
directory may be removed. Do not delete a broad .wrangler, .rer, or data
directory to reset.

Reset is local-only. It does not remove Cloudflare resources, revoke external
provider credentials, or replace a deployed installation. Export data first
if it must survive a reset.

## Export and local restore

Stop dev and preview before transfer. Export writes a new owner-only JSON-lines
archive under exports/; the destination file must not already exist:

    rer export --target local --output exports/dial.rer

The complete policy covers supported Dial records in D1 and original R2 bytes
and metadata. It preserves durable owner identity, cancellation guards,
application records, timestamps, and uploaded content. Unknown application
tables or changed schema structures fail closed. The destination keeps its own
migration ledger.

The archive excludes credentials and live authority: OAuth tokens, sessions,
sign-in and invitation links, setup/webhook secrets, booking and request
capabilities, the development mail outbox, callback authority, and ephemeral
admission state. Pending or historical provider commands cannot replay after
restore. The source SESSION_SECRET remains private; the archive contains only
a non-secret continuity digest needed to protect retry and erasure guards.

Restore requires an empty local destination and explicit --yes. The importer
applies the declared migrations, validates the archive and schema, and refuses
populated application data, capability state, or R2 objects. Before import,
securely restore the original private settings, including the same
SESSION_SECRET; do not run setup first. Then import and run setup with the
original owner email to reissue a fresh local sign-in link. After restore,
reconnect Google Calendar and run the mail connection check.

    rer import --target local --input exports/dial.rer --yes
    rer setup --owner-email you@example.com

Archives are format version 2, which binds the manifest and every part. Import
refuses a version 1 archive (written before Dial adopted Base `59a75ea`) as
`legacy_archive_unverifiable`: update the original installation in place, which
keeps its data, and export it again. An archive made before that update under
the old `.exports/` folder stays where it was and stays git-ignored, because the
version 1 archive still holds every operator and invitee record; move it out of
the checkout or delete it once the new export is safe.

Export again and compare the semantic contentHash to check round-trip
equivalence. D1 and R2 cannot commit together: if an import fails or is
interrupted, leave the destination unpublished, preserve the archive, and
recover there only after inspection or use another clean destination.
Hosted export uses the same schema proof, exhaustive exclusions, canonicalization,
asset scans and salt continuity through the published Base authenticated HTTP
handler/client. From a stopped local checkout of the exact deployed revision:

    rer export --target remote --origin https://dial.example --session-file .rer/local/hosted-owner.cookie --output exports/hosted.rer

The mode-0600 session file holds one native owner cookie, never a URL or provider
credential. The runtime exposes `/api/portability/exports` and the read-only
`GET /api/portability/status` control plane; remote imports
remain refused. Base enforces Origin and per-owner job ownership. Expired,
revoked, review and development sessions cannot export. No Cloudflare account
API is called by this command.

Hosted source admission covers Worker fetch, server functions, Queue, Cron,
BookingCoordinator fetch and alarms, including waitUntil work. The lease is
acquired only when all durable writer receipts have drained; it spans schema and
secret discovery, D1 snapshot and every R2 read. New application work receives
503, queue deliveries retry, and alarm checks are deferred. A five-minute lease
is renewed by snapshot creation, advancement and download. Status and abort do
not renew it and remain available to the job's native owner after expiry, even
if snapshot preflight no longer passes. Expiry reopens the application but makes
the old export permanently unusable, so a delayed request cannot publish a mixed
snapshot. The client aborts its source job after success or failure. If cleanup
fails, retain the private `.transfer.json` and use the published client to abort:

    node node_modules/@runeditrun/rer/modules/portability/cli.mjs abort --origin https://dial.example --session-file /absolute/private/native-cookie --resume JOB_ID

Do not operate D1/R2 directly or run deployments/migrations during capture; these
owner-account actions bypass application admission. Export creation refuses with
HTTP 503 and `X-Dial-Archive-Error: archive_writer_admissions_present` when writer
admissions remain, or `archive_maintenance` when another export holds maintenance.
The latter also refuses an export whose lease expired. Both responses are
no-store and retain Retry-After. The transfer client reports these typed causes.

Settings → Export status reads the number of writer admissions and whether an
unexpired export currently holds maintenance. Refresh is explicit; failures are
visible. This is an observation, not a reservation or a promise that a later
export can acquire. The endpoint requires a native owner session, the configured
origin/Host and same-site access. Its authentication and status query are reads;
it bypasses application admission and does not clean expired leases or create
jobs. It remains available during maintenance; loading a new Settings document
still uses ordinary admission and may receive 503 until maintenance ends.

A terminated application worker can leave a writer receipt, but Dial cannot
establish that any particular writer has terminated. Its liveness is unknown;
legacy receipts contain neither creation time nor revocable storage authority.
Such receipts block export, not normal use. There is no Clear action or supported
source-only recovery procedure. Preserve them. Support must first obtain an
independently verified revocation or drain covering all old invocations AND
already-issued D1/R2 effects. Disabling ingress, pausing Queue/Cron/DO activity,
redeploying, waiting, and an owner checkbox do not establish that guarantee.
Only after that prerequisite is proved can a separately reviewed recovery reclaim
appropriate admissions. No provider cutover or storage revocation is performed
by Dial's status view, and deleting receipts without it risks a mixed snapshot.

D1/R2 archive equivalence covers durable product state. Queue messages and
coordinator retry/watch alarms are intentionally excluded execution state;
restored provider commands remain inert and fresh connection checks recreate
watch scheduling. The source erasure journal continues invalidating snapshots;
a pending erasure refuses export and restore. Local hosted-stand-in proof does
not claim live Cloudflare deployment or provider recovery.

Legacy dial-export.v2 archives are not read by the current transfer path.
Restore one with its original revision into an isolated installation, then
export it in the current format. Never restore an archive over existing owner
data.

## Owner-account deployment and release

The current deploy.json declares D1, R2, the JOBS and dead-letter
queues, the SQLite BookingCoordinator Durable Object, Cron, production
variables, and secret bindings. Cloudflare Workers Paid is required. The
owner-account CLI builds and validates locally, provisions declared resources,
then checks authenticated health.

Native `rer deploy` claims the hosted owner after a healthy deploy and removes
the one-time setup token. The owner then opens `/signin` and requests an email
link. There is no browser first-operator step after that claim. Working SendGrid
mail, a verified sender and an OWNER_EMAIL mailbox the owner can read are needed
before deploying. Dial pins rer 0.2.20. For owner access without mail, run
`rer signin --environment NAME` from the deploying checkout with its receipt and
Cloudflare credentials (`production` is the default). Open the private, one-use
link and confirm within 15 minutes; never copy it into logs or messages.

New Workers inherit the local setup owner if OWNER_EMAIL is omitted and get
fresh generated SESSION_SECRET and SETUP_TOKEN values if not supplied. Set the
real hosted owner address explicitly when local development used a generated
owner. Inputs come from the environment or an owner-readable 0600 KEY=VALUE
file passed with --env-file. Later deploys retain stored secrets; use the
explicit --set-secret or --unset-secret operation for changes. The complete
input and sign-in instructions are in [Install](docs/install.md#reference-deploy-inputs).

A dry run makes no provider requests:

    rer deploy --dry-run

A real deployment requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN,
the declared production settings, and provider secrets. The owner-account
command form is:

    rer deploy --environment production

A deployment receipt identifies resources and migrations; it is not by itself
proof of healthy product use. Provider connection checks, a real first-owner
sign-in, booking acceptance, and remote health require separate evidence. No
live deployment or provider acceptance is claimed by this guide.

To remove a hosted installation, export any needed data first and use the
checkout holding its deployment receipt, with Cloudflare credentials available:

    rer deploy --remove --yes --environment production

This permanently deletes only the Worker, D1, R2, KV and queues proven owned by
that environment's receipt, then reads back that each is gone. Keep the receipt
until removal completes. Local reset does not delete hosted resources.

rer release --repo PATH --output PATH uses Base's release
producer and writes its local receipt. It does not push, publish, tag, or
deploy. Review the actual artifact and receipt before any separately authorized
publication.

## Managed first owner and editor

Managed delivery uses the canonical root `rer-setup.json` and source policy in
`scripts/delivery/base/packaging.json`. Before supplying live account or provider
credentials, run `node scripts/projects/integrations.mjs check` and, with the
chosen local runtime inputs, `rer doctor`. The former is a
credential-free source check; doctor additionally requires the pinned local
tools, saved private owner settings and valid process-environment configuration.
Neither command makes a provider call. Missing or invalid configuration refuses
local readiness; neither command establishes hosted acceptance.

A managed installation supplies trusted `RER_OWNER_CLAIM_ISSUER`,
`RER_OWNER_CLAIM_INSTALLATION_ID`, `RER_OWNER_CLAIM_APP_ORIGIN`, and
`RER_OWNER_CLAIM_PUBLIC_KEYS` (a JSON public ES256 key ring), plus the configured
`OWNER_EMAIL`, `APP_URL`, `SESSION_SECRET` and hidden `SETUP_TOKEN`.
`/auth/owner-claim` accepts the short signed claim in a POST body, never a URL.
Base verifies the exact issuer, origin, installation and email before any writes;
the claim, first native owner, product identity and native session commit together.
Migration `0028_owner_claim.sql` adds the permanent consumed-claim ledger. Preserve
it in exports and restoration, even if an owner is later removed. Existing applied
migrations are unchanged. With any managed claim binding present, native setup-token
bootstrap is closed, including when the managed configuration is incomplete.
Local CLI installs omit those bindings and keep their existing setup-token path.

Optional `RER_MANAGEMENT_ORIGIN` and `RER_INSTALLATION_ID` enable the Base editor in
the native `/app` shell. `/api/editor/config` requires an active native owner
session and returns only non-secret configuration, privately and without caching,
for at most 30 seconds. The app rechecks its session and configuration every
20 seconds; an expired grant, refused refresh, native session revocation or logout
removes the editor. Framing permits only self and the exact configured management
origin, and unrelated security directives are retained. Every Dial operator has
the same native owner capability, preserving the equal-operator policy.

This is source integration and local verification tooling. It does not establish
hosted management, stage/production installation or provider acceptance.

### Imported schedules in portable archives

Imported native bookings, identity markers and permanent erased-source/target guards are exported. Exact source captures, import plans, originals, provenance, before-images and staging are excluded because they can carry private links that cancel or reschedule source bookings and stale replay authority. The original installation retains resume and undo; restored native bookings keep their Imported mark and slot occupancy, without restoring import jobs or provider effects.

Base authentication migration `0031_auth_domain_rules_step_up.sql` is additive: preserve existing migration bytes and back up before applying it. Native sessions and sign-in links remain valid. Archives retain durable domain rules and exclude session-bound step-up proofs; request a new proof after restore. Recover an interrupted upgrade from the prior backup with its matching revision, without resetting a populated installation.
