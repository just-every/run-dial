# Dial's company agent door

Dial mounts one copied `createAgentDoor` in the production Worker, inside native
archive admission and ahead of application authentication and setup redirects.
The runtime and CLI pin is `rer-v0.2.87`, Base commit
`62f07fe6ecfdeae1a90bf6e65a02abae288996b3`. Copied transport, policy and validators
are unchanged. MCP negotiates `2026-07-28` and `2025-11-25`; `2025-03-26` refuses
with HTTP 400 / JSON-RPC -32022.

The declared capabilities are `tools`, `policy`, `pause`, `audit`, `idempotency`,
in `agent-surface.json` and the options passed to `createAgentDoor`. Version
0.2.87 accepts this field but does not scope optional families. Base #670 must
supply that behavior before this adoption can be complete. In particular, the
copied runtime always adds `dial.events.list`; Dial does not declare the events
family or silently add it to its specialist contract to satisfy the old validator.
The resulting registry and surface failures stay failing in normal verification.

The scheduling coordinator reads native profiles, event configuration, hours,
calendar health, bookings, requests, delivery status, reports, clients, polls,
private link definitions, typed annotations and payment records. Its synchronous
commands edit profiles, draft and published event settings, schedules, booking
limits, correspondence configuration, payment configuration and appointment
product definitions; add client notes and fields; merge native clients; change
poll visibility; and revoke poll, booking-link and calendar grants. Website reads
and branding use the real native reader with its public-address checks. Creating
a product or changing a price never charges a person. There is no provider cost
registration; verification policy uses `spend: {none:true}`.

Every call re-reads the native owner's authority. Signed Business `owner_id` maps
through `operator_setup_identity.operator_id` to `oa_operators.id`; token email
never selects an account. Unknown or inactive native subjects cannot act.
Business team rows remain conflicts because Dial's native operator lifecycle
supports equal owners, not Business admin/member provisioning. A local promotion
cannot create a Business binding. No native session, device, SDK, provider or
import credential is converted into an agent credential. No local-credential
adapter is installed, so failed recognizable Business tokens have no local path.
Consent, current policy, pause, native revisions, scopes and named approvals stay
in the copied pipeline. Mutations expose server summaries; native client notes
name the agent as preparer and retain the sponsoring operator as native author.

Calendar disconnect uses the narrowing-only target schema and native connection
record. `calendar.grants` witnesses the actual retained connection authority;
missing authorizing identity on a connected record refuses. The other narrowing
witnesses read native voting and booking-link grants without returning capabilities.
There is no invented widening mode. Poll visibility cannot widen a native owner's
standing authority, so its surface states `sponsorEscalation:false` while retaining
a native target check; it does not name a person as the subject of a record visibility change.

The ten resource readers remain prepared in `resources.ts`, with owner checks,
record-derived sensitive classes, safe projections and untrusted text. They are
not mounted or declared as the `resources` capability: their complete resource
policy/approval/visibility proof is outstanding. Private records are available
through the declared native read tools. Missing and inaccessible resource targets
are not distinguished by the prepared readers.

The following families remain undeclared (core subset, 2026-10-29):

- **queuedLifecycle:** booking creation/cancellation/rescheduling/new-time
  requests and approval decisions, calendar conflict restoration/deletion retry,
  management-link rotation, delivery retry, poll invitations, request transitions,
  refunds, no-show fees and invoice issuance. These native commands prepare
  outbox work, independently due reminders or provider settlement. The native
  locations are `bookings/write-commands.ts`, `bookings/reminder-commands.ts`,
  `bookings/service.ts`, `polls/service.ts`, `availability-requests/service.ts`,
  `delivery/recovery.ts` and `payments/`. No agent continuation is wired, and the
  copied `operation.ts` and `pipeline.ts` are unchanged from their recorded
  0.2.87 source. That release fixes G-op-fanout; queued lifecycle stays undeclared
  because Dial has not integrated or proven native continuation custody.
- **events/subscriptions:** retained change feeds, subscriptions and delivery.
  Version 0.2.87 exposes its built-in listing regardless of the declared subset.
- **multiSponsor / ownerNativeAdministration:** Business team provisioning,
  operator invitations/roles, and native human confirmation of attendance stay
  with native people and screen doors. A company approval does not invent the
  seed's human proof or a new native role.
- **mailEdges:** inbound scheduling threads, mailbox identity and outbound
  agent messages are not offered. Native configured business notifications are
  ordinary seed automation, not an agent continuation claim.
- **resourceRefresh, timedLifecycle, dualHost:** no resource refresh service,
  delayed agent jobs, timers, monthly tuning or second host is declared.
- **provider administration:** Stripe connection/status/ACH, money settlement,
  QuickBooks account mapping/export/disconnect, and messaging disconnect remain
  native connector/owner operations. The current verification binding contract
  cannot supply all of their typed per-run provider configurations and native
  grant witnesses. No fake authority or receipt is substituted.

OAuth, installation, import, avatar/file upload and other person-only operations
are explicit clause-backed `notTools`. Target-only agent solvers and follow-up
jobs from AGENT-002 onward are not claimed as existing native tools.

`tests/agent-door/native-owner.mjs` drives signed owner claim, rejects raw setup
and replay, completes native session-bound OAuth, and creates native fixture
records through person/public routes. `provider-edge.mjs` replaces only exact
network origins, validates the real request credentials/payload and returns
provider-shaped receipts. The provider module covers Google/SendGrid and Microsoft/Resend native OAuth, health and grant revocation; website and DNS reads keep their exact-origin fixtures. All opaque values are generated per run. The fixture
control is test-only, never a production route. The surface journey records real
native tool/class calls, narrowing witnesses and injection arguments. Base's
normal verification exits remain unchanged and failures must be reported.

Additive migrations 0090/0091 establish Business state; 0092 copies the door SQL.
Authority, replay, pending approvals, policy and audit stores never travel in an
archive. Native person erasure scrubs matching retained client payloads and
expires matching pending work under exclusive native admission. Policy audit
evidence stays retained; erasure never invents a person's approval or an Undo.

The public Run site and demo navigation records retain their existing 6d38b54a
pin and bytes. Mounting the agent door does not refresh those public records.

The native owner initializer rejects a raw setup token (403), accepts its signed
claim (303), and refuses replay (409). Per-phase fixtures reconnect the native
OAuth flow and create fresh native events, links, polls and distinct clients
through the existing person and public routes. Every public fixture participant
has an isolated synthetic network identity; real rate limits remain active.
The fixture module is test-only and supplies no production route or SQL writer.

The canonical BASE-AGENT clauses come only from `rer door clauses --write`.
Their presence and generated status rows do not claim completed acceptance.
Dial's contract validator uses the same clause parser as the contract generator
and maps the shared clauses explicitly in `seed.json`.

Known upstream receipt limits remain visible on this pin. The runtime resolves
native targets and reclassifies before returning an approved result. Completed
deletion can return `not_found` on its receipt retry, and completed disable,
clear or disconnect can return a new review/refusal after the native effect.
Preserve once-only native effects and truthful current classes; never fabricate a
record, replay an outside effect or freeze risk to hide this receipt limitation.

Legacy archive compatibility also needs an upstream change at this pin. The
listed-release version 2 archive has no schema-object inventory. The published
portability importer refuses it before Dial's exact prior schema proof and
row upgrades can run. Native restore stays empty on refusal. No unverified-schema
acknowledgment is added and the native DATA-001 requirement is retained.
