# Dial handover

## Latest changes (14 Oct 2026)

- Public `main` was `550f530daa9d5c7eb3b143685e94decb675ac496` at the evidence snapshot. [Verify 38483935052](https://github.com/just-every/run-dial/actions/runs/38483935052) succeeded on that exact SHA: 603 TAP entries passed, with zero failed, cancelled or skipped. The count includes nested entries and is not a count of independent requirements. [Run site 38483935136](https://github.com/just-every/run-dial/actions/runs/38483935136) succeeded on the same SHA; its deploy job ran `rer deploy --site`, then read back `/run` as HTTP 200 and `www` root as HTTP 301 to the canonical domain. This is the pre-round recorded baseline; it certifies only that public SHA.
- The repository was publicly visible and MIT licensed at the snapshot. Source publication and the site workflow's deployment/readback are observed; tags/releases, live operator installation and real provider use are not established.
- `DATA-002`'s native authentication rate-attribution blocker is closed by the maintained `rateCorrelation` hook. Known-operator counters and their correlation rows commit in the same D1 batch; migration 0039 retires pre-hook counters. The valid-link operator-removal test verifies that counter and its correlation are removed while an unrelated control survives. Preserve Dial's hook adaptations when refreshing Base copies.
- The current schema census is 116 application tables, eight static portability tables and `sqlite_sequence` (125 total), after replaying 44 core migrations. `ERASURE.md` lists each table and its erasure/archive classification.
- Verify 38483935052 on `550f530` includes the maintained OPER-001 `tests/local-setup-journey.test.mjs` path: README public CLI with explicit `--owner-email` at 1440/390, pre-hydration sign-in, repeat setup preserving private configuration, reset refusal/safety, and an archive round-trip restoring local state. It does not exercise a Git-configured email default or interactive prompt; no separate Git-email journey is evidenced.
- The `connection-watch` coordinator probes a healthy calendar 30 seconds after each successful health check, then confirms a new failure at 10 and 20 seconds. It alerts only if the connection remains unhealthy; brief failures send neither an alert nor a recovery message.
- Move-in review remains synthetic: no real Calendly export has been checked. Current capacity measurements are tied to their recorded local workload/source; production capacity at manifest limits stays unqualified until the release cut.
- The keys13 keyboard run completed on source `110b58c13c6ea01b59c28f7c30b4dc71d79991b3` (remote job `20261014T005138829190Z-sd-dial-r6-keys13-30966956`): 344 checks passed, including 214 painted-focus observations and 28 screenshots, with zero failed records or browser errors. It covers main operator and public journeys at 1440/390. Native DOM dialog Tab/Shift+Tab containment, Escape and opener-focus restoration were tested; JavaScript `confirm`/`prompt` used Playwright accept/dismiss, so literal OS key input remains unverified (`AXIsProcessTrusted=false`). A later review added two public-reschedule completion-focus assertions outside this receipt; the final report must state keyboard verification for the exact frozen head. Full manual screen-reader review and the WCAG 2.2 AA target remain open.
- The exact upstream CLI pin is 0.2.2, which has no adapter reset preflight. Its documented narrow pnpm patch wires in awaited `resetPreflight`, preserves Dial's legacy build/setup storage and credential safety check during local reset, and accepts compatible `patch_hash` values. Package commit `3947e94` passed eight refusal cases with configuration and data preserved; a fresh exported consumer passed frozen install and `rer check`, and integration typecheck passed. The final report must state Verify's disposition for the exact landed head; the pre-round baseline does not certify later changes.
- SendGrid's published Essentials 50k price was $19.95/month on 14 Oct 2026. At 1,000 bookings and four to six transactional emails each, the estimated 4,000–6,000 sends use 8–12% of that allowance. The $24.95 typical estimate adds Cloudflare Workers Paid at $5; runtime usage remains conditional on included allowances, and taxes, domains, overages, optional tools and paid Google Workspace are excluded. The 60-day, 100-email/day SendGrid trial is not recurring free service.

## Current implementation boundary

The public command path is supplied by the exact `@runeditrun/rer` 0.2.2
package pin. `package.json` declares the pin and maps
`patches/@runeditrun__rer@0.2.2.patch`; `pnpm-lock.yaml` records its frozen
resolution. The patch adds the awaited adapter `resetPreflight` hook and
accepts pnpm's patched-version lock suffix. `scripts/installer/local.mjs`
binds Dial's setup UI, owner inputs,
deployment declaration, native provider bindings, legacy-reset guard and
archive policy. OPERATIONS.json version 2 opts into command contract 1 and
declares Dial's native setup, worker and sign-in-mail requirements. Node
22.20.0 and pnpm 10.12.4 are declared and checked. The shared package owns
command parsing, local state coordination, lifecycle and cleanup, and
portability execution; Dial's adapter supplies its product-specific behavior.

Local export and import use the pinned package's D1/R2 portability engine with
Dial's complete table classification and credential policy. Current transfer
supports local targets only. Remote transfer refuses before provider calls. The archive
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
install guide names the same repository. At the current evidence snapshot it
was public and MIT licensed; tags and releases were not inspected. A fork
points `repository.url` at its own repository.

## Acceptance and evidence boundary

The lifecycle clause ledger in [ACCEPTANCE.md](ACCEPTANCE.md#lifecycle-clause-ledger) is the single table for local versus live-only CAL, BOOK and NOTIFY behavior. The exact-SHA public Verify and Run site receipts above are green on `550f530`; earlier failures on `cd10e2e`, `526fd05`, `b272` and `7157875` are historical source-specific results. The recorded run's TAP count is not a count of independent product requirements.

Source publication and the site workflow's deploy/readback are observed. They do not prove live Google Calendar/Meet or SendGrid behavior, an owner-account operator installation, hosted recovery, a live booking, package publication or a tagged release. The latest disconnected archive receipts qualify older heads; a fresh exact-candidate archive qualification remains open. See [ACCEPTANCE.md](ACCEPTANCE.md) for the release gate and open obligations.

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

1. The final report must identify the exact landed SHA and its Verify disposition. The `550f530` result is the pre-round public baseline and certifies no later edits.
2. Obtain a fresh disconnected setup/archive/restore/re-export receipt for the exact release candidate. Existing `b272` and `7157875` receipts qualify only those earlier heads.
3. The keys13 keyboard receipt covers main operator/public journeys at 1440/390 and native DOM dialog Tab/Shift+Tab, Escape and opener-focus restoration. JavaScript `confirm`/`prompt` used Playwright accept/dismiss; literal OS key input remains unverified because `AXIsProcessTrusted=false`. The two later public-reschedule completion-focus assertions are outside that receipt; the final report must state their result on the exact frozen head. Full manual screen-reader review and the WCAG 2.2 AA target remain open.
4. Recheck the exact 0.2.2 CLI patch in the integrated exact-head gate. The bounded package proof is complete: awaited adapter reset preflight with the legacy reset safety check preserved, eight refusal cases retaining configuration/data, and fresh exported-consumer frozen install plus `rer check`.
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
