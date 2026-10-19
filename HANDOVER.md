# Dial handover

## Release 0.4.2 (19 Oct 2026)

- 0.4.2 restores a native backup made by the previously listed release (bb5d650f, migrations up to 0061) into the current schema. `scripts/archive/prior-schemas.mjs` declares Base `acceptedSchemas` for every earlier migration set whose later migrations each state their row upgrade (0062: booking_links offered_slots_json/hold_until NULL; 0063: the migration's own json_set of inviteeConfirmationEnabled). The archive's schema-proof payload must equal that set's proof byte for byte. A later migration without an entry ends acceptance. `scripts/local/transfer.mjs` also passes Base's replay of the destination's applied migrations (`scripts/local/migration-replay.mjs`). `tests/archive-prior-release.test.mjs` imports the retained backup (`tests/fixtures/archive/listed-bb5d650f.rer`) through `rer import`. Pins rer 0.2.68.

## Release 0.4.1 (19 Oct 2026)

- 0.4.1 fixes native export, hosted Download backup, restore and erasure on databases installed by RER Managed, whose `rer_migrations` ledger 0.4.0 did not classify (`scripts/archive/policy.mjs`, `scripts/archive/migration-ledger.mjs`, `src/core/features/erasure/portability.ts`). `tests/export-deploy-ledger.test.mjs` round-trips a Platform-installed database built with Platform's exact ledger DDL. It also carries the per-event invitee-confirmation switch (migration 0063) and the one-hour NOTIFY-005 retry bound.

## Release 0.4.0 (19 Oct 2026)

- 0.4.0 is cut from main `7191fe8` plus the rer 0.2.65 pin. Its gate (CHANGELOG.md) ran the homepage jobs locally at 1440 and 390 px and on a disposable hosted deployment with SendGrid and real inboxes, upgraded a populated 0.3.0 install in place, and restored a hosted backup into an empty local install with the same content hash. Hosted restore is not exposed, and live Google Calendar and Meet were not exercised (CHANGELOG.md known issues).

## Latest changes (15 Oct 2026)

- Public `main` was `9b37c951b52065de5f46f3d3f7e1aa2c7c5b7127` before this round. [Verify 38653389135](https://github.com/just-every/run-dial/actions/runs/38653389135) succeeded on that exact SHA. [Run site 38653389156](https://github.com/just-every/run-dial/actions/runs/38653389156) succeeded on the same SHA; its deploy job ran `rer deploy --site`, then read back `/run` as HTTP 200 and `www` root as HTTP 301 to the canonical domain. That baseline certifies only that SHA; each later head is certified by its own exact-SHA Verify run.
- The repository is public and MIT licensed, with tag `v0.1.0` (no GitHub release object). `run-dial.com` is the live run site, deployed by the Run site workflow on every push to `main`. Live operator installation and real provider use are not established.
- First-run setup no longer depends on clipboard access: when the browser denies it, **Copy booking link** shows the link in a selectable field and **I have shared it** records the same copy report through the same authenticated route (`tests/host-setup/sharing.mjs`, all six host-setup scenarios).
- The import kit is Base `6c8374d5eb2e7eb53bad079d0502dbc4f930fd1c`, including its shared-source custody, field redaction and stepwise preparation work; additive migrations 0045 and 0046 add the kit's preparation-step and stream-source tables. Erasing a person who appears only as one invitee of another person's imported booking (a cancelled guest) now completes: their invitee values leave every retained source payload, before-image and original, the peer's native record stays byte-identical and its import keeps resume and undo, and an opaque invitee tombstone refuses a later upload that still carries them (`tests/import-custody-erasure.test.mjs`). Dial's copy of one kit file differs from Base; see [modules/PROVENANCE.md](modules/PROVENANCE.md).
- `DATA-002`'s native authentication rate-attribution blocker is closed by the maintained `rateCorrelation` hook. Known-operator counters and their correlation rows commit in the same D1 batch; migration 0039 retires pre-hook counters. The valid-link operator-removal test verifies that counter and its correlation are removed while an unrelated control survives. Preserve Dial's hook adaptations when refreshing Base copies.
- The current schema census is 118 application tables, eight static portability tables and `sqlite_sequence` (127 total), after replaying 46 core migrations. `ERASURE.md` lists each table and its erasure/archive classification.
- Verify 38653389135 on `9b37c95` includes the maintained OPER-001 `tests/local-setup-journey.test.mjs` path: README public CLI with explicit `--owner-email` at 1440/390, pre-hydration sign-in, repeat setup preserving private configuration, reset refusal/safety, and an archive round-trip restoring local state. It does not exercise a Git-configured email default or interactive prompt; no separate Git-email journey is evidenced.
- The `connection-watch` coordinator probes a healthy calendar 30 seconds after each successful health check, then confirms a new failure at 10 and 20 seconds. It alerts only if the connection remains unhealthy; brief failures send neither an alert nor a recovery message.
- Move-in review remains synthetic: no real Calendly export has been checked. Current capacity measurements are tied to their recorded local workload/source; production capacity at manifest limits stays unqualified until the release cut.
- Accessibility proof is owner-scoped (14 Oct 2026) to axe, the accessibility tree and headless keyboard checks. Verify runs them on every head through `tests/booking-axe.test.mjs` (`scripts/verify-booking-axe.mjs` and its `tests/booking-axe/keyboard-*.mjs` journeys) at desktop and mobile widths. The earlier keys13 run on `110b58c13c6ea01b59c28f7c30b4dc71d79991b3` (344 checks, zero failures) remains the recorded broad keyboard receipt for that source. Screen-reader and OS-level key input are out of scope; WCAG 2.2 AA stays the manifest's target level.
- The CLI is the published `@runeditrun/rer` package at the exact version `package.json` pins, with `pnpm-lock.yaml` frozen and no package patch. The package awaits Dial's adapter `resetPreflight`, which keeps the legacy build/setup storage guard. An exact repeat deploy with unchanged inputs performs zero provider writes and keeps the recorded deploy state and secret bytes; the owner claim is kept, not repeated.
- SendGrid's published Essentials 50k price was $19.95/month on 14 Oct 2026. At 1,000 bookings and four to six transactional emails each, the estimated 4,000–6,000 sends use 8–12% of that allowance. The $24.95 typical estimate adds Cloudflare Workers Paid at $5; runtime usage remains conditional on included allowances, and taxes, domains, overages, optional tools and paid Google Workspace are excluded. The 60-day, 100-email/day SendGrid trial is not recurring free service.

## Current implementation boundary

The public command path is supplied by the published `@runeditrun/rer`
package at the exact version `package.json` pins; `pnpm-lock.yaml` records its
frozen resolution, with no package patch. The package awaits the adapter's
`resetPreflight` before any reset inventory or removal. `scripts/installer/local.mjs`
binds Dial's setup UI, owner inputs,
deployment declaration, native provider bindings, legacy-reset guard and
archive policy. OPERATIONS.json version 2 opts into command contract 1 and
declares Dial's native setup, worker and sign-in-mail requirements. Node
22.20.0 and pnpm 10.12.4 are declared and checked. The shared package owns
command parsing, local state coordination, lifecycle and cleanup, and
portability execution; Dial's adapter supplies its product-specific behavior.

Local export and import use the pinned package's D1/R2 portability engine with
Dial's complete table classification and credential policy. Current transfer
supports local export/import and authenticated hosted export (`rer export --target remote`).
Hosted restore is not exposed; restore into an empty local installation of the
same source revision. The archive
preserves durable owner and booking facts and original uploaded object bytes;
it excludes credentials, sessions, sign-in and invitation links, booking
capabilities, OAuth credentials, webhook authority, development mail, and
ephemeral admission state. The original SESSION_SECRET stays outside the
archive and is needed to preserve retry and erasure guards after restore.

The hosted deployment adapter is `ownerDeploy` from the pinned package. Its
provider already supplies `importSql` to the published migration runner via the
D1 import API; it does not mean a remote archive-restore endpoint. The archive
policy validates installed migration names and, when recorded, exact hashes and
applied states. Destination installer history stays in place. Unknown application
schema, altered SQL hashes and interrupted migration claims refuse transfer.

The retained deployed-ledger tests use the published migration runner's
`importSql` transport and restore from its tracked `d1_migrations` ledger into a
Wrangler-style destination. The native hosted journey separately models that
tracked ledger on its disposable source, stops the source before import, and
reads the restored booking and avatar in an independent runtime. An optional
qualification input runs an independent npm package's `bin/rer.mjs` directly,
verifies its tarball against the npm manifest integrity, and compares every
executed package file with that tarball. Qualification requires an actual passing
receipt for the candidate; presence of the test alone is not proof.

## First-run setup behavior

A fresh owner's ordinary sign-in first opens authenticated `/setup`. An
unfinished owner sent to an `/app` document is redirected to `/setup`; finishing
setup returns them to `/app`. The owner saves a real profile, checks the mail
sender, publishes an eligible event or uses Open requests without Google
Calendar or availability windows, copies the canonical booking link, and
selects **Finish setup**. That action rechecks current applicable connections.
Completion remains durable: later connection-health aging, profile or event
edits/deletion, and operator removal or reinvitation do not reopen setup.
Upgraded existing owners retain their prior `created_at` as compatibility
metadata, not as proof of historical setup completion. Archives preserve the
marker; a confirmed local reset followed by fresh setup starts a new owner with
setup pending.

## Move-in evidence boundary

Saved-source import validation remains synthetic-only; no real account export
has been supplied. The manifest names Calendly, Acuity Scheduling and SavvyCal as
incumbent products; no real Calendly export has been checked.
The import guide and source download naming identify the supported saved format.
The first preview captures its as-of instant when uploaded; repeated previews,
choice changes, applying and resuming retain that instant. Reselecting files
starts a fresh review. Native Base crypto supplies a separate 256-bit CSPRNG
nonce for each source booking before review, in a signed 30-minute upload
identity bound to the operator, current native session, exact files, as-of time
and undo generation. Archive restore preserves the operator and session secret
but excludes sessions, so an old upload identity cannot cross a restored sign-in.
It grants no session or booking authority. Only derived token hashes enter the
reviewed plan; no upload identity or raw manage token enters reports or archives.
Resume uses the exact stored plan. Runtime restart with the same session keeps
a pending review valid; a new sign-in or undo requires a fresh upload review.
Missing imported private locations link to the
actual event editor in either setup or the operator workspace; ordinary
publication readiness still refuses a missing private value.

## Public site

The landing at `/` (HOME-001) and the docs at `/docs` (DOCS-001) are covered by
`tests/landing.test.mjs`, `tests/docs-site.test.mjs`, the HOME-001 runtime
checks in `tests/runtime.test.mjs` and the public-site journey of the booking
axe gate, which audits the landing without a host profile and every published
docs page at 1440 and 390 pixels and checks that a visit leaves browser storage
empty. Earlier local browser receipts passed 7/7 journeys with 68 axe scans in
72 evidence records (four picker diagnostics), then 203 checks across 83 axe
scans, 33 reflow scans at 320 pixels without horizontal overflow, 239
screenshots and 180 keyboard receipts. Those runs recorded zero serious or
critical findings and no browser errors; their settings-deletion confirmation
used Playwright dismissal and they did not exercise literal OS Escape. The
later keys13 keyboard run above is bounded to its exact source. These receipts
do not prove complete WCAG conformance or manual screen-reader behavior.
The gate waits one admission minute after the public-site journey. An earlier
run got its confirmation refused with 429 because that journey shared the
loopback client's 120-a-minute public budget with the booking journey.

`node scripts/verify-managed-editor.mjs` was not rerun on this head.

The app tsconfig lists only `@cloudflare/workers-types` and Vite's client
declarations (for the docs' virtual modules and asset imports) in `types`, not `node`, and
`pnpm typecheck` passes. Node's types still reach every file in the program:
`vite.config.ts` is included, and Vite's declarations reference Node's types.
That is how the docs build code under `src/core/features/public-site/docs/build/`
and the Worker's `nodejs_compat` imports (`node:buffer`, `node:crypto`,
`node:zlib`, `node:timers/promises`) type-check. So nothing stops browser code
from using Node globals at type-check time, and a review has to catch it.

Every Source, Edit-on-GitHub and rewritten GitHub link comes from
`package.json` `repository.url` (`https://github.com/just-every/run-dial`, the
source repository `rer-project.json` declares), and the clone command in the
install guide names the same repository. It is public and MIT licensed, with
tag `v0.1.0`. A fork
points `repository.url` at its own repository.

## Acceptance and evidence boundary

The lifecycle clause ledger in [ACCEPTANCE.md](ACCEPTANCE.md#lifecycle-clause-ledger) is the single table for local versus live-only CAL, BOOK and NOTIFY behavior. The exact-SHA public Verify and Run site receipts above are green on `9b37c95`; earlier failures on `cd10e2e`, `526fd05`, `b272` and `7157875` are historical source-specific results. The recorded run's TAP count is not a count of independent product requirements.

Source publication and the site workflow's deploy/readback are observed. They do not prove live Google Calendar/Meet or SendGrid behavior, an owner-account operator installation, hosted recovery or a live booking. The latest disconnected archive receipts qualify older heads; a fresh exact-candidate archive qualification remains open. See [ACCEPTANCE.md](ACCEPTANCE.md) for the release gate and open obligations.

## Bounded local acceptance: parts 1–4

PROFILE-003 avatar upload uses migration 0032_host_avatar.sql. The native
route is session-gated, checks size and file signature, and writes to a
generated R2 key. Profile supports upload, replacement and removal; removal
deletes that avatar object while preserving unrelated R2 objects. Only the
current avatar is served from /media/, inline with its declared content type,
nosniff, and no cookie. Local archive behavior preserves original object bytes
and content type.

OPER-003 combines lifecycle, future/past, event type, date-range and failed
external-delivery filters. Controls persist in the URL; rows sort by start
instant and the workspace reports counts and the empty state. Search is a
literal full Unicode case-insensitive substring over invitee name and email.
Migration 0033_booking_search.sql adds and maintains folded values. The
original local benchmark reopened a D1 with 100,000 bookings and 10,000
failed-delivery rows, then measured 20 filter/search cases 20 times each after
two warmups through loopback workerd HTTP. Default-page broad search measured
p50 162.2 ms and p95 230.9 ms; combined filters plus search measured p50
96.4 ms and p95 334.3 ms. Although every case p95 was below 500 ms, individual
samples reached 535.1 ms for combined filters and search, 789.1 ms for date
range, and 896.8 ms when excluding failed deliveries.

A follow-up native timing review on d7ba20d reopened that 100,000/10,000 D1 and
collected 120 interleaved HTTP samples while observing real D1 calls. Combined
filters plus search (60 samples) measured p50/p95/maximum 78.370/85.437/110.135
ms; broad search at the default 500-row limit (20 samples) measured
123.138/135.078/137.672 ms. The date-range and no-failed-delivery groups (20
samples each) had maxima of 144.915 ms and 147.966 ms. None of these follow-up
samples exceeded 500 ms. The review has not established a cause for the earlier
outliers. These local measurements establish neither a production-capacity
claim nor a per-request latency guarantee. Raw local timing records are in the
evidence folder (PERFORMANCE.md and gate-parts14-performance.json), which is
not included in a fresh clone.

Private annotations on event types, bookings and availability requests use
the sidecars in migration 0034_extension_custom_fields.sql. A typed static
registry mounts the settings contribution, private routes and three detail
slots. Four kinds are supported: text, long text, single choice and checkbox.
Values stay out of public documents and mail. The registry is source
composition; no runtime package loader is claimed. The full extension
consumption table and accepted look details below remain intact.

These are historical, source-specific measurements: the initial native run and benchmark used `11e44e12b4b4757844bd2e46200876f256cf9c26`, later product integration checks used `2eb3326`, and the bounded avatar/privacy correction at `efdc6f2655da2791ad1b674f11c9e078f8c66407` passed 11/11 focused tests, 40 HTTP boundary checks and typecheck. The latter review found no orphan R2 bytes during the reproduced D1-write outage or after healthy retry, and its emitted-module scan covered 430 browser modules. These receipts retain only their recorded scope; the exact-SHA public Verify disposition is listed above.

## Open work before the release cut

The rate-attribution implementation gap is closed on the current source baseline. `modules/operator-auth/service.mjs` supplies `rateCorrelation`; `accounts/store.mjs` batches correlation statements with authentication counters; `src/core/features/erasure/operator-graph.ts` declares the rate edges removed with an operator; migration `0039_retire_uncorrelated_rate_rows.sql` retires counters created before correlation. `tests/operator-removal-mail.test.mjs` covers a valid-link confirmation, removal of its counter and index entry, and preservation of an unrelated control. The old native run that left a valid-confirmation counter is pre-hook historical evidence, not current behavior.

Invitee-only person erasure intentionally retains the associated operator identity; self/setup/last-owner removals remain held. Reachable local SDK observability rows have bounded logical-retirement evidence, while physical SQLite page sanitization and external provider/mail logs are not established. Already delivered mail and independent provider records cannot be recalled by the installation.

Before a release cut:

1. The final report must identify the exact landed SHA and its Verify disposition. The `9b37c95` result is the pre-round public baseline and certifies no later edits.
2. Obtain a fresh disconnected setup/archive/restore/re-export receipt for the exact release candidate. Existing `b272` and `7157875` receipts qualify only those earlier heads.
3. Run the owner-scoped accessibility proof (axe, accessibility tree, headless keyboard) on the exact frozen head; Verify includes it. Screen-reader and OS-level key input are out of scope.
4. Recheck the pinned `rer` package on the exact head: frozen install, `rer check`, reset preflight with the legacy-state guard, and the exact repeat-deploy assertion (zero provider writes).
5. Keep capacity at declared limits unqualified until the release cut; retain the dates, source heads, workload sizes and actual timings of the historical local measurements above.
6. Complete owner-account deployment, live Google Calendar/OAuth/Meet, SendGrid delivery/callback, hosted recovery, and real operator booking acceptance. Keep the Git-configured email default/prompt path unqualified; the explicit `--owner-email` flow is covered only by the recorded baseline above.

## Deployment migration exception

Owner-session deployment still depends on the retained older deployment
controller, deploy-kit, and root operations. Native RER deploy health currently
requires `SETUP_TOKEN` even after authoritative bootstrap consumption. Retiring
those helpers and accepting exact owner-account deployment health remain
deferred until the owner-gated live acceptance or upstream native lifecycle support adds conditional
health. No live deployment or resolution of this boundary is claimed.

## Owner-account deployment boundary

deploy.json declares the resources and secret bindings. The live command
requires the owner's Cloudflare account credentials, configured production
settings, and connected providers. Its receipt alone does not establish
booking, mail, calendar, or product acceptance.

Back up and preserve all authored data and applied migration bytes before an
upgrade. Use the local archive path described in [OPERATIONS.md](OPERATIONS.md)
when portability is required. A D1/R2 restore has no shared transaction: keep
an unsuccessful destination unpublished, preserve the archive, and recover
only after inspection or in another empty destination.

## Managed source admission

The native signed owner-claim path and editor are optional source integrations.
Admission uses Base owner-claim and operator-auth; invalid claims write nothing,
and the permanent consumed-claim ledger refuses a second first owner. Local RER
setup uses native setup-token admission only when managed claim bindings are absent.
The owner editor uses private short-lived configuration and the exact trusted
management framing origin. Hosted management and stage/production installation
remain separate owner acceptance.

## Custom field extension consumption (Dial 7)

Internal annotations live in `src/ext/custom-fields/`; migration `0034_extension_custom_fields.sql` creates two sidecar tables with core foreign keys and cascade erasure, adding no core column. The typed source registry mounts the settings contribution, private routes and three detail slots. Definitions are immutable except deletion; deleting a definition explicitly confirms loss of its values. A changed type is a new definition, so stored values cannot silently change meaning. Limits remain estimates. CUSTOM-001 and CUSTOM-002 in `tests/custom-fields.test.mjs` exercise native Worker routes, a populated prior-schema upgrade, private booking reads, validation, session/origin denial, archive restoration and cascade erasure. This is local evidence only; public deployment and complete accessibility conformance are not claimed.

Every manifest extension ID is accounted for below. “No registry consumer” does not imply a dynamic loader exists. Existing default product policies are direct source logic; the registry currently composes only the concrete annotation need.

| Declared ID | Consumption and proof, or reason |
| --- | --- |
| `operator.route.v1` | Consumed: `src/core/app/mount.server.ts` mounts private field routes; `tests/custom-fields.test.mjs` (CUSTOM-001/002). |
| `operator.page.v1` | Declared; no registry consumer yet. The built-in product owns this surface and no authored extension needs it. |
| `operator.navigation.v1` | Declared; no registry consumer yet. The built-in product owns this surface and no authored extension needs it. |
| `operator.settings-section.v1` | Consumed: `src/core/app/extensions.tsx`, Settings mounts `CustomFieldSettings`; CUSTOM-001 route proof, browser evidence recorded separately. |
| `job.handler.v1` | Declared; no registry consumer yet. The built-in product owns this surface and no authored extension needs it. |
| `cron.handler.v1` | Declared; no registry consumer yet. The built-in product owns this surface and no authored extension needs it. |
| `queue.consumer.v1` | Declared; no registry consumer yet. The built-in product owns this surface and no authored extension needs it. |
| `operator.management.v1` | Declared; no registry consumer yet. The contract default is implemented directly in product services; authored replacement dispatch is not implemented. |
| `booking.questions.v1` | Declared; no registry consumer yet. The contract default is implemented directly in product services; authored replacement dispatch is not implemented. |
| `availability.recommendation.v1` | Declared; no registry consumer yet. The contract default is implemented directly in product services; authored replacement dispatch is not implemented. |
| `booking.reschedule.v1` | Declared; no registry consumer yet. The contract default is implemented directly in product services; authored replacement dispatch is not implemented. |
| `booking.cancellation.v1` | Declared; no registry consumer yet. The contract default is implemented directly in product services; authored replacement dispatch is not implemented. |
| `availability-request.routing.v1` | Declared; no registry consumer yet. The contract default is implemented directly in product services; authored replacement dispatch is not implemented. |
| `reminder.schedule.v1` | Declared; no registry consumer yet. The contract default is implemented directly in product services; authored replacement dispatch is not implemented. |
| `calendar.external-deletion.v1` | Declared; no registry consumer yet. The contract default is implemented directly in product services; authored replacement dispatch is not implemented. |
| `profile.updated.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `event-type.published.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `event-type.disabled.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `event-type.deleted.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `booking.confirmed.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `booking.rescheduled.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `booking.cancelled.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `availability-request.created.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `availability-request.handled.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `availability-request.closed.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `calendar.connection-health-changed.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `delivery.failed.v1` | Declared; no registry consumer yet. Persisted product facts drive native delivery; no extension subscriber is registered. |
| `operator.navigation.after.v1` | Declared; no registry consumer yet. No authored extension contributes to this surface; public slots intentionally receive no annotation values. |
| `operator.dashboard.after.v1` | Declared; no registry consumer yet. No authored extension contributes to this surface; public slots intentionally receive no annotation values. |
| `event-type.header.actions.v1` | Declared; no registry consumer yet. No authored extension contributes to this surface; public slots intentionally receive no annotation values. |
| `event-type.settings.after.v1` | Consumed: `src/core/app/extensions.tsx`, event editor mounts private value editor; CUSTOM-001 entity route proof. |
| `booking.list.row-actions.v1` | Declared; no registry consumer yet. No authored extension contributes to this surface; public slots intentionally receive no annotation values. |
| `booking.detail.sidebar.after.v1` | Consumed: `src/core/app/extensions.tsx`, booking detail mounts values beside answers; CUSTOM-001/OPER-004 route proof. |
| `booking.detail.actions.after.v1` | Declared; no registry consumer yet. No authored extension contributes to this surface; public slots intentionally receive no annotation values. |
| `availability-request.detail.after.v1` | Consumed: `src/core/app/extensions.tsx`, request detail mounts values; CUSTOM-001 entity route proof. |
| `public.profile.after.v1` | Declared; no registry consumer yet. No authored extension contributes to this surface; public slots intentionally receive no annotation values. |
| `public.event.before-booking.v1` | Declared; no registry consumer yet. No authored extension contributes to this surface; public slots intentionally receive no annotation values. |
| `public.confirmation.after.v1` | Declared; no registry consumer yet. No authored extension contributes to this surface; public slots intentionally receive no annotation values. |
| `settings.calendar.after.v1` | Declared; no registry consumer yet. No authored extension contributes to this surface; public slots intentionally receive no annotation values. |
| `calendar.provider.v2` | Consumed by source composition in `src/core/app/services.ts` and `src/core/platform/calendar/types.ts`; `tests/deletion-ordering.test.mjs`. No runtime package loader. |
| `mail.sender.v1` | Consumed by source composition in `src/core/app/services.ts` and `src/core/platform/mail/types.ts`; `tests/branded-mail.test.mjs`. No runtime package loader. |

Local lane verification: `nice -n 15 node --test --test-concurrency=1 tests/custom-fields.test.mjs tests/export-base-adoption.test.mjs tests/export-json-numbers.test.mjs tests/export-restored-behavior.test.mjs` passed 9/9 on Node 22.20.0. The native custom-field route cases use real workerd/D1 and the current native session implementation; existing profile and event public reads return 200 without the planted annotation, and a production cancellation mail delivered to the native development outbox contains none. The populated prior-schema migration preserves every preexisting application table, and the actual shared archive exports/restores/reexports the route-written annotations equivalently. This does not establish the outer `createWorker` document envelope or browser fidelity; the central Dial 7 audit owns screenshots at 1440/390 and source-bundle/public-document checks. The initial proof harness used archive fixture IDs that core routes correctly rejected; its identities now use valid ULIDs throughout. A second fixture correction uses the product-required no-reply sender for real cancellation delivery. No production rule or test expectation was relaxed.


The adjacent-main launcher integration was checked on `5cb7574799d02d898ce1feb35e5d035536220963`: 17/17 native HTTP/private-file checks, the affected AVAIL-009 journey (1/1), typecheck and lint of 21 changed source files passed. Product, schema and production Vite configuration were unchanged from the corrected implementation. This narrow receipt and the later disconnected archive receipts on `b272` and `7157875` qualify only their recorded heads.
