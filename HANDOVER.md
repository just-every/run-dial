# Dial handover

## Latest changes (12 Oct 2026)

- Move-in catch-up, source differences and the switch-over checklist extend
  `DATA-003`; release of an imported booking cancelled at the source is the one
  stated exception to `NOTIFY-004` (DIVERGENCE.md). Capture facts live in
  migration 0040's native tables; a catch-up plan keeps only an extract of the
  records it reviews. Still synthetic-only: no real Calendly export has been
  checked (see docs/importing.md).
- `DATA-002`'s authentication rate boundary is closed by Base `dd81be2`'s
  correlation hook (migrations 0037–0039). `modules/operator-auth/service.mjs`,
  `accounts/store.mjs` and `index.d.mts` are Dial adaptations outside the Base
  copy record; carry the `rateCorrelation` hook forward when refreshing them.
- `NOTIFY-007`: the `connection-watch` coordinator (Durable Object alarm,
  `src/core/app/connection-watch.ts`) probes the calendar 30 s after each
  healthy health check, from the moment a connection reads healthy, with the
  health check's own reads (destination lookup and free/busy over the conflict
  calendars). A request, the scheduled pass or a probe that sees a healthy
  connection fail starts an incident, re-checked 10 s and confirmed 20 s later;
  only the confirmation alerts, and only when the connection stayed unhealthy
  since the sighting, so a failure no request sees alerts within about 50 s of
  its onset and an error that clears within the window sends nothing.
- `rer dev` cannot connect Google Calendar locally, so the switch-over
  checklist's provider row stays open in a fresh local install; the browser
  journey proves the fully clear state with the fixture providers.

## Current implementation boundary

The checkout's public command path is the first-party RER CLI in
scripts/rer.mjs. Node 22.20.0 and pnpm 10.12.4 are declared and checked.
OPERATIONS.json version 2 opts into command contract 1 and declares the native
Dial setup, worker, and sign-in-mail requirements.

The copied CLI and onboarding sources are pinned and recorded by edition.json,
base-copies.json, sources.lock.json, and the export inventory. Dial's adapter
owns its local owner inputs, deployment declaration, native provider bindings,
legacy-state safety check, and exhaustive archive policy. The shared CLI owns
argument parsing, local state coordination, lifecycle and cleanup, and
portability execution.

Local export and import use Base's D1/R2 portability engine with Dial's
complete table classification and credential policy. Current transfer supports
local targets only. Remote transfer refuses before provider calls. The archive
preserves durable owner and booking facts and original uploaded object bytes;
it excludes credentials, sessions, sign-in and invitation links, booking
capabilities, OAuth credentials, webhook authority, development mail, and
ephemeral admission state. The original SESSION_SECRET stays outside the
archive and is needed to preserve retry and erasure guards after restore.

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
has been supplied. The product manifest declares no incumbent replacement.
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
empty. The maintained local browser audit passed 7/7 journeys and recorded 68
actual axe scans in 72 evidence records (four picker diagnostics), with zero
serious or critical findings and no browser errors. The final bounded run
passed 203 checks across 83 axe scans, with zero serious or critical findings
and no browser errors. It includes 33 reflow scans at 320 pixels without
horizontal overflow, 239 screenshots and 180 keyboard receipts. Playwright
dismissed the native settings-deletion confirmation; no literal OS Escape
keypress was exercised. These bounded
results do not prove complete WCAG conformance or manual screen-reader behavior.
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
install guide names the same repository. That is the public repository for
release 0.1.0; a fork points `repository.url` at its own repository.

## Acceptance and evidence boundary

The lifecycle clause ledger in [ACCEPTANCE.md](ACCEPTANCE.md#lifecycle-clause-ledger) is the one evidence table for CAL-001, CAL-003 to CAL-008, BOOK-001 to BOOK-003, BOOK-007, BOOK-008, NOTIFY-001 to NOTIFY-003, NOTIFY-005 and NOTIFY-007: which are proven locally by `node scripts/verify-lifecycle-journey.mjs` and named tests, and which only a live Google or SendGrid session can prove.

The tests-only archive fixture repair was checked at `526fd05477c705c5ba385917ef547919972e52ab` plus four helper changes. Root's own rerun passed the complete native archive-fence journey, populated migration upgrade and both custom-field journeys (4/4, no skips/cancellations), plus four native origin/privacy checks, typecheck, touched lint, boundaries and manifest validation. The fixture saves its actual ready loopback origin; native reset still refuses an active fixture and succeeds after disposal. Both refused old archives leave application and authority tables empty, no active import, and trusted source identity/epochs/journal unchanged. CLI errors expose only fixed categories and numeric status. No production rule or applied migration changed; no permanent test case was added or removed.

Exact-head Verify `38153546113` on `526fd05477c705c5ba385917ef547919972e52ab` failed with 592/593 passed; its target re-export failure remains unexplained because the old helper discarded output. The separate local default-port reset defect and parser correction are not claimed as that CI cause. The fourth fresh disconnected receipt on `526fd05477c705c5ba385917ef547919972e52ab` passed, including root's empty strict diff and complete cleanup. These source-specific results do not qualify the next integrated head: its actual main SHA, full CI disposition and latest fresh archive receipt are recorded in the maintainers' private verification notes (not published). Full DATA-002 and the release hold remain open at the maintained auth rate-write boundary.

Repository test coverage exercises product and local portability paths with
native storage and synthetic providers. Those tests do not prove real Google
Calendar or Meet access, OAuth token longevity, external mail delivery,
provider webhooks, a deployed installation, or hosted health.

Avatar upload, OPER-003 filters and Unicode search, and private custom-field
annotations have bounded local evidence. The original focused native run
passed 9/9 on its recorded implementation revision; a later corrected
integration passed 11/11 focused native tests, 40 avatar/privacy HTTP boundary
checks, typecheck and a 430-module client privacy scan. The maintained browser
audit passed 7/7 journeys; its bounded audit passed 203 checks across 83 axe
scans with zero serious or critical findings. The local capacity and timing
receipts are recorded below and in [ACCEPTANCE.md](ACCEPTANCE.md). These
receipts cover their named local sources and workloads, not full verification
of the current integrated candidate or production behavior.

The local D1 filter/search timings and follow-up review are recorded in
[ACCEPTANCE.md](ACCEPTANCE.md); they do not establish production capacity or a
latency promise.
The browser-free native capacity receipt covered 100 event types, 1,000 date
overrides, 20 one-week availability requests (p50 81.80 ms, p95 88.76 ms,
maximum 93.32 ms), 50 simultaneous operator claims (one winner, 49 clean 409
refusals), and cancellation release in 121.79 ms. Configurable reminder
offsets, external-calendar and conference behavior, complete WCAG conformance,
production capacity at declared limits and timing at those limits remain
unproved. The person-record and SDK custody repair gate is Done on exact source
`c86785fc5c886c63dc655c258fb20749722e6042`; full `DATA-002` remains open on the
separate native rate-attribution key. The cold-host fix
`c480758c0750e689c0238fe887812241331f0de6` was integrated by main code
head `b272d047e5f11a284ec0a8e6fa8c88cd1580d065`. Its fresh scoped gate
and root rerun are qualified on exact prior source
`7b6576a702e11201b80ad350942f8fd1388b011b`, not `b272`: published 390 px
passed 1/1 with nine axe scans, `[AUTH-001]` 1/1, three native health-lifecycle
scenarios and six anonymous/revoked-cookie 401 checks passed, and typecheck,
targeted lint and assertions were unchanged. Root's scoped rerun passed the
same health scenarios and 401 checks, targeted tests 2/2 with zero
failure/skip/cancel and nine axe scans, and typecheck. The initial concurrent-
docs `/signin` navigation returned `ERR_ABORTED` before bootstrap or sign-out;
Markdown HMR is plausible but direct causation and the triggering frame were
not captured. After docs writes were held, the unchanged ordinary journey
passed. See the maintainers' private verification notes (not published).

Before this documentation integration, `main` was at
`7157875bc8c8c41c956d49a5dad8589ce45a3be9`, and the repair source was
`d32ccb74c5f21a2f2b7470c85dd02b63551cfad6`. This is pre-integration provenance
only; the final main status is read from the repository's Verify runs.
Part 6's disconnected archive/restore/re-export and setup/dev/preview no-key
closure passed on code head `b272d047e5f11a284ec0a8e6fa8c88cd1580d065` and again
on documentation head `7157875bc8c8c41c956d49a5dad8589ce45a3be9`. The receipts
are the maintainers' private verification notes (not published); both strict comparators and
root's independent reruns exited 0 with empty output, and their exact disposable
state and owned processes were cleaned up. Three earlier failed iterations
exposed an evidence-helper lookup gap and importer staging-name normalization;
all are preserved, and the final comparators normalized only documented
generated staging names. Verify runs `38139915110` (`b272`) and `38141489719`
(`7157875`) both completed **FAIL**, each with 571/593 passed, 22 failed and
zero skipped/cancelled. They predate the final source and test repairs now on
`d32ccb74c5f21a2f2b7470c85dd02b63551cfad6`. The bounded exact-`d32` compatibility gate
is Done: the six existing CI families passed 18/18 and the person-erasure
integration passed 2/2 (20/20 total); independent H4/H5/H7 passed 3/3; typecheck
and touched-file lint passed, with no new correctness or destructive-data
finding. Root independently reran the exact `d32` candidate: the same seven
native test files passed 20/20, H4/H5/H7 passed 3/3, and typecheck plus
touched-file lint exited 0. See the maintainers' private verification notes (not published). These bounded
checks do not establish whole Verify or full release acceptance. Consult
the maintainers' private verification notes (not published) for the actual final docs-bearing SHA, full
Verify disposition and latest archive receipt. See
[ACCEPTANCE.md](ACCEPTANCE.md), the maintainers' private verification notes (not published) for the current boundary.

The delayed operator-recipient repair on `d32ccb7` changes five production files:
each connection-alert, booking confirmation/reminder/cancellation and
alternative-request producer rechecks live native and product authority in the
same `INSERT ... SELECT` that stores recipient mail. ID, access generation,
normalized email, active status, and nonremoved/nonerased product state must
still match. A stale operator command is omitted after removal and fresh
invitation; the surrounding booking/request and eligible invitee commands still
commit. The bounded worker evidence records before counts of 1 connection alert,
3 booking/reminder rows, 1 cancellation and 1 alternative-request notice, then
zero for each after the fix, and 12/12 TAP entries including the parent. The
separate root pre-fix reproduction did not run because its queue depth was nine;
the before counts are from the scoped worker evidence only. Recovery insertion
was audited and remains unchanged because it selects from the live source row.
No migration changed. See the maintainers' private verification notes (not published).

Four CI compatibility commits followed the two failing historical Verify
runs: `c050bc1` repaired durable-source mail fixtures (17/17), fresh held-out
fixtures (8/8) and the invoking case; `e46b97c` aligned the documentation
manifest's 25 source files with 7 published and 18 GitHub-only files (6/6 plus
root's rerun); `1ff6c5c` isolated provider/control tables in `PROVIDER_DB`
without changing the application schema (writer 4/4); and `453dfee` covered
ordinary removal, fresh native identity and protected-owner holds (writer 2/2).
The independent `d32` compatibility review covered the complete 20-path diff,
including five production mail-admission files and 15 test/fixture paths. It
also ran the existing person-erasure journey 2/2, held-out H4/H5/H7 3/3,
typecheck, touched-file lint, and light syntax/whitespace checks; the report
records no gaps. Root's separate rerun passed the same native journeys and
focused checks. Neither bounded result replaces full Verify. See
the maintainers' private verification notes (not published).

No production deployment, live provider acceptance, source publication, tag,
or public release is claimed here. A dry-run command or local fixture is not
remote acceptance. Release metadata, local artifacts, deployment receipts,
provider verification, and owner-observed production use are separate evidence
surfaces.

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

The native 9/9 run and original root benchmark used implementation revision
`11e44e12b4b4757844bd2e46200876f256cf9c26`. Boundary and manifest checks
passed on product integration `2eb3326`, and typecheck exited 0. The final
browser auditor source was `c4393dc`; the later commits in that audit lane
changed helpers only, not product source. Root subsequently added additive
auth migration `0031_auth_domain_rules_step_up.sql` and moved the byte-identical
avatar, search and sidecar migrations to 0032–0034. The root gate then passed
typecheck, five focused tests and a native held-out avatar check. These
source-specific checks do not determine final integrated verification; consult
the maintainers' private verification notes (not published) for its actual final-head disposition.

The corrected integrated implementation `efdc6f2655da2791ad1b674f11c9e078f8c66407` subsequently passed the root's own 11/11 focused native rerun, 40 HTTP boundary checks and typecheck, together with a fresh native review. The avatar failure/recovery proof now preserves the prior pointer and has no orphan R2 bytes during the continuing D1-write outage or after healthy retry. The emitted-module privacy scan covered 430 modules. These later bounded receipts supersede the earlier five-test summary above; they do not claim final-head archive, erasure or production acceptance.

## Inherited authentication verification boundary

The authentication predecessor at ab52675 includes migration 0030; CI run
38120226998 succeeded with 583/583 reported tests. The final OPER-001 m1
full verification after its stop fix remains unproven: the earlier final run
required cleanup after a SIGKILL and also hit an unrelated process timeout
under load 50. This handover carries the predecessor's CI result only; it does
not claim that final local full verification or repeat it.

The new Base hooks `beforeMagicLink` and `afterConfirm` do not provide an
atomic rate-write hook. Keep the narrow authentication rate-write requirement
in Part 5 open; adding migration `0031_auth_domain_rules_step_up.sql` does not
close that erasure boundary. A real native valid-link confirmation run leaves
one attributable confirmation-rate key after ordinary operator removal; the
invitation key is gone and an unrelated control rate row remains. The result is
recorded in the maintainers' private verification notes (not published). No global purge, auth fork, or
unmaintained SQL interception was introduced.

The erasure design memo is approved. Dial adopted its 11-file runtime helper at
Base `4eed99c6a4ca708a9db70d4b5759f5678053cdf5` and retained the whole CLI
source origin `3d643dda1d203d36e3fa57e8e5ba14e414bba6f9`. The helper adoption is
not evidence of a green current Base aggregate gate: the newer aggregate
recorded 14/24 passing stages, with failures also present on the inherited
baseline. Do not report it as green.

The independent erasure review found that an operator-email overlap hold also
blocked the person-level invitee erasure journey. Both that correction and the
SDK custody correction are integrated in exact source
`c86785fc5c886c63dc655c258fb20749722e6042`; its source-scoped gate remains
qualified on that SHA. The fresh
scoped gate in the maintainers' private verification notes (not published) is Done with no new correctness or
requirement gaps in those two repairs. Ordinary co-host and protected self
each had two bookings and one request; one confirmation erased all matching
invitee records and truthfully reported `operatorIdentityRetained: true`. The
native identity, credentials, sessions and setup state remained unchanged
until a separate authorized operator-removal operation. Self/setup/last-owner
identity-removal holds remain in force.

The scoped gate passed 12/12 touched native tests, typecheck and lint. Its
actual product observability preparation retired 2,644 reachable SDK rows,
including two positive canaries, to zero, created no new rows and left nine
D1 and seven R2 control files byte-identical. Seven actual SDK lifecycle fault
cases and hydrated Settings checks at 390/320 px also passed with truthful
disclosure, settled keyboard focus, reflow, zero axe violations and no page or
console errors. Root independently reran eight SDK fault cases and 2/2 native
person-erasure journeys (zero fail/skip/cancel) plus typecheck; it also
confirmed same-store retirement and control-file preservation. These receipts
prove logical reachable-row retirement only, not physical page sanitization
or external-log deletion. Gate-created processes, faults and scratch state were
removed; no owned process or remote job remains. The independent native
valid-confirmation rate key still survives ordinary removal, so this does not
complete `DATA-002`.

The current census in `ERASURE.md` covers 105 application tables, eight static
portability tables and `sqlite_sequence` (114 readable SQLite tables total).
The earlier person-record correction receipt is
the maintainers' private verification notes (not published); the scoped integrated correction gate
is the maintainers' private verification notes (not published), with root rerun in
the maintainers' private verification notes (not published). The source lock and offline copy check
on `c86785f` covered 274 Base CLI/onboarding files plus 11 erasure helper files
with zero drift and zero unrecorded copies (the maintainers' private verification notes (not published)).
This does not qualify the full Base aggregate or close the separate rate
boundary.

## Final-head evidence and remaining acceptance

1. The code-head Verify on `b272d047e5f11a284ec0a8e6fa8c88cd1580d065` was run
   `38139915110`; the documentation-head Verify on
   `7157875bc8c8c41c956d49a5dad8589ce45a3be9` was run `38141489719`. Both
   finished **FAIL**, 571/593 passed, 22 failed and zero skipped/cancelled.
   The earlier `38134122328` run finished **FAIL**,
   588/589 passed, one failed and zero skipped/cancelled, on
   `cd10e2e49db6e408d8bbdea4fb9217e516132ab5`; it fixed the original profile,
   SSR-build and restore-notice failures but left the cold-host failure. The
   all-source repair is now committed at `d32ccb74c5f21a2f2b7470c85dd02b63551cfad6`.
   Its bounded exact-head compatibility gate passed as described in
   the maintainers' private verification notes (not published); root's independent exact-source rerun
   also passed, as recorded in the maintainers' private verification notes (not published). These scoped
   checks do not establish whole Verify. Consult
   the maintainers' private verification notes (not published) for the actual final docs-bearing SHA and
   full Verify disposition. Migrations `0035_person_erasure.sql` and
   `0036_person_record_erasure.sql` are additive; earlier applied migration
   bytes remain unchanged.
2. Part 6's disconnected fresh-clone setup/avatar/custom-fields/booking/erased-
   person export, import and re-export passed on exact code head `b272` and the
   later exact documentation head `7157875`. Both comparators and root reruns
   exited 0 with zero output; each receipt also proved no-key closure under
   `rer setup`, `rer dev` and `rer preview`, plus dev archive-path refusal. See
   the maintainers' private verification notes (not published) for the two completed receipts.
3. The `d32ccb7` delayed-recipient repair has bounded native evidence in
   the maintainers' private verification notes (not published): outbox inserts
   now atomically validate the selected native/product identity and no longer
   retain the erased operator's row after genuine removal and reenrollment;
   the ordinary booking/request commands and invitee mail still commit. Root's
   independent pre-fix reproduction did not execute at queue depth nine. This
   bounded source proof does not establish whole Verify; consult
   the maintainers' private verification notes (not published) for the final docs-bearing-head disposition.
4. Close the separate rate-attribution boundary with a maintained atomic
   rate-write hook, correlated identity admission, a narrowly scoped legacy
   ephemeral-window retirement, and populated-upgrade/valid-link/alias/
   late-write proof. The one valid-confirmation key remains after ordinary
   removal; full `DATA-002` is still open.
5. The final OPER-001 m1 journey remains unproved and was not duplicated.

The repository already sets `RER_SERVER_JOURNEY=1` for
`tests/local-setup/runtime.mjs`; `onboarding/fill.mjs` is absent and the
foundation branding-prepare guard does not apply. Whole WCAG conformance,
production capacity, live Google Calendar/owner-gated acceptance, external provider
receipts, publication and release remain separate owner gates.

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


The adjacent-main launcher integration was checked on `5cb7574799d02d898ce1feb35e5d035536220963`: 17/17 native HTTP/private-file checks, the affected AVAIL-009 journey (1/1), typecheck and lint of 21 changed source files passed. Product, schema and production Vite configuration were unchanged from the corrected 11-test implementation above. Root restored the inherited-key isolation and bounded audit/capacity dispatch before this check. This narrow receipt was followed by completed disconnected archive receipts on `b272` and `7157875`; consult the maintainers' private verification notes (not published) for the actual final docs-bearing-head archive result.
