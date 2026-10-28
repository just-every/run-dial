# Dial target product contract

Dial is a scheduling and appointment-booking product for US independent professionals, service businesses and teams switching from Calendly, Acuity Scheduling or Microsoft Bookings, with Cal.com, SavvyCal and Reclaim as the additional bar.

## Product target

| | |
| --- | --- |
| Category | Scheduling and appointment booking software |
| Incumbents a buyer switches from | Calendly, Acuity Scheduling, Microsoft Bookings |
| Up-and-comers it must also beat | Cal.com, SavvyCal, Reclaim |
| First buyer | A US independent professional, service business or team; USD, with the host’s and invitee’s own time zones, running in the buyer’s Cloudflare account |

The primary journey: A host moves in their scheduling data, connects calendars, publishes an event and shares its link; an invitee selects a real free time, answers and pays where required, then receives the booking and can reschedule or cancel while the host sees the matching calendar, delivery and reporting records.

## How to read this contract

- This follows the RER contract standard.
- Core, Agent surface and Later are reported separately; native apps remain Core.
- Done means the clause’s complete journey is covered by its cited evidence; partial and missing remain build obligations.
- The Field proof register records outside-world observations and never blocks done.
- ACCEPTANCE.md, docs/CLAIMS.md and the Status summary are generated from this file.

## Shared duties (Base)

| Base duty | Duty | Delta clauses | Base journey |
| --- | --- | --- | --- |
| BASE-ACCESS-001 | Sign-in | none | not run |
| BASE-ACCESS-002 | Sessions | AUTH-001, AUTH-002, AUTH-004, AUTH-006, OPER-001, OPER-002, EDITOR-001, OPER-005, HOME-001, DOCS-001, PUBLIC-003, CAL-001, CAL-006, DATA-001, DATA-003, CUSTOM-002, AUTH-008, OPER-006, OPER-007, ADMIN-001, ADMIN-002, EVENT-007, EMBED-002, EMBED-003, EMBED-004, MEET-001, PAY-001, PAY-004, API-003, INTEG-005, INTEG-008, MIGRATE-001, MIGRATE-002, OPER-010, DATA-009, DATA-012, PAY-008, API-004 | not run |
| BASE-ACCESS-003 | Public endpoints | none | not run |
| BASE-ACCESS-004 | Server-side authorisation | OPER-010 | not run |
| BASE-INPUT-001 | Validation | none | not run |
| BASE-INPUT-002 | HTML | none | not run |
| BASE-INPUT-003 | Uploads | none | not run |
| BASE-SECRET-001 | No leakage | PAY-001 | not run |
| BASE-SECRET-002 | Startup | none | not run |
| BASE-DATA-001 | Export and import | OPER-001, BOOK-011, CAL-001, CAL-006, DATA-001, DATA-003, CUSTOM-002, AUTH-008, ADMIN-002, PAY-004, PAY-006, REPORT-003, DATA-004, DATA-005, MIGRATE-002, OPER-011, DATA-009, DATA-010, DATA-011, DATA-016, BOOK-016, PAY-008, API-010 | not run |
| BASE-DATA-002 | Retention | none | not run |
| BASE-DATA-003 | Erasure | AUTH-002, OPER-001, EVENT-004, EVENT-005, PUBLIC-006, CAL-003, DATA-002, CUSTOM-002, AUTH-007, AUTH-008, ADMIN-002, EVENT-009, DATA-004, DATA-006, DATA-007, DATA-008, OPER-010, DATA-009, DATA-010, DATA-011, DATA-012, DATA-014, DATA-016, API-008, API-009 | not run |
| BASE-DATA-004 | Outbound flows | none | not run |
| BASE-DATA-005 | Independence | none | not run |
| BASE-PUBLIC-001 | Privacy | AUTH-001, AUTH-002, AUTH-003, AUTH-006, OPER-001, PROFILE-001, PROFILE-002, PROFILE-003, EVENT-001, EVENT-004, EVENT-005, EVENT-006, HOME-001, DOCS-001, PUBLIC-001, PUBLIC-003, PUBLIC-004, PUBLIC-005, PUBLIC-006, AVAIL-005, BOOK-006, CAL-006, NOTIFY-007, CUSTOM-002, AUTH-007, AUTH-008, OPER-006, ADMIN-002, EVENT-011, LINK-003, BRAND-001, LOCALE-001, ROUTE-001, ROUTE-004, EMBED-001, EMBED-002, MOBILE-001, AVAIL-012, BOOK-013, MEET-003, API-001, API-003, INTEG-005, INTEG-006, MIGRATE-001, MIGRATE-005, HOME-002, HOME-003, DATA-013, DATA-017, PAY-008, API-006, API-009 | not run |
| BASE-PUBLIC-002 | Origins | none | not run |
| BASE-PUBLIC-003 | Accessibility | none | not run |
| BASE-OPS-001 | Health | none | not run |
| BASE-OPS-002 | Migrations | none | not run |
| BASE-OPS-003 | Idempotency | none | not run |
| BASE-OPS-004 | Failure is visible | none | not run |
| BASE-OPS-005 | Audit | none | not run |
| BASE-ROLE-001 | Roles through every door | AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-006, OPER-001, OPER-002, OPER-003, EDITOR-001, OPER-005, EVENT-006, HOME-001, PUBLIC-006, BOOK-006, BOOK-009, BOOK-011, BOOK-012, CAL-006, REQUEST-003, NOTIFY-007, DATA-001, DATA-002, DATA-003, CUSTOM-001, AUTH-007, AUTH-008, OPER-006, OPER-007, TEAM-001, TEAM-002, ADMIN-001, ADMIN-002, EVENT-007, TEAM-005, TEAM-006, ROUTE-003, EMBED-002, EMBED-003, EMBED-004, MOBILE-002, AVAIL-011, BOOK-014, MEET-001, PAY-004, NOTIFY-008, NOTIFY-010, CLIENT-001, REPORT-001, REPORT-003, API-001, API-003, INTEG-002, INTEG-003, INTEG-006, INTEG-008, DATA-004, DATA-005, MIGRATE-001, MIGRATE-002, MIGRATE-003, MIGRATE-004, MIGRATE-005, AGENT-001, AGENT-003, AGENT-007, AGENT-008, AGENT-009, AGENT-011, OPER-008, OPER-009, OPER-010, OPER-011, HOME-003, DATA-009, DATA-010, DATA-012, NOTIFY-012, NOTIFY-015, FLOW-007, API-004, API-005, API-006, API-007, API-008, API-009, API-010, MIGRATE-007 | not run |
| BASE-AUDIT-001 | Searchable, durable audit | OPER-001, OPER-004, EVENT-001, EVENT-005, CAL-001, DATA-001, DATA-002, OPER-007, TEAM-006, AVAIL-011, PAY-004, CLIENT-001, MIGRATE-001, DATA-013, DATA-016, NOTIFY-013, API-009 | not run |
| BASE-BACKUP-001 | Independent backup, restore and rollback | none | not run |
| BASE-DATA-006 | Erasure respects retention and legal hold | none | not run |
| BASE-SIGNIN-001 | Standards-based SSO and lifecycle | OPER-001, DATA-002, OPER-007, TEAM-001, ADMIN-001, PAY-002, PAY-003, PAY-006, PAY-007, API-003, INTEG-002, DATA-004, DATA-005, DATA-007, DATA-012 | not run |
| BASE-SIGNIN-002 | Native multi-factor authentication | none | not run |
| BASE-INSTALL-001 | Free self-host and removal | AUTH-006, OPER-001, OPER-003, OPER-005, HOME-001, AVAIL-008, REQUEST-004, NOTIFY-007, DATA-001, DATA-002, DATA-003, CUSTOM-002, AUTH-007, OPER-007, EMBED-001, EMBED-003, EMBED-004, MOBILE-002, REPORT-003, INTEG-005, OPER-011, HOME-002, HOME-003, DATA-009, DATA-016, NOTIFY-011, API-010 | not run |
| BASE-MAIL-001 | Truthful mail outcomes | AUTH-003, AUTH-005, AUTH-006, OPER-001, OPER-003, OPER-004, OPER-005, EVENT-002, EVENT-003, EVENT-004, EVENT-006, PUBLIC-002, PUBLIC-006, AVAIL-002, AVAIL-009, BOOK-001, BOOK-003, BOOK-004, BOOK-006, BOOK-009, BOOK-012, CAL-003, CAL-008, REQUEST-001, REQUEST-002, REQUEST-004, REQUEST-005, NOTIFY-001, NOTIFY-002, NOTIFY-004, NOTIFY-005, NOTIFY-006, NOTIFY-007, DATA-001, DATA-002, CUSTOM-002, AUTH-007, OPER-006, OPER-007, ADMIN-001, EVENT-008, EVENT-009, EVENT-011, LINK-002, LINK-003, BRAND-001, LOCALE-001, TEAM-005, TEAM-007, ROUTE-001, ROUTE-003, ROUTE-005, EMBED-002, EMBED-003, EMBED-004, AVAIL-012, BOOK-013, BOOK-014, BOOK-015, CAL-011, MEET-004, PAY-003, PAY-004, PAY-005, PAY-007, NOTIFY-008, NOTIFY-009, NOTIFY-010, FLOW-001, FLOW-002, FLOW-004, FLOW-005, CLIENT-001, REPORT-003, API-003, INTEG-002, INTEG-006, INTEG-007, MIGRATE-005, AGENT-003, AGENT-004, AGENT-007, AGENT-009, AGENT-011, OPER-008, OPER-010, HOME-002, DATA-009, DATA-012, DATA-013, DATA-016, BOOK-016, BOOK-017, PAY-008, NOTIFY-011, NOTIFY-013, NOTIFY-015, FLOW-007, FLOW-008, API-004, API-005, API-007, API-008, API-009, MIGRATE-007 | not run |
| BASE-ACCESSIBILITY-001 | One accessibility bar | none | not run |
| BASE-DOCS-001 | On-site docs from one contract | none | not run |
| BASE-AGENT-001 | One MCP door per seed | none | not run |
| BASE-AGENT-002 | The seed's jobs are tools, through the UI's own actions | AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006, AGENT-007, AGENT-008, AGENT-009, AGENT-010, AGENT-011, SURFACE-001 | not run |
| BASE-AGENT-003 | Records are resources | SURFACE-007 | not run |
| BASE-AGENT-004 | Business identity and short-lived, audience-bound tokens | none | not run |
| BASE-AGENT-005 | An agent acts as a person in a role, never more | SURFACE-004 | not run |
| BASE-AGENT-006 | Every action declares its risk class | AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006, AGENT-007, AGENT-008, AGENT-009, AGENT-010, AGENT-011, SURFACE-001, SURFACE-002, SURFACE-003, SURFACE-004, SURFACE-005, SURFACE-006 | not run |
| BASE-AGENT-007 | The company's policy decides, at one chokepoint | AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006, AGENT-007, AGENT-008, AGENT-009, AGENT-010, AGENT-011, SURFACE-011 | not run |
| BASE-AGENT-008 | Truthful attribution | SURFACE-005 | not run |
| BASE-AGENT-009 | Every agent action is audited with its class and decision | none | not run |
| BASE-AGENT-010 | Agents can follow changes | SURFACE-008 | not run |
| BASE-AGENT-011 | Limits are policy, and Pause stops everything | SURFACE-010 | not run |
| BASE-AGENT-012 | Writes are idempotent and conflict-safe | SURFACE-012 | not run |
| BASE-AGENT-013 | Manifest, docs and the conformance journey | SURFACE-001, SURFACE-009, SURFACE-011, SURFACE-013 | not run |

## Published clauses

- `AUTH-001`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-PUBLIC-001
- `AUTH-002`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-DATA-003, BASE-PUBLIC-001
- `AUTH-003`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-PUBLIC-001
- `AUTH-004`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002
- `AUTH-005`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `AUTH-006`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-MAIL-001, BASE-PUBLIC-001, BASE-INSTALL-001
- `OPER-001`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-AUDIT-001, BASE-DATA-001, BASE-DATA-003, BASE-MAIL-001, BASE-PUBLIC-001, BASE-SIGNIN-001, BASE-INSTALL-001
- `OPER-008`: *Tier:* Core · *From:* OPER-001 · *Cites:* BASE-ROLE-001, BASE-MAIL-001
- `OPER-009`: *Tier:* Core · *From:* OPER-001 · *Cites:* BASE-ROLE-001
- `OPER-002`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002
- `OPER-010`: *Tier:* Core · *From:* OPER-002 · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-DATA-003, BASE-MAIL-001, BASE-ACCESS-004
- `OPER-003`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-INSTALL-001
- `OPER-004`: *Tier:* Core · *Cites:* BASE-AUDIT-001, BASE-MAIL-001
- `EDITOR-001`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002
- `OPER-005`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-MAIL-001, BASE-INSTALL-001 · *Register:* R-43
- `OPER-011`: *Tier:* Core · *From:* OPER-005 · *Cites:* BASE-ROLE-001, BASE-DATA-001, BASE-INSTALL-001
- `PROFILE-001`: *Tier:* Core · *Cites:* BASE-PUBLIC-001
- `PROFILE-002`: *Tier:* Core · *Cites:* BASE-PUBLIC-001
- `PROFILE-003`: *Tier:* Core · *Cites:* BASE-PUBLIC-001
- `EVENT-001`: *Tier:* Core · *Cites:* BASE-AUDIT-001, BASE-PUBLIC-001
- `EVENT-002`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `EVENT-003`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `EVENT-004`: *Tier:* Core · *Cites:* BASE-DATA-003, BASE-MAIL-001, BASE-PUBLIC-001 · *Register:* R-1
- `EVENT-005`: *Tier:* Core · *Cites:* BASE-AUDIT-001, BASE-DATA-003, BASE-PUBLIC-001
- `EVENT-006`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-PUBLIC-001
- `HOME-001`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-PUBLIC-001, BASE-INSTALL-001
- `HOME-002`: *Tier:* Core · *From:* HOME-001 · *Cites:* BASE-MAIL-001, BASE-PUBLIC-001, BASE-INSTALL-001
- `HOME-003`: *Tier:* Core · *From:* HOME-001 · *Cites:* BASE-ROLE-001, BASE-PUBLIC-001, BASE-INSTALL-001
- `DOCS-001`: *Tier:* Core · *Cites:* BASE-ACCESS-002, BASE-PUBLIC-001 · *Register:* R-39, R-40
- `PUBLIC-001`: *Tier:* Core · *Cites:* BASE-PUBLIC-001
- `PUBLIC-002`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `PUBLIC-003`: *Tier:* Core · *Cites:* BASE-ACCESS-002, BASE-PUBLIC-001
- `PUBLIC-004`: *Tier:* Core · *Cites:* BASE-PUBLIC-001
- `PUBLIC-005`: *Tier:* Core · *Cites:* BASE-PUBLIC-001
- `PUBLIC-006`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-003, BASE-MAIL-001, BASE-PUBLIC-001
- `AVAIL-001`: *Tier:* Core
- `AVAIL-002`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `AVAIL-003`: *Tier:* Core
- `AVAIL-004`: *Tier:* Core
- `AVAIL-005`: *Tier:* Core · *Cites:* BASE-PUBLIC-001
- `AVAIL-006`: *Tier:* Core
- `AVAIL-007`: *Tier:* Core
- `AVAIL-008`: *Tier:* Core · *Cites:* BASE-INSTALL-001
- `AVAIL-009`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `BOOK-001`: *Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-6
- `BOOK-002`: *Tier:* Core
- `BOOK-003`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `BOOK-004`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `BOOK-005`: *Tier:* Core
- `BOOK-006`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-PUBLIC-001
- `BOOK-007`: *Tier:* Core
- `BOOK-008`: *Tier:* Core
- `BOOK-009`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001
- `BOOK-010`: *Tier:* Core
- `BOOK-011`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001
- `BOOK-012`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001
- `CAL-001`: *Tier:* Core · *Cites:* BASE-ACCESS-002, BASE-AUDIT-001, BASE-DATA-001 · *Register:* R-8
- `CAL-002`: *Tier:* Core
- `CAL-003`: *Tier:* Core · *Cites:* BASE-DATA-003, BASE-MAIL-001 · *Register:* R-9
- `CAL-004`: *Tier:* Core
- `CAL-005`: *Tier:* Core
- `CAL-006`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-DATA-001, BASE-PUBLIC-001 · *Register:* R-10
- `CAL-007`: *Tier:* Core · *Register:* R-11
- `CAL-008`: *Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-12
- `CAL-009`: *Tier:* Core
- `REQUEST-001`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `REQUEST-002`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `REQUEST-003`: *Tier:* Core · *Cites:* BASE-ROLE-001
- `REQUEST-004`: *Tier:* Core · *Cites:* BASE-MAIL-001, BASE-INSTALL-001
- `REQUEST-005`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `NOTIFY-001`: *Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-18
- `NOTIFY-002`: *Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-19
- `NOTIFY-003`: *Tier:* Core · *Register:* R-20
- `NOTIFY-004`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `NOTIFY-005`: *Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-21
- `NOTIFY-006`: *Tier:* Core · *Cites:* BASE-MAIL-001
- `NOTIFY-007`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-PUBLIC-001, BASE-INSTALL-001 · *Register:* R-22
- `DATA-001`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-AUDIT-001, BASE-DATA-001, BASE-MAIL-001, BASE-INSTALL-001
- `DATA-009`: *Tier:* Core · *From:* DATA-001 · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-DATA-001, BASE-DATA-003, BASE-MAIL-001, BASE-INSTALL-001
- `DATA-010`: *Tier:* Core · *From:* DATA-001 · *Cites:* BASE-ROLE-001, BASE-DATA-001, BASE-DATA-003
- `DATA-002`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AUDIT-001, BASE-DATA-003, BASE-MAIL-001, BASE-SIGNIN-001, BASE-INSTALL-001
- `DATA-011`: *Tier:* Core · *From:* DATA-002 · *Cites:* BASE-DATA-001, BASE-DATA-003
- `DATA-012`: *Tier:* Core · *From:* DATA-002 · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-DATA-003, BASE-MAIL-001, BASE-SIGNIN-001
- `DATA-003`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-DATA-001, BASE-INSTALL-001 · *Register:* R-34
- `DATA-013`: *Tier:* Core · *From:* DATA-003 · *Cites:* BASE-AUDIT-001, BASE-MAIL-001, BASE-PUBLIC-001 · *Register:* R-34
- `DATA-014`: *Tier:* Core · *From:* DATA-003 · *Cites:* BASE-DATA-003 · *Register:* R-34
- `DATA-015`: *Tier:* Core · *From:* DATA-003 · *Register:* R-34
- `DATA-016`: *Tier:* Core · *From:* DATA-003 · *Cites:* BASE-AUDIT-001, BASE-DATA-001, BASE-DATA-003, BASE-MAIL-001, BASE-INSTALL-001 · *Register:* R-34
- `DATA-017`: *Tier:* Core · *From:* DATA-003 · *Cites:* BASE-PUBLIC-001 · *Register:* R-34
- `CUSTOM-001`: *Tier:* Core · *Cites:* BASE-ROLE-001
- `CUSTOM-002`: *Tier:* Core · *Cites:* BASE-ACCESS-002, BASE-DATA-001, BASE-DATA-003, BASE-MAIL-001, BASE-PUBLIC-001, BASE-INSTALL-001

### Authorization

#### AUTH-001 — Public authority

**Requirement.** Supersedes `BASE-ACCESS-004` for the paths listed in the declared public paths and for no others.

**Acceptance.**
1. Supersedes `BASE-ACCESS-004` for the paths listed in the declared public paths and for no others.
2. Those paths authorize the caller by the capability material named in `AUTH-002` to `AUTH-007` instead of an operator session, each capability grants exactly the one action or record it names, and a request carrying no valid capability material changes nothing.

#### AUTH-002 — Booking nonce

**Requirement.** Reaching the details step for a selected slot, and reaching the review step of an alternative request, each issue a single-use nonce of at least 256 bits from a cryptographically secure random source, bound to the event type and to either the selected slot or the composed alternative request, and expiring 30 minutes after issue.

**Acceptance.**
1. Reaching the details step for a selected slot, and reaching the review step of an alternative request, each issue a single-use nonce of at least 256 bits from a cryptographically secure random source, bound to the event type and to either the selected slot or the composed alternative request, and expiring 30 minutes after issue.
2. The nonce is not bound to a browser: possession of an unexpired, unconsumed nonce is what authorizes the confirmation.
3. A confirmation whose nonce is missing, unknown, expired, or bound to different values creates nothing and answers per `PUBLIC-003`; a nonce that has already been consumed is answered by `BOOK-003`.
4. After an alternative request is submitted, that same consumed nonce grants read-only access to its acknowledgment delivery state, including after nonce expiry.
5. This receipt grants no additional read or mutation beyond the existing confirmation-replay behavior of `BOOK-003` and `REQUEST-002`, which remains unchanged.
6. The receipt returns only queued, sent, or failed, remains bound to the public event and original request, and becomes unavailable when either is unavailable or erased.

#### AUTH-003 — Booking access

**Requirement.** A booking is readable and changeable from a public surface only through the manage token defined in `BOOK-006`.

**Acceptance.**
1. A booking is readable and changeable from a public surface only through the manage token defined in `BOOK-006`.
2. A booking ID, an invitee email address, or any other guessable identifier grants access to no booking data.

#### AUTH-004 — Calendar authorization callback

**Requirement.** The calendar OAuth callback accepts only signed state that is bound to the operator session that started the connection and was issued less than 10 minutes earlier.

**Acceptance.**
1. The calendar OAuth callback accepts only signed state that is bound to the operator session that started the connection and was issued less than 10 minutes earlier.
2. State that is missing, unsigned, mismatched, replayed, or expired stores no credential, connects no account, and returns 400.

#### AUTH-005 — Provider callbacks

**Requirement.** A calendar or mail provider callback is accepted only when the provider's own authentication passes — its registered channel identity or its request signature — together with the secret configured for that provider.

**Acceptance.**
1. A calendar or mail provider callback is accepted only when the provider's own authentication passes — its registered channel identity or its request signature — together with the secret configured for that provider.
2. A callback that fails the check returns 401 and changes nothing.

#### AUTH-006 — First-owner admission

**Requirement.** On an empty native authentication store, a local CLI install accepts its setup token through native first-owner admission.

**Acceptance.**
1. On an empty native authentication store, a local CLI install accepts its setup token through native first-owner admission.
2. When managed owner-claim bindings are present, that route is closed and only a short-lived ES256 signed claim may admit the first owner.
3. The issuer, application origin, installation identity, public verification keys and owner email come from trusted deployment configuration.
4. Invalid claims write nothing.
5. Successful admission atomically records a permanent consumed claim, creates the native owner and product identity, and issues a native session; concurrent losers roll back, and subsequent admission is refused after restart or removal of the original owner.
6. Existing operator sessions, sign-in and equal-operator management retain their native protocol.

### Workspace, people and roles

#### OPER-001 — Roles and permissions

**Requirement.** A workspace has owners, admins, team managers, members (hosts) and read-only viewers.

**Acceptance.**
1. A workspace has owners, admins, team managers, members (hosts) and read-only viewers.
2. Owners and admins manage billing-free workspace settings, connections policy, people, teams, routing forms, workflows and integrations; team managers manage their teams' shared event types, round-robin pools and routing; members manage their own profile, calendars, availability, event types and bookings; owners and admins, and team managers for the members of their teams, also edit a member's schedules, overrides, time off and personal event types on that member's behalf under `OPER-006`; viewers read bookings and reports only.
3. Wherever another clause says that an operator, operators or an admin acts, the acting roles are these, and every other role is refused: (a) **on a booking or request** (`BOOK-006` token rotation, `BOOK-009`, `BOOK-011`, `BOOK-012`, `BOOK-014`, `CAL-008`, `REQUEST-003`, `TEAM-007` and the agent grants of `AGENT-001`): its host, a person that host delegated to under `TEAM-007`, a team manager for bookings and requests of their teams' event types or members, and owners and admins for all; (b) **on a host's own settings** (profile and handle, event types, availability, limits, locked zone, embeds, redirect, calendar and conferencing connections): that host, plus the reach `OPER-006` gives owners, admins, team managers and event-type grantees; (c) **workspace-wide powers, owners and admins only**: inviting and removing people and changing roles below owner (`OPER-002`; a team manager changes only the membership of the teams they manage), email-wide and per-record erasure (`DATA-002`), every move-in, connection, preview, apply, catch-up, release, undo and switch-over sign-off (`DATA-003`, `DATA-014`, `DATA-015`, `MIGRATE-001` to `MIGRATE-005`), the email and domain block list (`PUBLIC-006`), custom-field definitions (`CUSTOM-001`), workspace analytics and ad-conversion tags (`INTEG-006`), branding and custom domain (`BRAND-001`), the sending address and deployment-wide reminder, change and notification policies, workflows beyond one host's own event types (`FLOW-001`), SSO and SCIM (`ADMIN-001`), API credentials beyond the caller's own records (`AUTH-008`), workspace integrations, and reading the audit log (`ADMIN-002`); (d) **owners only**: the owner editor (`EDITOR-001`), the whole-install archive export and restore (`DATA-001`, `DATA-009`), granting or removing the owner role and owner transfer.
4. Viewers read bookings, requests and reports, export what `REPORT-003` allows them, and write nothing.
5. A refused action returns 403 with the typed error `role_forbidden` naming the action; it makes no change, issues no editor grant, preview, upload identity, OAuth state or token, sends nothing, and writes exactly one `ADMIN-002` entry recording the refusal.
6. A workspace holds the people, hosts, teams and event types of `OPER-007`, in any mix of roles.

#### OPER-008 — Role-scoped booking mail

**Requirement.** Booking mail follows these roles under `NOTIFY-008`: owners, admins and team managers receive another host's booking mail only through an opt-in copy for the scope they manage, which omits answers marked private and never carries the manage token; members receive none for another member's bookings, viewers none at all, and an alternative request on one host's event mails only that host; this clause carries those steps of `NOTIFY-008`'s two-host journey.

**Acceptance.**
1. Booking mail follows these roles under `NOTIFY-008`: owners, admins and team managers receive another host's booking mail only through an opt-in copy for the scope they manage, which omits answers marked private and never carries the manage token; members receive none for another member's bookings, viewers none at all, and an alternative request on one host's event mails only that host; this clause carries those steps of `NOTIFY-008`'s two-host journey.

#### OPER-009 — Role-scoped reporting

**Requirement.** A member sees only their own `REPORT-001` figures and drill-through; this clause carries that step of `REPORT-001`'s acceptance.

**Acceptance.**
1. A member sees only their own `REPORT-001` figures and drill-through; this clause carries that step of `REPORT-001`'s acceptance.

#### OPER-002 — Operator invitations and roles

**Requirement.** Owners and admins invite and remove people and change roles in Settings; only an owner grants or removes the owner role.

**Acceptance.**
1. Owners and admins invite and remove people and change roles in Settings; only an owner grants or removes the owner role.
2. A team manager adds members to and removes them from the teams they manage, which changes team membership only and never removes a person from the workspace.
3. Members and viewers invite, remove and change no one: each attempt returns 403 `role_forbidden` with no identity, session or token changed (`OPER-001`).

#### OPER-010 — Destructive operator removal

**Requirement.** Removal revokes access and erases the removed native identity, sessions, link tokens, external identity bindings, local mail and email-scoped rate records.

**Acceptance.**
1. Removal revokes access and erases the removed native identity, sessions, link tokens, external identity bindings, local mail and email-scoped rate records.
2. Unrelated authored records and the shared calendar remain, with an anonymous author reference.
3. A new invitation creates a new identity and cannot revive previous capabilities.
4. Identity overlap with invitee records requires explicitly erasing those records through the aggregate email confirmation or their detail pages before operator removal.
5. Self-removal and removal of the protected setup/bootstrap owner return an explicit hold; an owner-transfer workflow is required before that identity can be erased.
6. A shared domain policy retains its original creator ID as an inactive anonymous native reference whose authority cannot be reactivated.

#### OPER-003 — Booking workspace

**Requirement.** Operators can list bookings filtered by the lifecycle states of `BOOK-004`, and independently by whether the start instant is in the future or the past, by event type, by date range, and by whether any external delivery has failed.

**Acceptance.**
1. Operators can list bookings filtered by the lifecycle states of `BOOK-004`, and independently by whether the start instant is in the future or the past, by event type, by date range, and by whether any external delivery has failed.
2. Case-insensitive substring search over invitee name and email address returns within 500ms, on a single-host install and on a workspace at the `OPER-007` capacity (300 hosts and 1,000,000 bookings) alike.
3. Lists are sorted by start instant.
4. Each person lists and searches only the bookings they may read under `OPER-001`: a member their own, their delegated hosts' and shared team events; a team manager their teams'; owners, admins and viewers every booking.

#### OPER-004 — Booking record

**Requirement.** A booking record shows the event type, every invitee answer and custom-field value, the start and end in both the host's and the invitee's IANA zones, the location or meeting link, the history from `BOOK-010`, the separate state of the calendar event, the meeting link, and each email, and every recorded failure with its `CAL-005` or `NOTIFY-005` reason.

**Acceptance.**
1. A booking record shows the event type, every invitee answer and custom-field value, the start and end in both the host's and the invitee's IANA zones, the location or meeting link, the history from `BOOK-010`, the separate state of the calendar event, the meeting link, and each email, and every recorded failure with its `CAL-005` or `NOTIFY-005` reason.

#### EDITOR-001 — Owner editor

**Requirement.** When configured, the native operator app mounts the Base editor only after an active native owner session authorizes a private, non-cached grant lasting at most 30 seconds.

**Acceptance.**
1. When configured, the native operator app mounts the Base editor only after an active native owner session authorizes a private, non-cached grant lasting at most 30 seconds.
2. Session or grant expiry, revocation, refused refresh and logout remove editor authority.
3. The app permits framing only by itself and the exact trusted management origin, retaining unrelated security directives.
4. Editor grants are for owners only under `OPER-001`: an admin, team manager, member or viewer receives no editor configuration, and their grant request returns 403 `role_forbidden` with no grant issued.
5. Sessionless callers receive no editor configuration.

#### OPER-005 — First-run checklist

**Requirement.** On a local development checkout, `rer setup --owner-email <owner address>` followed by `rer dev` prints the signed-in owner identity and a private local entry URL; opening that URL uses Base's development sign-in to establish the owner's native session and sends a fresh owner to private the documented route, without reading a mailbox.

**Acceptance.**
1. On a local development checkout, `rer setup --owner-email <owner address>` followed by `rer dev` prints the signed-in owner identity and a private local entry URL; opening that URL uses Base's development sign-in to establish the owner's native session and sends a fresh owner to private the documented route, without reading a mailbox.
2. Hosted installers claim the owner through the configured admission flow (`AUTH-006`), then use native email-link sign-in delivered through the configured mail provider; a fresh owner also arrives at the documented route. Setup provides the same real profile, connection, event and availability editors.
3. A same-origin authenticated finish command requires a currently valid host profile and a published event with a persisted copy report for its current canonical booking URL, revalidating EVENT-006 readiness and the profile/event/report snapshot.
4. **Copy booking link** persists that report after its clipboard write succeeds; when clipboard access is denied it shows the booking link in a selectable read-only field, and **I have shared it** persists the same report through the same authenticated, same-origin route.
5. Request-only events require alternative requests and a successful mail check; they require no Google Calendar or availability window.
6. Local development and demos validate and silently suppress outgoing mail without a local inbox or outbox, and their readiness result proves only that local path.
7. Missing configuration and provider failures never select local delivery. Automatic booking requires saved availability and verified mail; a calendar is optional for fixed locations, while connected calendars and Google Meet retain their provider checks.

#### OPER-011 — Durable setup completion

**Requirement.** Completion records a server timestamp once.

**Acceptance.**
1. Completion records a server timestamp once.
2. Completed the documented route visits go to the documented route; aging connection health, later edits or deletion never reopen first run.
3. Owner reinvitation, setup reruns and whole-install export/restore preserve the marker.
4. The forward migration marks already-existing setup identities with their creation time solely for upgrade compatibility, without asserting historical checklist completion.
5. Owners claimed after migration start unfinished.
6. Reset removes local completion with local owner data; the next fresh claim must complete setup again.

### Profiles, event types and links

#### PROFILE-001 — Host profile

**Requirement.** Each host edits their name, title, biography, avatar, IANA timezone, focus areas and social-proof entries, within the counts and lengths in the documented capacity limits.

**Acceptance.**
1. Each host edits their name, title, biography, avatar, IANA timezone, focus areas and social-proof entries, within the counts and lengths in the documented capacity limits.
2. A social-proof entry is a quotation and an attribution typed by an operator: Dial collects no invitee feedback and publishes no rating, score or count it did not receive from an operator.
3. Each host has exactly one profile timezone, which is what every other clause means by "the host's zone" for that host's bookings; a team event's host zone is the assigned host's.
4. The in-app preview renders the same content as the public page. `TEAM-001`, `TEAM-003` and `TEAM-005` each state their part of the multi-host rule in their own text.

#### PROFILE-002 — Public profile

**Requirement.** The host profile is served at the documented route, where the handle is set by an operator.

**Acceptance.**
1. The host profile is served at the documented route, where the handle is set by an operator.
2. It shows the configured host content and every published, listed event type, and never a draft, unlisted, or disabled one.
3. An operator can change the handle; the previous handle then answers per `PUBLIC-005`.

#### PROFILE-003 — Avatar asset

**Requirement.** Supersedes `BASE-INPUT-003` for the the documented route prefix only.

**Acceptance.**
1. Supersedes `BASE-INPUT-003` for the the documented route prefix only.
2. The avatar is an upload within the size and type limits in the documented capacity limits, stored in R2 and served under the documented route with its declared content type and inline rather than with a download disposition, because it renders as an image on the public profile and event pages.
3. That prefix is the public delivery channel the baseline requires a product contract to name; every other upload rule still applies, and no other upload in this product is publicly readable.

#### EVENT-001 — Event type lifecycle

**Requirement.** Operators create, edit, publish, disable, and delete event types.

**Acceptance.**
1. Operators create, edit, publish, disable, and delete event types.
2. An event type is draft, published, or disabled, and a published one is either listed on the public profile or unlisted and reachable only by its own URL.
3. Each carries a title, description, one to four duration options of 5 to 480 minutes each with one of them the default (`EVENT-011`), color, location, and a slug unique among event types, and is served at the documented route.
4. A slug can be edited; the previous slug is not retained and then answers per `PUBLIC-005`, while existing bookings and their manage links are unaffected.
5. An operator can duplicate an event type: the copy is a draft with every setting, question, location, schedule binding, template (`NOTIFY-009`) and workflow attachment of the original, titled "<title> (copy)" with a new unique slug, and carries no bookings, requests or history.
6. Creating or duplicating an event type past an event-type capacity of `OPER-007` is refused under that clause and creates nothing. `OPER-007`, `TEAM-006` and `FLOW-001` each state their part in their own text.

#### EVENT-002 — Scheduling constraints

**Requirement.** Each event type configures its recurring availability, date-specific overrides, slot start increment of 5, 10, 15, 30, 45 or 60 minutes, minimum notice of 0 minutes to 7 days, a booking horizon that is rolling (1 day to `seed.json → limits.availabilityLookaheadDays`, counted in calendar days or in weekdays), a fixed date range, or indefinite (up to that same lookahead limit), before and after buffers of 0 to 120 minutes each, and an optional maximum number of bookings per host day, where a host day is one calendar date in the host's timezone.

**Acceptance.**
1. Each event type configures its recurring availability, date-specific overrides, slot start increment of 5, 10, 15, 30, 45 or 60 minutes, minimum notice of 0 minutes to 7 days, a booking horizon that is rolling (1 day to `seed.json → limits.availabilityLookaheadDays`, counted in calendar days or in weekdays), a fixed date range, or indefinite (up to that same lookahead limit), before and after buffers of 0 to 120 minutes each, and an optional maximum number of bookings per host day, where a host day is one calendar date in the host's timezone.
2. A new event type starts at a 30-minute duration, a 15-minute increment, 4 hours' minimum notice, a 60-day horizon, no buffers, and no host-day limit.

#### EVENT-003 — Invitee questions

**Requirement.** Each event type has ordered booking questions of type text, textarea, phone number, single choice, dropdown, multiple choice, or checkbox, each required or optional, within the question and option counts in the documented capacity limits.

**Acceptance.**
1. Each event type has ordered booking questions of type text, textarea, phone number, single choice, dropdown, multiple choice, or checkbox, each required or optional, within the question and option counts in the documented capacity limits.
2. Choice options have stable values and editable labels, and a submitted option not configured on the event type is rejected.
3. A phone-number answer is validated as an E.164 number (US numbers accepted in national format), stored normalized; `INTEG-002`, `INTEG-003`, `INTEG-004` and `INTEG-008` each require mapping that value to their CRM phone field; a dropdown is a single choice shown as a select for long option lists.
4. A name and a syntactically valid email address are always required.
5. The product setting starts with name and email, plus an optional agenda of at most 500 characters, on every new event type.

#### EVENT-004 — Locations

**Requirement.** An event type offers one or more locations, and when it offers several the invitee chooses one before confirming: a Google Meet, Zoom, Microsoft Teams, Webex or GoTo Meeting conference provisioned per booking under the host's own account (`CAL-003`, `MEET-001` to `MEET-003`); a fixed link the operator supplies; a host phone number the invitee calls; the invitee's phone number, which the host calls; an in-person address; a place the invitee supplies ("Ask invitee"), where the booking page asks the invitee for the meeting address, phone number or link as a required field with the operator's prompt, available on one-on-one, round-robin and collective events alike; or a custom instruction.

**Acceptance.**
1. An event type offers one or more locations, and when it offers several the invitee chooses one before confirming: a Google Meet, Zoom, Microsoft Teams, Webex or GoTo Meeting conference provisioned per booking under the host's own account (`CAL-003`, `MEET-001` to `MEET-003`); a fixed link the operator supplies; a host phone number the invitee calls; the invitee's phone number, which the host calls; an in-person address; a place the invitee supplies ("Ask invitee"), where the booking page asks the invitee for the meeting address, phone number or link as a required field with the operator's prompt, available on one-on-one, round-robin and collective events alike; or a custom instruction.
2. The public event page shows only each location's label; the link, number or street address appears only after confirmation, in the receipt, the invitee's email and the calendar event.
3. An invitee phone number is collected only for a location, an SMS reminder (`FLOW-002`) or a phone-number question (`EVENT-003`) that needs it, is validated as an E.164 US or international number, and is erased under `DATA-002`. `MEET-001`, `MEET-002` and `MEET-003` (only the chosen location is provisioned and disclosed), `TEAM-003`, `TEAM-005` and `NOTIFY-008` (the Ask-invitee value reaches only the booking's host recipients) each state their part in their own text.

#### EVENT-005 — Removing an event type

**Requirement.** Supersedes `BASE-DATA-003` for event types only: disabling or deleting an event type removes its public page and all its future availability but does not cascade to its bookings, which keep their times, manage links, calendar events, history, and their own copy of the event title, duration, and location.

**Acceptance.**
1. Supersedes `BASE-DATA-003` for event types only: disabling or deleting an event type removes its public page and all its future availability but does not cascade to its bookings, which keep their times, manage links, calendar events, history, and their own copy of the event title, duration, and location.
2. Invitee data is erased under `DATA-002`, not by deleting an event type.

#### EVENT-006 — Publication readiness

**Requirement.** An event type can be published only when it has at least one open availability window and when its transactional-mail configuration, any connected destination calendar, and, where its location is provider-generated, its conferencing capability each passed a connection check within the last 24 hours or since they last changed.

**Acceptance.**
1. An event type can be published only when it has at least one open availability window and when its transactional-mail configuration, any connected destination calendar, and, where its location is provider-generated, its conferencing capability each passed a connection check within the last 24 hours or since they last changed.
2. No connected calendar is required for a fixed link, phone number or in-person address: these events use saved availability minus persisted Dial bookings.
3. Publishing explicitly turns on real bookings, with a notice that no external calendar conflicts are checked when disconnected. Google Meet always requires a healthy conference-capable destination calendar. An unhealthy or incomplete connection is never treated as absence.
4. A connection check is a live read of the connected destination calendar, a credential probe against the mail provider, and, where conferencing is used, a capability check against the conferencing provider; an operator can run it on demand.
5. The operator sees each unmet requirement named. A requirement that becomes unhealthy after publication does not unpublish the event type: the connection state changes under `CAL-006` and public booking behaves under `AVAIL-004`.
6. As an explicit exception, an operator may open a draft or disabled event in request-only mode with a saved valid host profile/timezone, alternative requests enabled and a successful transactional-mail connection check.
7. Request-only publication requires no open availability window, destination calendar or conferencing connection, offers no availability or bookable slots, and rejects booking creation; proposed request windows do not reserve time.
8. Enabling automatic booking uses the normal publication checks above and clears request-only mode only after they pass.

### Public home

#### HOME-001 — Installed Lobby

**Requirement.** An installed deployment's root `/` is the sessionless installed Lobby.

**Acceptance.**
1. An installed deployment's root `/` is the sessionless installed Lobby.
2. Before setup completion is recorded it says the installation is waiting for its owner and offers a **Finish setup** action to the documented route; after completion it names the deployment, offers a **Sign in** action and credits Dial with a link to its run site.
3. A saved host profile alone never changes that state.
4. The Lobby reads only the setup state, has one top-level heading.

#### HOME-002 — Product run site

**Requirement.** The product landing for Dial itself is the separate run site at `run-dial.com`, built independently of the installed deployment.

**Acceptance.**
1. The product landing for Dial itself is the separate run site at `run-dial.com`, built independently of the installed deployment.
2. It presents, in order, a hero with the product's headline, a description, directly beneath it in small text the single line "100% free, open source alternative to Calendly, Acuity Scheduling and SavvyCal" (the three company names in bold, the words of a name joined by a non-breaking space, the line wrapped evenly; repeated in plain text at the start of the page's meta description, with no email- or phone-shaped text and no comparative claim), then a **Run Dial** action to the documented route and a **Read the docs** action to the documented route; sections for invitees, for the host, the booking essentials, alternative requests and self-hosting; and a closing section repeating both actions.
3. Its header links home, to the documented route and to the source repository, and its footer repeats those links as plain text links beside a small wordmark and single-line description; neither links an installation route (the documented route, the documented route, the documented route, the documented route, the documented route).
4. The site reads no installation data, its typeface self-hosted and every drawing inline and decorative.
5. It has one top-level heading, is readable without script, renders its final state with reduced motion (its only motion is a one-shot hero sequence), and keeps a fixed light palette regardless of the browser's color scheme.

#### HOME-003 — Installed public chrome

**Requirement.** An installation's own public chrome (its the documented route pages) adds a link to the documented route, names the deployment-configured owner only when the deployment configures one (a new install configures none), and shows the `Powered by Dial · runeditrun.com` footer credit as a static link controlled by deployment configuration, enabled by default and omitted when disabled.

**Acceptance.**
1. An installation's own public chrome (its the documented route pages) adds a link to the documented route, names the deployment-configured owner only when the deployment configures one (a new install configures none), and shows the `Powered by Dial · runeditrun.com` footer credit as a static link controlled by deployment configuration, enabled by default and omitted when disabled.

#### DOCS-001 — Public documentation

**Requirement.** The public paths the documented route and the documented route serve Dial's first-party documentation: the Markdown files that `docs/site.json` lists as published, in the sections and order it gives, which is the only navigation.

**Acceptance.**
1. The public paths the documented route and the documented route serve Dial's first-party documentation: the Markdown files that `docs/site.json` lists as published, in the sections and order it gives, which is the only navigation.
2. The documentation Markdown is rendered to HTML at build time: a Vite plugin renders each page when Vite loads it, in a build and in development, and never in the Worker or the browser, so the emitted Worker and client bundles contain no Markdown or syntax-highlighting code, and each page is its own lazily loaded chunk that the Worker renders per request inside the public site's shared header and footer.
3. A page has its title as its one top-level heading (the header's wordmark is not a heading on a documentation page), a section menu, an on-this-page list, previous and next links, tables in labeled scrollable regions and an Edit-on-GitHub link.
4. Every Markdown file at the repository root and under `docs/` is either published or listed in the manifest as GitHub-only with a reason, and an unlisted file, a broken link or anchor, raw HTML, an image outside `docs/media/` or an absolute build-machine path fails verification or the build.
5. The documentation is served by `GET` only, reads no booking, invitee, host-profile or operator record or session.
6. An unknown, miscased or nested slug answers the existing `404` page, and the documented route shares the public admission budget of the other sessionless public paths.

### Public booking surfaces

#### PUBLIC-001 — Event presentation

**Requirement.** A published event page names the host and the event and shows its description, duration, public location label, the invitee's selected timezone, a day selector with each invitee-zone date shown once, up to five suggested times first for the selected day, each chosen by the native ranking of `AVAIL-007` and showing its reason, and every valid slot in the displayed week reachable by selecting its day.

**Acceptance.**
1. A published event page names the host and the event and shows its description, duration, public location label, the invitee's selected timezone, a day selector with each invitee-zone date shown once, up to five suggested times first for the selected day, each chosen by the native ranking of `AVAIL-007` and showing its reason, and every valid slot in the displayed week reachable by selecting its day.
2. Only the selected day's times are listed; the initial selection is the first day with a valid slot.
3. Week-by-week navigation is bounded by today and the booking horizon.
4. The page also shows the change window the `booking.reschedule.v1` and `booking.cancellation.v1` policies enforce, and, when the event type enables it, the alternative-request path.

#### PUBLIC-002 — Invitee-first flow

**Requirement.** An invitee views availability and completes a booking without an account and without signing in.

**Acceptance.**
1. An invitee views availability and completes a booking without an account and without signing in.
2. Before confirmation the flow asks only for the event type's configured questions, names who receives the answers — the host and, when connected, the calendar provider — and links the privacy notice URL configured for the deployment.

#### PUBLIC-003 — Progress and recovery

**Requirement.** The public flow has distinct choose-time, details, and confirmation states, each at its own URL, and reloading or navigating back preserves a still-valid selection.

**Acceptance.**
1. The public flow has distinct choose-time, details, and confirmation states, each at its own URL, and reloading or navigating back preserves a still-valid selection.
2. The selection and its nonce are carried in the URL and in the browser's session storage; the public flow sets no cookie.
3. An expired nonce, or an expired or rotated manage token, returns 410; an unknown or mismatched one returns 404.
4. Both render a page that offers a fresh start and that contains no booking, invitee, or sample data.

#### PUBLIC-004 — Embed

**Requirement.** Operators copy an asynchronous script tag naming a public event slug and `inline` or `modal` mode.

**Acceptance.**
1. Operators copy an asynchronous script tag naming a public event slug and `inline` or `modal` mode.
2. Inline mode renders where the tag sits; modal mode opens only from an element whose `data-dial-embed` attribute names that embed.
3. The initial script is under 50KB gzipped, and the embedded flow offers the same booking, reschedule, and cancel actions as the standalone page.

#### PUBLIC-005 — Unavailable pages

**Requirement.** An unknown, draft, disabled, deleted, or renamed profile or event URL returns 404 and reveals nothing about whether a record ever existed there.

**Acceptance.**
1. An unknown, draft, disabled, deleted, or renamed profile or event URL returns 404 and reveals nothing about whether a record ever existed there.
2. This governs profile and event URLs only; manage-token responses are governed by `PUBLIC-003`, where a rotated or expired token deliberately returns 410 so the invitee knows to ask for a new link.
3. A published event type with no valid slot inside its horizon still returns 200, says so, and offers the alternative-request path when the event type enables it.

#### PUBLIC-006 — Abuse

**Requirement.** A public request refused by the rate limits of `BASE-ACCESS-003` returns 429 and the flow keeps the invitee's selection and answers so the same person can retry without re-entering them.

**Acceptance.**
1. A public request refused by the rate limits of `BASE-ACCESS-003` returns 429 and the flow keeps the invitee's selection and answers so the same person can retry without re-entering them.
2. Owners and admins can block an email address or a domain for the whole workspace, and each entry records who added it and when; team managers, members and viewers cannot add or remove an entry (403 `role_forbidden`, no change, `OPER-001`); a submission from a blocked address is refused with a message that does not say it was blocked, and creates no booking, request, notification, or calendar event.
3. The block list shows each entry's author ("a removed operator" once that operator's identity is erased under `OPER-002`) and the time it was added, in the host's zone.

### Availability

#### AVAIL-001 — Schedule and overrides

**Requirement.** Recurring availability is a set of wall-clock windows per weekday in the host's IANA timezone.

**Acceptance.**
1. Recurring availability is a set of wall-clock windows per weekday in the host's IANA timezone.
2. A date override replaces the recurring windows for one host date and may open or close that whole date.
3. Editing a schedule or an override changes future availability only; it never alters a confirmed booking.

#### AVAIL-002 — Valid slots

**Requirement.** A slot is offered only when every one of these holds: its start falls on the event type's start increment measured from the start of its open window; the full duration fits inside that one window; the start is within the booking horizon and beyond the minimum notice; its host day is under the event type's booking limit; and it overlaps no booking in the `confirmed` state for this host on any event type and no busy interval from any selected conflict calendar, an external event the provider marks free being ignored.

**Acceptance.**
1. A slot is offered only when every one of these holds: its start falls on the event type's start increment measured from the start of its open window; the full duration fits inside that one window; the start is within the booking horizon and beyond the minimum notice; its host day is under the event type's booking limit; and it overlaps no booking in the `confirmed` state for this host on any event type and no busy interval from any selected conflict calendar, an external event the provider marks free being ignored.
2. Dial's own managed event, read back from a conflict calendar where Dial last confirmed writing it, is the booking it represents rather than an external busy interval, so a canceled or moved booking releases its old time under `BOOK-007` and `BOOK-008` without waiting for the provider or its cached busy data.
3. Anything else is not offered.

#### AVAIL-003 — Buffers

**Requirement.** The event type's before and after buffers extend the interval that must be free around a candidate slot, over both confirmed Dial bookings and external busy intervals.

**Acceptance.**
1. The event type's before and after buffers extend the interval that must be free around a candidate slot, over both confirmed Dial bookings and external busy intervals.
2. A buffer never changes the invitee's start or end time, the duration shown anywhere, or the times on the calendar event and invitation.

#### AVAIL-004 — Freshness and failure

**Requirement.** Availability is recomputed when the event page or a week loads.

**Acceptance.**
1. Availability is recomputed when the event page or a week loads.
2. Changing the invitee's timezone re-renders and re-ranks the same slots and needs no new calendar read, because slot validity does not depend on the invitee's zone.
3. A displayed slot may rest on cached provider busy data no more than 5 minutes old; the final check in `BOOK-001` uses provider data no more than 60 seconds old.
4. With no connected calendar, saved schedule rules and persisted Dial bookings are authoritative and no provider read occurs.
5. This does not relax checks on an unhealthy, incomplete or revoked connection.
6. Every selected conflict calendar is required, and a provider read that does not complete within 5 seconds counts as unreadable.
7. If a required calendar is unreadable at either point, Dial offers and confirms no slot for that host and tells the invitee that booking is temporarily unavailable, rather than offering unverified time.

#### AVAIL-005 — Timezones

**Requirement.** Every invitee-facing time is rendered in the invitee's selected timezone, which starts as the browser's IANA zone when the browser reports one and as the host's zone when it does not.

**Acceptance.**
1. Every invitee-facing time is rendered in the invitee's selected timezone, which starts as the browser's IANA zone when the browser reports one and as the host's zone when it does not.
2. The zone is resolved in the browser and slot instants are fetched in UTC, so no visitor-derived value reaches the server on page load, as `BASE-PUBLIC-001` requires: the invitee's zone is sent only with a request their own action causes — changing the zone, moving week, or selecting a slot.
3. The invitee can change the zone at any point before confirmation.
4. The selected-day group names the invitee's zone once, and every selectable time carries its UTC offset so repeated wall-clock times remain distinct.
5. Other invitee-facing times carry their zone name and UTC offset.
6. In the selected-day picker, host time is shown only when the host's zone differs from the invitee's, including the host date when the local dates differ.
7. The details and confirmation surfaces also show the host's local time, including when the zones match, preserving the receipt's both-zone requirement in `BOOK-005`.
8. A confirmed booking stores the UTC instant and both the host's and the invitee's IANA zone identifiers.

#### AVAIL-006 — Daylight saving time

**Requirement.** A local time that does not exist during a forward transition is never offered.

**Acceptance.**
1. A local time that does not exist during a forward transition is never offered.
2. Repeated wall-clock times during a backward transition are shown with distinct UTC offsets, so each offered time maps to exactly one instant.
3. A DST transition between confirmation and the meeting never moves a booking's stored UTC instant, and the host and invitee renderings each follow their own zone's rules.

#### AVAIL-007 — Recommendations and filters

**Requirement.** At most 5 recommended times are shown, each a slot already valid under `AVAIL-002` and each showing the reason it was chosen.

**Acceptance.**
1. At most 5 recommended times are shown, each a slot already valid under `AVAIL-002` and each showing the reason it was chosen.
2. The ordering is deterministic: the same inputs always produce the same order.
3. The browser ranks the verified offers in both the host's and invitee's selected zones from the first display.
4. It uses a free-time ordering supplied with the offers, without sending the device zone on page load or disclosing private occupancy intervals; action-triggered server reads use the selected zone under `AVAIL-005`.
5. An invitee-facing filter only narrows or reorders slots already valid under `AVAIL-002` and can never surface one that is not.
6. The product setting starts with slots fully inside 09:00–17:00 in both the host's and the invitee's selected zone first, then the larger sum of contiguous free minutes immediately before and after the slot, then the earlier UTC start.

#### AVAIL-008 — Response time

**Requirement.** Loading one week of availability for one event type returns within 2 seconds, for an event type of any kind, including a round-robin event type pooling 25 hosts and a collective event type of 10 hosts, on a single-host install and on a workspace at the `OPER-007` capacity alike.

**Acceptance.**
1. Loading one week of availability for one event type returns within 2 seconds, for an event type of any kind, including a round-robin event type pooling 25 hosts and a collective event type of 10 hosts, on a single-host install and on a workspace at the `OPER-007` capacity alike.

#### AVAIL-009 — Operator diagnostics

**Requirement.** For any time an operator evaluates, Dial names which rule excluded it — schedule, date override, start increment, minimum notice, horizon, buffer, host-day limit, an existing Dial booking, or a conflict-calendar busy interval — without disclosing external event detail that `CAL-002` does not retain.

**Acceptance.**
1. For any time an operator evaluates, Dial names which rule excluded it — schedule, date override, start increment, minimum notice, horizon, buffer, host-day limit, an existing Dial booking, or a conflict-calendar busy interval — without disclosing external event detail that `CAL-002` does not retain.

### Booking lifecycle

#### BOOK-001 — Final validation

**Requirement.** Confirming a booking revalidates every answer against the event type's current questions and rechecks the selected slot under `AVAIL-002` against persisted Dial bookings and, when connected, a fresh conflict-calendar read.

**Acceptance.**
1. Confirming a booking revalidates every answer against the event type's current questions and rechecks the selected slot under `AVAIL-002` against persisted Dial bookings and, when connected, a fresh conflict-calendar read.
2. Any failure creates no booking, no calendar event, and no email, and names the reason: an invalid or missing answer returns 400, and a slot that is no longer valid returns 409.

#### BOOK-002 — Atomic claim

**Requirement.** Every slot admits at most one booking in the `confirmed` state.

**Acceptance.**
1. Every slot admits at most one booking in the `confirmed` state.
2. Claiming the slot and recording its applicable calendar, meeting, and notification commands happen in one transaction that either commits entirely or leaves nothing behind.
3. Of any number of concurrent confirmations for the same slot exactly one commits; every other returns 409 with a `slot_taken` code and is returned to the choose-time step with availability recomputed.

#### BOOK-003 — Idempotent confirmation

**Requirement.** Replaying a confirmation with an already-consumed nonce and an identical payload returns the stored result of the original booking and creates no second booking, calendar event, meeting link, or email.

**Acceptance.**
1. Replaying a confirmation with an already-consumed nonce and an identical payload returns the stored result of the original booking and creates no second booking, calendar event, meeting link, or email.
2. Replaying it with a different payload returns 409 and creates nothing.

#### BOOK-004 — States and occurrences

**Requirement.** A booking is confirmed, canceled, or rescheduled, and has one or more occurrences of which exactly one is current: a reschedule closes the current occurrence and opens a new one under the same booking ID and iCalendar UID.

**Acceptance.**
1. A booking is confirmed, canceled, or rescheduled, and has one or more occurrences of which exactly one is current: a reschedule closes the current occurrence and opens a new one under the same booking ID and iCalendar UID.
2. The calendar event, the meeting link, and each email carry their own pending, succeeded, or failed state; none of them changes the booking's state, and no external failure silently cancels or moves a booking.

#### BOOK-005 — Confirmation receipt

**Requirement.** Unless the event type or routing route redirects the invitee under `BOOK-013`, within 2 seconds of a successful claim the invitee is shown the event, the start and end in their own zone and in the host's, the duration, the host, the location or its pending state, the calendar file of `CAL-009`, and the manage link of `BOOK-006`.

**Acceptance.**
1. Unless the event type or routing route redirects the invitee under `BOOK-013`, within 2 seconds of a successful claim the invitee is shown the event, the start and end in their own zone and in the host's, the duration, the host, the location or its pending state, the calendar file of `CAL-009`, and the manage link of `BOOK-006`.
2. The join control is enabled only when a provisioned joining URL is stored on the booking; while `CAL-003` is still pending it is disabled and labeled as pending.

#### BOOK-006 — Manage link

**Requirement.** Every confirmed booking has a manage link whose token carries at least 256 bits from a cryptographically secure random source and grants view and change access to that one booking, without creating an invitee account.

**Acceptance.**
1. Every confirmed booking has a manage link whose token carries at least 256 bits from a cryptographically secure random source and grants view and change access to that one booking, without creating an invitee account.
2. The token is transmitted only to the invitee, in their own email and on their confirmation page; operator surfaces show the booking but never the token, offering an action that copies or resends the link instead.
3. A reschedule keeps the token, which always resolves to the booking's current occurrence.
4. The token expires 90 days after the booking's start instant, and an operator can rotate it, which invalidates the previous token immediately.
5. A request with an expired, rotated, or unknown token answers per `PUBLIC-003` and discloses no booking data.

#### BOOK-007 — Invitee rescheduling

**Requirement.** The holder of a booking's manage link can move it to another slot on the same event type.

**Acceptance.**
1. The holder of a booking's manage link can move it to another slot on the same event type.
2. The new slot is validated under `BOOK-001` with only this booking's own occurrence excluded from internal conflicts, then claimed under `BOOK-002` before the old slot is released; if any step fails, the original booking is unchanged and still confirmed.
3. The product setting starts with any number of reschedules, allowed until the booking's start.

#### BOOK-008 — Invitee cancellation

**Requirement.** The holder of a booking's manage link can cancel it with an optional reason.

**Acceptance.**
1. The holder of a booking's manage link can cancel it with an optional reason.
2. Cancellation cannot be reversed, releases the slot and its buffers within 5 seconds and before the next availability computation, and repeating it returns the same result without sending a second notification.
3. The product setting starts with allowed until the booking's start.

#### BOOK-009 — Operator changes

**Requirement.** A person who may act on the booking under `OPER-001` (its host, a person the host delegated to under `TEAM-007`, a manager of a team the booking's event type or host belongs to, and owners and admins for every booking) can reschedule or cancel any confirmed booking under `BOOK-002`, `BOOK-007`, `BOOK-008`, `BOOK-010`, `CAL-003`, and `NOTIFY-004`.

**Acceptance.**
1. A person who may act on the booking under `OPER-001` (its host, a person the host delegated to under `TEAM-007`, a manager of a team the booking's event type or host belongs to, and owners and admins for every booking) can reschedule or cancel any confirmed booking under `BOOK-002`, `BOOK-007`, `BOOK-008`, `BOOK-010`, `CAL-003`, and `NOTIFY-004`.
2. The reschedule and cancellation policies constrain invitees only: an operator may also act on a booking that has already started, and may reschedule onto a time outside published availability after confirming that override explicitly, but never onto a time that overlaps another confirmed booking.
3. An imported booking that a catch-up lists as canceled at the source may instead be released under `DATA-003`, `DATA-015`.
4. Instead of choosing the new time, the operator can ask the invitee to pick one under `BOOK-014`.
5. A reschedule keeps the booking's host; handing a booking to another host is a reassignment under `TEAM-007`.
6. A member acting on another host's booking without that delegation, and any viewer, gets 403 `role_forbidden` with the booking, calendar event and mail unchanged.

#### BOOK-010 — History

**Requirement.** Rescheduling records the original occurrence as rescheduled and links it to its replacement.

**Acceptance.**
1. Rescheduling records the original occurrence as rescheduled and links it to its replacement.
2. Every creation, cancellation, and reschedule records who acted — the manage-link holder, the named operator, or the calendar provider under `CAL-008` — the time, the previous and new start, and any reason given.

#### BOOK-011 — Attendance

**Requirement.** After a booking has ended, a person who may act on it under `OPER-001` (its host, a delegate under `TEAM-007`, a manager of its team, or an owner or admin) can mark it attended or a no-show and add a note.

**Acceptance.**
1. After a booking has ended, a person who may act on it under `OPER-001` (its host, a delegate under `TEAM-007`, a manager of its team, or an owner or admin) can mark it attended or a no-show and add a note.
2. The mark records the operator and the time, appears in the booking record and the export, changes no lifecycle state and no calendar event, and sends the invitee nothing.
3. Another member and any viewer get 403 `role_forbidden` with no mark recorded.

#### BOOK-012 — Operator-created booking

**Requirement.** A person can create a booking for a host they may act for under `OPER-001` (a member for themselves and for hosts who delegated to them under `TEAM-007`, a team manager for their teams' members and event types, owners and admins for any host), for an invitee whose name and email address they enter, on any slot valid under `AVAIL-002`, optionally overriding the minimum notice and the horizon but never the conflict and buffer checks.

**Acceptance.**
1. A person can create a booking for a host they may act for under `OPER-001` (a member for themselves and for hosts who delegated to them under `TEAM-007`, a team manager for their teams' members and event types, owners and admins for any host), for an invitee whose name and email address they enter, on any slot valid under `AVAIL-002`, optionally overriding the minimum notice and the horizon but never the conflict and buffer checks.
2. The invitee then receives the ordinary `NOTIFY-001` confirmation and manage link, and `BOOK-010` records the operator as the actor.
3. A member creating a booking for another host, and any viewer, gets 403 `role_forbidden` and no booking, mail or calendar event is created.

### Calendars and meetings

#### CAL-001 — Calendar connections

**Requirement.** Each host connects one or more calendar accounts through OAuth under `AUTH-004`: Google Calendar (`CAL-001` to `CAL-009`), Microsoft 365 and Outlook.com (`CAL-010`) and iCloud or another CalDAV server (`CAL-011`), up to the account and calendar counts in the documented capacity limits.

**Acceptance.**
1. Each host connects one or more calendar accounts through OAuth under `AUTH-004`: Google Calendar (`CAL-001` to `CAL-009`), Microsoft 365 and Outlook.com (`CAL-010`) and iCloud or another CalDAV server (`CAL-011`), up to the account and calendar counts in the documented capacity limits.
2. Across all of a host's accounts they select the calendars whose busy intervals block availability (`limits.maxConflictCalendars`) and exactly one calendar to receive Dial's bookings.
3. A connection belongs to its host; reconnecting replaces it and keeps the selections, and the host or an admin can disconnect.
4. Calendar connection is optional for fixed locations.
5. After an explicit disconnect, sync stops and the connection shows as disconnected.
6. Fixed-location published event types keep offering times from saved availability minus existing bookings; provider-conference events offer no slots until their provider is restored.
7. Existing managed bookings retain their calendar obligation and cannot be rescheduled while disconnected; their history is unchanged.
8. Each provider is implemented behind `calendar.provider.v2`.

#### CAL-002 — Busy privacy

**Requirement.** A calendar read retains only the identifiers, time bounds, transparency, and deletion state needed for conflict detection and sync.

**Acceptance.**
1. A calendar read retains only the identifiers, time bounds, transparency, and deletion state needed for conflict detection and sync.
2. Titles, descriptions, attendees, and locations from conflict calendars are never stored, and so are never shown to an invitee or to an operator.

#### CAL-003 — Managed event

**Requirement.** A booking made without a connected calendar durably records calendar delivery as not required, schedules no calendar commands on creation, reschedule, cancellation or erasure, and never claims provider success.

**Acceptance.**
1. A booking made without a connected calendar durably records calendar delivery as not required, schedules no calendar commands on creation, reschedule, cancellation or erasure, and never claims provider success.
2. Its receipt, mail and `.ics` remain available.
3. Connecting later does not retroactively enqueue these bookings; a later reschedule checked against that connection can create its managed event.
4. For a claim using a connected calendar, within 60 seconds the destination calendar holds one event for the booking carrying the title and description rendered from the event type's invitation templates (`NOTIFY-009`), the booking's start and end with explicit timezone data, a stable iCalendar UID, the configured location or a Google Meet conference provisioned for this booking, and the invitee as an attendee so the provider's own invitation and updates also reach them — or the booking's calendar state is pending and `CAL-005` applies.
5. An unsuccessful or ambiguous result is handled under `CAL-004` and `CAL-005`.

#### CAL-004 — Idempotent side effects

**Requirement.** Every calendar and meeting command carries the booking and occurrence IDs as its provider idempotency key.

**Acceptance.**
1. Every calendar and meeting command carries the booking and occurrence IDs as its provider idempotency key.
2. After a timeout, a lost response, or any other ambiguous result, the next attempt looks the object up by that key and updates it instead of creating a second one.

#### CAL-005 — Provider failure

**Requirement.** A transient calendar or meeting failure is retried up to 5 times over 1 hour.

**Acceptance.**
1. A transient calendar or meeting failure is retried up to 5 times over 1 hour.
2. The booking stays confirmed, and raw provider errors are neither persisted nor rendered.

#### CAL-006 — Connection health

**Requirement.** Revoked credentials, a refused token refresh, an invalid sync cursor, a push channel that cannot be renewed, or exhausted provider quota puts the connection in an unhealthy state that operators see in settings by name and that raises `calendar.connection-health-changed.v1` as a durable transition fact (from state, to state, named reason and time), shown in Settings and preserved by owner archive export and restore.

**Acceptance.**
1. Revoked credentials, a refused token refresh, an invalid sync cursor, a push channel that cannot be renewed, or exhausted provider quota puts the connection in an unhealthy state that operators see in settings by name and that raises `calendar.connection-health-changed.v1` as a durable transition fact (from state, to state, named reason and time), shown in Settings and preserved by owner archive export and restore.
2. OAuth connect/disconnect and healthy recovery record their transitions too; subscriber and webhook dispatch belong to `API-002`.
3. An invalid cursor or a lapsed channel triggers a full resync before the next availability computation.
4. While a required conflict or destination calendar is unreadable, public booking fails closed under `AVAIL-004` and no event type can be published under `EVENT-006`.

#### CAL-007 — Provider callbacks

**Requirement.** Calendar push channels are renewed before they expire.

**Acceptance.**
1. Calendar push channels are renewed before they expire.
2. A callback authenticated under `AUTH-005` is processed independently of arrival order: duplicate or out-of-order delivery cannot duplicate a booking change or undo a newer one, and a callback describing a state older than the one held is discarded.

#### CAL-008 — External deletion and edits

**Requirement.** Deleting Dial's managed event in the destination calendar cancels the booking exactly once and sends the ordinary cancellation notices of `NOTIFY-004`.

**Acceptance.**
1. Deleting Dial's managed event in the destination calendar cancels the booking exactly once and sends the ordinary cancellation notices of `NOTIFY-004`.
2. Any other external edit to the event's time or location is recorded as a sync conflict on the booking showing both times; the operator resolves it by restoring the managed event to the canonical time or by canceling under `BOOK-009`, and Dial never adopts such an edit by itself.
3. The product setting starts with deletion cancels the booking.

#### CAL-009 — Calendar file

**Requirement.** The confirmation and manage pages offer an `.ics` download for the booking carrying its stable UID and current occurrence.

**Acceptance.**
1. The confirmation and manage pages offer an `.ics` download for the booking carrying its stable UID and current occurrence.
2. A reschedule increments that file's sequence and a cancellation marks the occurrence canceled, so an invitee's calendar updates the same entry rather than gaining an unrelated one.
3. The download makes no request to any provider not declared in `seed.json → externals`.

### Alternative availability requests

#### REQUEST-001 — Compose

**Requirement.** Where an event type enables it, an invitee can select future dates and time windows within the counts in the documented capacity limits, whose starts precede their ends and which do not overlap each other, together with their IANA timezone, a name, an email address, and an optional note of at most 500 characters, and can review the exact request before submitting.

**Acceptance.**
1. Where an event type enables it, an invitee can select future dates and time windows within the counts in the documented capacity limits, whose starts precede their ends and which do not overlap each other, together with their IANA timezone, a name, an email address, and an optional note of at most 500 characters, and can review the exact request before submitting.
2. A request that omits a date, a window, a name, or a valid email address, or that contains an overlapping or reversed window, is rejected with the offending field named and stores nothing.

#### REQUEST-002 — Submit

**Requirement.** A valid request is recorded once, acknowledged to the invitee on screen, and notified to operators within 60 seconds.

**Acceptance.**
1. A valid request is recorded once, acknowledged to the invitee on screen, and notified to operators within 60 seconds.
2. The acknowledgment states the response expectation the operator configured, or, where none is configured, only that the host will follow up by email.
3. Replaying the same nonce returns the existing request.
4. A request reserves no time and creates no booking.

#### REQUEST-003 — Operator workflow

**Requirement.** A request's host, a person the host delegated to under `TEAM-007`, managers of the host's teams, and owners and admins (`OPER-001`) can list requests by submitted, handled, or closed state, open the invitee's windows rendered in both the invitee's and the host's zone, mark one handled or closed, and create a booking for an agreed time.

**Acceptance.**
1. A request's host, a person the host delegated to under `TEAM-007`, managers of the host's teams, and owners and admins (`OPER-001`) can list requests by submitted, handled, or closed state, open the invitee's windows rendered in both the invitee's and the host's zone, mark one handled or closed, and create a booking for an agreed time.
2. That booking runs the ordinary `BOOK-012` path and marks the request handled.
3. A member's list holds only their own and delegated hosts' requests, and their open, mark or booking of another host's request returns 403 `role_forbidden` with no change; a viewer reads requests and changes none.

#### REQUEST-004 — Routing

**Requirement.** A new request notifies the host recipients of the event type it was made on under `NOTIFY-008` — its host, or for a team event that team's hosts — unless the routing policy selects a subset of them or suppresses email; suppressing email never suppresses the in-app record, and no request is mailed to a person who cannot read it under `OPER-001`.

**Acceptance.**
1. A new request notifies the host recipients of the event type it was made on under `NOTIFY-008` — its host, or for a team event that team's hosts — unless the routing policy selects a subset of them or suppresses email; suppressing email never suppresses the in-app record, and no request is mailed to a person who cannot read it under `OPER-001`.
2. The policy is set per event type with its email settings: every host recipient (the default), selected people, or no email.
3. A selection names at least one person who currently has access; the policy applies when a request is created, so a later change neither resends nor withdraws earlier notices, and a selected person who has lost access by then is skipped.
4. Routing governs the host notices only: the invitee's acknowledgment and the request in Requests are the same under every policy.
5. The product setting starts with the event type's host recipients, which in a single-host install is every operator.

#### REQUEST-005 — Invitee updates

**Requirement.** Submitting sends the invitee one acknowledgment email restating the requested windows in their own zone.

**Acceptance.**
1. Submitting sends the invitee one acknowledgment email restating the requested windows in their own zone.
2. Marking a request handled or closed sends the invitee exactly one further email; the closed one says the host cannot offer a time, and neither is sent twice however often the state is set again.

### Notifications and workflows

#### NOTIFY-001 — Booking confirmation

**Requirement.** Within 60 seconds of confirmation Dial emails, through `mail.sender.v1`, the invitee and the booking's host recipients under `NOTIFY-008`: the event, the time in each recipient's relevant zone, the duration, the answers, and, for hosts, the current calendar state.

**Acceptance.**
1. Within 60 seconds of confirmation Dial emails, through `mail.sender.v1`, the invitee and the booking's host recipients under `NOTIFY-008`: the event, the time in each recipient's relevant zone, the duration, the answers, and, for hosts, the current calendar state.
2. Invitee mail omits host calendar setup details while naming a pending or unavailable joining link.
3. The invitee's copy also carries their manage link and the `.ics` file of `CAL-009`, attached for direct providers and available through the private Add to calendar download link for RER Managed mail; no host copy contains the manage token.
4. Where the meeting link is still pending the email says so instead of inventing one.
5. The invitee's subject and body follow the event type's confirmation template (`NOTIFY-009`), which replaces the built-in text rather than adding a second message.
6. A host recipient can mute booking mail — confirmations, changes, and reminders — for themselves in settings.
7. The invitee's copy is sent unless the host turns it off for an event type whose managed calendar event invites the invitee (`CAL-003`, `CAL-010`, `CAL-011`); the provider's invitation, carrying the invitation manage link of `NOTIFY-013`, is then the invitee's confirmation, and a booking whose calendar delivery is not required or fails still sends Dial's confirmation, so no invitee is left without one.

#### NOTIFY-002 — Link completion

**Requirement.** When a pending joining link becomes available Dial updates the managed calendar event and sends the invitee exactly one link-ready email, however many times the completion job runs.

**Acceptance.**
1. When a pending joining link becomes available Dial updates the managed calendar event and sends the invitee exactly one link-ready email, however many times the completion job runs.

#### NOTIFY-003 — Reminders

**Requirement.** A confirmed future booking schedules reminders for the invitee and the booking's host recipients under `NOTIFY-008`, carrying the event, the time in the recipient's zone, the location or join link, and, for the invitee, the manage link.

**Acceptance.**
1. A confirmed future booking schedules reminders for the invitee and the booking's host recipients under `NOTIFY-008`, carrying the event, the time in the recipient's zone, the location or join link, and, for the invitee, the manage link.
2. A reminder is sent within 5 minutes of its scheduled offset.
3. Rescheduling replaces the scheduled times and cancellation removes them, so no reminder is ever sent for a time the booking no longer holds.
4. The product setting starts with 24 hours and 1 hour before the start, scheduling only the offsets still in the future at confirmation or reschedule.

#### NOTIFY-004 — Changes

**Requirement.** A reschedule or a cancellation sends the invitee and the booking's host recipients under `NOTIFY-008` exactly one email naming who made the change, the previous time, the new time or the cancellation reason, and, for hosts, the current calendar state.

**Acceptance.**
1. A reschedule or a cancellation sends the invitee and the booking's host recipients under `NOTIFY-008` exactly one email naming who made the change, the previous time, the new time or the cancellation reason, and, for hosts, the current calendar state.
2. Invitees receive relevant joining-link status without host calendar setup details.
3. The one stated exception is `DATA-003`'s release of an imported booking that the source scheduler already canceled: the source has told the invitee, so the release sends no email; the ordinary operator cancellation beside it still sends exactly one.

#### NOTIFY-005 — Delivery failure

**Requirement.** A transient email failure is retried up to 5 times over 1 hour.

**Acceptance.**
1. A transient email failure is retried up to 5 times over 1 hour.
2. A permanent failure or a bounce is marked failed on the booking or request with a typed sanitised reason and safe remediation, and can be resent without duplicating a delivery that already succeeded.
3. Raw provider errors are neither persisted nor rendered.

#### NOTIFY-006 — No mail loops

**Requirement.** Product mail is sent from the configured verified sender, any address on a verified domain.

**Acceptance.**
1. Product mail is sent from the configured verified sender, any address on a verified domain.
2. Dial never reads mail delivered to that address, so a reply never creates a booking, a request, or a notification.
3. The sender address is never an email's `Reply-To`: replies go where `NOTIFY-010` sends them, and only an event type set to No-reply sends invitee mail without a `Reply-To`, its body stating that replies are not received.

#### NOTIFY-007 — Connection alerts

**Requirement.** Within 60 seconds of the calendar connection becoming unhealthy under `CAL-006`, the connection's owning host and the workspace's owners and admins (in a single-host install, every operator) are each emailed once, naming the cause and the reconnect action, because public booking is failing closed meanwhile.

**Acceptance.**
1. Within 60 seconds of the calendar connection becoming unhealthy under `CAL-006`, the connection's owning host and the workspace's owners and admins (in a single-host install, every operator) are each emailed once, naming the cause and the reconnect action, because public booking is failing closed meanwhile.
2. This alert is operational and the mute of `NOTIFY-001` does not suppress it.
3. No further alert is sent for that connection until it has recovered, and recovery is announced the same way.

### Data and migration

#### DATA-001 — Archive contents and exclusions

**Requirement.** Supersedes `BASE-DATA-001` for credential and live-authority exclusions and documented canonicalization. `pnpm run export -- --output FILE` writes an owner-only archive outside tracked source; `pnpm run import -- --input FILE --yes` restores it only into a fully migrated empty install.

**Acceptance.**
1. Supersedes `BASE-DATA-001` for credential and live-authority exclusions and documented canonicalization. `pnpm run export -- --output FILE` writes an owner-only archive outside tracked source; `pnpm run import -- --input FILE --yes` restores it only into a fully migrated empty install.
2. The archive contains every durable operator, host profile, host booking-link copy report, event type, question, availability rule and override, calendar-connection metadata and sync state, booking and occurrence, invitee answer and custom-field value, attendance mark, alternative request, delivery attempt, setting, and audit entry as JSON, plus every uploaded asset with its original bytes and content type.
3. Unknown application tables fail closed.
4. No OAuth access/refresh credential, session, sign-in/invitation link, setup/webhook secret, callback authority, private manage capability, or frozen capability-bearing mail is exported.
5. Durable identities, consumed first-owner ownership, invitation cancellation guards and historical outcome records survive.

#### DATA-009 — Restore without live authority

**Requirement.** Imported active operators sign in through new magic links; first-owner setup cannot be claimed again.

**Acceptance.**
1. Imported active operators sign in through new magic links; first-owner setup cannot be claimed again.
2. Calendar health requires reauthorization under `CAL-006`, mail requires a fresh check, old private links remain invalid, and historical deliveries, deletion probes and cleanup targets cannot recreate provider effects.
3. Export/import/export yields an equivalent entire archive under the explicit idempotent canonicalization in OPERATIONS.md; timestamps, IDs and original asset bytes are not discarded.
4. Retain the source source authentication secret privately outside the archive when transferring authenticated retry/erasure hash guards.
5. Restore requires exclusive access to the empty destination; database and object storage are not jointly atomic; Base records owned object writes and commits D1 atomically, but an unsuccessful restore remains unpublished until recovered or repeated into a fresh empty install.
6. Queue messages and coordinator alarms are excluded execution authority; historical commands remain inert.
7. Remote restore is not exposed.
8. Legacy v2 archives are restored with their original revision before upgrading and re-exporting.

#### DATA-010 — Hosted archive capture

**Requirement.** Local transfer and native-owner authenticated hosted export are supported.

**Acceptance.**
1. Local transfer and native-owner authenticated hosted export are supported.
2. Hosted export drains and fences application requests, background work and coordinator activity while capturing database and files, refuses pending erasure, expires abandoned maintenance without allowing expired jobs to download, and retains exact schema and original-salt checks at local import.
3. Direct owner-account writes must remain quiesced.

#### DATA-002 — Email-wide personal erasure

**Requirement.** Deleting every booking and alternative request carrying an email address erases that person's invitee data from the deployment, including associated answers, notes, attendance, custom values, uploaded content and object metadata, private capabilities, local mail and reminders, provider facts, blocked identifiers, rate-limit identifiers, application logs and retained import copies.

**Acceptance.**
1. Deleting every booking and alternative request carrying an email address erases that person's invitee data from the deployment, including associated answers, notes, attendance, custom values, uploaded content and object metadata, private capabilities, local mail and reminders, provider facts, blocked identifiers, rate-limit identifiers, application logs and retained import copies.
2. Each record can still be erased from its detail page; its manage link stops working, its managed calendar event is canceled without sending the invitee a Dial email, and its audit survives with the invitee reference anonymized, as `BASE-DATA-003` requires.
3. The email flow makes that existing deployment-wide guarantee explicit: an owner or admin enters an email in Settings and receives a case-insensitive, write-free preview of matching bookings and requests.
4. One confirmation erases every match within the request and returns an anonymous receipt with counts, completion time and separate calendar cleanup state.
5. Success leaves no pending personal mail, reminders or import replay.
6. Native entity deletion and its import custody, anonymous audit and portability fence commit together; a failed multi-record request may have completed earlier entities, issues no completed aggregate receipt, closes new admission for that address and is explicitly resumable with a fresh preview.
7. Native calendar cleanup completes within five minutes when the maintained provider adapter answers; real provider failures remain visible. Unrelated people, host configuration and shared assets remain.
8. Email-wide erasure and per-record erasure from a detail page are for owners and admins only (`OPER-001`): a team manager, member or viewer sees no erasure entry in Settings or on a record, and their preview, confirmation or per-record erasure returns 403 `role_forbidden` with nothing previewed or erased; on a single-host install every operator is an owner, in the single-host case.

#### DATA-011 — Erasure fences across restore

**Requirement.** Old archives are refused by a destination retaining a trusted later erasure journal, including a journal carried by a post-erasure archive.

**Acceptance.**
1. Old archives are refused by a destination retaining a trusted later erasure journal, including a journal carried by a post-erasure archive.
2. An isolated old archive in a new empty store cannot know a future erasure.

#### DATA-012 — Operator and invitee identity overlap

**Requirement.** When the email also belongs to an operator, the same single confirmation erases all matching invitee records, including those of the acting or protected setup owner.

**Acceptance.**
1. When the email also belongs to an operator, the same single confirmation erases all matching invitee records, including those of the acting or protected setup owner.
2. The write-free preview and anonymous receipt explicitly report that the associated operator identity is retained; native accounts, sessions and sign-in authority remain usable.
3. Operator identity removal is a separate OPER-002 action with its self, setup and last-owner holds.
4. Invitee erasure never claims that a retained operator identity has been erased.

#### DATA-003 — Saved-file review and import

**Requirement.** Owners and admins preview saved scheduling responses without database writes, review per-kind losses and rejected overlaps at the preview upload instant (not file-selection time), download a schema-valid report, and acknowledge the reviewed fingerprint before a bounded, resumable import.

**Acceptance.**
1. Owners and admins preview saved scheduling responses without database writes, review per-kind losses and rejected overlaps at the preview upload instant (not file-selection time), download a schema-valid report, and acknowledge the reviewed fingerprint before a bounded, resumable import.
2. The first preview of each selected upload captures its instant; repeated previews and owner choices retain that instant until the files are selected anew.
3. Applying and resuming retain the exact reviewed instant.
4. A server-issued upload identity bound to the owner, native session and source supplies fresh cryptographic randomness per booking before review, without preview writes; it expires after 30 minutes and is invalidated by an ended application.
5. A new sign-in, including after archive restore, requires a fresh upload review; a runtime restart preserving the session does not.
6. The upload identity grants no authority without the native operator session.
7. Preview, apply, resume, catch-up, release, recorded decisions and undo are for owners and admins only (`OPER-001`): a team manager, member or viewer gets 403 `role_forbidden` with no preview, upload identity, job or change; on a single-host install every operator is an owner, in the single-host case.
8. The exact reviewed token hashes persist through apply and resume; a new application after undo receives new unsent capabilities.

#### DATA-013 — Imported booking provenance

**Requirement.** Imported event types remain drafts, and a missing supported private location has an actionable event-editor recovery while normal publication remains refused.

**Acceptance.**
1. Imported event types remain drafts, and a missing supported private location has an actionable event-editor recovery while normal publication remains refused.
2. Imported confirmed bookings retain their source location and answers, occupy their time across the host, are marked Imported, and create no mail, reminder, queue, calendar or meeting effects.
3. Their private manage capability is unsent.
4. Each imported creation records the authenticated importing operator, no previous start, and the imported start in native booking history.
5. As a narrow exception to BOOK-010's action time for this imported creation only, its history time is the immutable reviewed snapshot as-of instant, explicitly labeled as effective snapshot time rather than application wall-clock time.
6. The source creation time remains on the booking and original occurrence; the original provider creator is not inferred.
7. OPER-004 shows this history and its time semantics.
8. Later native cancellations and reschedules retain BOOK-010's actual action times; operator cancellation sends one ordinary NOTIFY-004 invitee email and leaves the source calendar entry alone.

#### DATA-014 — Conflict-preserving import undo

**Requirement.** Conflict-preserving undo retains edited records and required parents.

**Acceptance.**
1. Conflict-preserving undo retains edited records and required parents.
2. Identical source re-import is idempotent.
3. DATA-002 erasure removes retained personal copies and prevents replay, withdrawing affected original artifacts while preserving other normalized records.

#### DATA-015 — Incremental catch-up

**Requirement.** Catch-up (extension): after an import is applied, a newer capture of the same source account previews as a catch-up.

**Acceptance.**
1. Catch-up (extension): after an import is applied, a newer capture of the same source account previews as a catch-up.
2. Records already saved by an applied import are matched by source identity and left out of its plan, so they are never duplicated, overwritten or saved a second time, including any edited, published, rescheduled or canceled in Dial; the plan keeps only an extract of the records it reviews.
3. New event types and future single-invitee bookings get the same losses, overlap rejections and choices as a first import and apply under their own saved job, resume and undo, with new unsent capabilities and no side effects; undo removes only what that catch-up added.
4. A capture of a different source account, a capture taken while another import is unfinished, and records kept by a retained undo are refused with a plain message and no writes.

#### DATA-016 — Source differences and release

**Requirement.** The preview compares every still-future imported booking with the capture and lists one difference each: unchanged, moved at source (both times shown, including a source reschedule that cancels the old event for a rebooked invitee, which is not imported as a second booking), canceled at source, invitee changed, or no longer in the capture.

**Acceptance.**
1. The preview compares every still-future imported booking with the capture and lists one difference each: unchanged, moved at source (both times shown, including a source reschedule that cancels the old event for a rebooked invitee, which is not imported as a second booking), canceled at source, invitee changed, or no longer in the capture.
2. Nothing changes automatically.
3. For a booking canceled at source the operator may release this time: it cancels the Dial booking, frees its slot and buffers and records the operator and reason in history without emailing the invitee (the stated `NOTIFY-004` exception); the ordinary operator cancellation stays available beside it.
4. Any other difference is kept with one recorded decision, or handled through the ordinary cancel or reschedule.
5. Differences, capture times and old scheduling links are native rows: they appear in the schema-valid report (version 2; version 1 reports remain valid), survive reload and whole-install archive restore without restoring replay authority, and erasing a person removes their difference rows.

#### DATA-017 — Switch-over readiness

**Requirement.** Settings → Move in shows a switch-over checklist read from live data: each imported event type's old and Dial links with its status or exact publication reason and a downloadable list, the earliest day the source can be closed without stranding an invitee whose confirmation, manage link and reminders still belong to it, unresolved differences from the latest catch-up, the publication readiness of the destination calendar and sending address, and the date and age of the last capture.

**Acceptance.**
1. Settings → Move in shows a switch-over checklist read from live data: each imported event type's old and Dial links with its status or exact publication reason and a downloadable list, the earliest day the source can be closed without stranding an invitee whose confirmation, manage link and reminders still belong to it, unresolved differences from the latest catch-up, the publication readiness of the destination calendar and sending address, and the date and age of the last capture.
2. Dial never contacts or changes the source account.

### Internal custom fields

#### CUSTOM-001 — Operator annotations

**Requirement.** Owners and admins define, rename and delete the workspace's private field definitions for event types, bookings and availability requests in Settings (deleting one deletes its values under `CUSTOM-002`).

**Acceptance.**
1. Owners and admins define, rename and delete the workspace's private field definitions for event types, bookings and availability requests in Settings (deleting one deletes its values under `CUSTOM-002`).
2. A person edits values on a record they may act on under `OPER-001`, so a member edits values on their own event types, bookings and requests.
3. A team manager, member or viewer creating, changing or deleting a definition gets 403 `role_forbidden` with no change, and a viewer edits no value.
4. Supported types are text (500 characters), long text (5000 characters), single choice (1–50 unique choices, each at most 120 characters) and checkbox.
5. Labels contain 1–120 characters; definitions per entity type are bounded by `limits.maxCustomFieldsPerEntity`.
6. The private routes validate entity ownership, field/entity matching, type, choice and size before writing.
7. Booking annotations appear alongside invitee answers under OPER-004.
8. Definitions and values are stored in extension-owned sidecars, reached through declared, typed source registry contributions and detail slots.

#### CUSTOM-002 — Annotation privacy and portability

**Requirement.** Custom definitions and values require a current operator session.

**Acceptance.**
1. Custom definitions and values require a current operator session.
2. They are never added to public documents, public API projections, outgoing mail or build-time browser source.
3. Whole-install export and restore preserve definitions and values, including false checkboxes and multiline text; restore rejects invalid field types, references and choices before committing.
4. Deleting a definition deletes its values; erasing a booking or request deletes its annotation sidecar; event deletion removes its own annotations without removing booking annotations.
5. An additive upgrade preserves prior product data.

## Target clauses

### Authorization — target

#### AUTH-007 — Capabilities for new public surfaces

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-003, BASE-MAIL-001, BASE-PUBLIC-001, BASE-INSTALL-001

**Requirement.** Routing-form submissions, meeting-poll participation, single-use and one-off links, payment returns and workflow unsubscribe links each use their own capability: at least 256 bits from a cryptographically secure source, bound to the one record and action it names, single-use where the action is single-use, and expiring on a stated schedule. `ROUTE-001`, `POLL-001`, `PAY-001` and `FLOW-001` each state in their own text that their capability follows this clause.

**Acceptance.**
1. Routing-form submissions, meeting-poll participation, single-use and one-off links, payment returns and workflow unsubscribe links each use their own capability: at least 256 bits from a cryptographically secure source, bound to the one record and action it names, single-use where the action is single-use, and expiring on a stated schedule. `ROUTE-001`, `POLL-001`, `PAY-001` and `FLOW-001` each state in their own text that their capability follows this clause.
2. A poll link lets a participant see and change only their own votes; a single-use link stops offering times once consumed; a payment-return URL never confirms a booking by itself (`PAY-001`).
3. The NOTIFY-009 invitation capability is a domain-separated HMAC-SHA-256 of one booking id with the installation source authentication secret; it grants only replacement-link email to that booking’s stored invitee, expires 90 days after its current start, and is refused when canceled or erased.
4. Repeated requests within one minute acknowledge the existing request without a second rotation or email.
5. Unknown and expired capabilities answer per `PUBLIC-003`.

#### AUTH-008 — API credentials and connected apps

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-DATA-001, BASE-DATA-003, BASE-PUBLIC-001

**Requirement.** Workspace admins issue personal access tokens and register OAuth applications for the public API of `API-001`.

**Acceptance.**
1. Workspace admins issue personal access tokens and register OAuth applications for the public API of `API-001`.
2. Each credential carries named scopes (read bookings, write bookings, manage event types, manage routing, read reports, webhooks), a workspace and optionally one host or team, an expiry, a last-used time and revocation that takes effect on the next request.
3. Secrets are shown once and stored only as hashes.
4. Credentials never grant operator-session documents, export, erasure or role changes.
5. Credentials are checked at the `AUTH-001` boundary, and this clause's API test joins `AUTH-001`'s boundary tests before the API ships.

### Workspace, people and roles — target

#### OPER-006 — Editing a member's availability and event types

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** Owners and admins can switch to any member and edit, as that member's editor, everything that decides the member's offered times: their named schedules and weekly hours (`AVAIL-001`, `AVAIL-011`), date-specific hours and overrides, time off and US-holiday choices, which schedule each of the member's event types uses, copying hours from one schedule or event type to another, and the member's personal event types with every setting of `EVENT-001` to `EVENT-011` (durations, questions, locations, buffers, notice, horizon and limits).

**Acceptance.**
1. Owners and admins can switch to any member and edit, as that member's editor, everything that decides the member's offered times: their named schedules and weekly hours (`AVAIL-001`, `AVAIL-011`), date-specific hours and overrides, time off and US-holiday choices, which schedule each of the member's event types uses, copying hours from one schedule or event type to another, and the member's personal event types with every setting of `EVENT-001` to `EVENT-011` (durations, questions, locations, buffers, notice, horizon and limits).
2. Team managers have the same reach over the members of the teams they manage while the workspace setting "Team managers can edit their members' availability and event types" is on (on by default; owners and admins change it, and turning it off takes effect on the manager's next request); they never reach members outside their teams.
3. A member can also grant edit permission on one of their personal event types to named members, who may then edit that event type, including hours set on the event type itself, but not the member's named schedules or other event types.
4. The editor shows a banner naming the member being edited and a switcher to return to one's own settings.
5. Each edit takes effect on the member's public slots at once under `AVAIL-002`, writes one `ADMIN-002` entry naming the acting person, the member edited, the object and a before/after summary, and each schedule and event type shows the member "last changed by <name> at <time>".
6. Connecting or disconnecting calendars and conferencing accounts, and choosing which connected calendars are checked, stay with the member because the OAuth grant is theirs; the member's sign-in, security and bookings stay governed by `OPER-001`, `TEAM-007` and `BOOK-009`.

#### OPER-007 — Workspace capacity

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-AUDIT-001, BASE-MAIL-001, BASE-SIGNIN-001, BASE-INSTALL-001

**Requirement.** A workspace holds, at the least: 300 people across all roles of `OPER-001` (owners, admins, team managers, members and viewers, in any mix), every one of whom may be a host; 100 teams; 50 personal event types per host; and 5,000 event types in all, counting personal, team, collective, round-robin and managed (`TEAM-006`) event types, drafts and disabled ones.

**Acceptance.**
1. A workspace holds, at the least: 300 people across all roles of `OPER-001` (owners, admins, team managers, members and viewers, in any mix), every one of whom may be a host; 100 teams; 50 personal event types per host; and 5,000 event types in all, counting personal, team, collective, round-robin and managed (`TEAM-006`) event types, drafts and disabled ones.
2. These are floors stated here, not estimates: the documented capacity limits declares the values Dial enforces, each at least the floor above, and the booking volume below (`maxBookings` at least 1,000,000 and `maxBookingsPerMonth` at least 50,000), and an owner of a deployment may raise them for their own install after their own capacity run but never set them below the floor.
3. No other per-person or per-role cap exists, and adding a host or an event type within capacity takes effect at once with no seat purchase, license key or billing step.
4. Every path that adds a person or an event type checks capacity server-side in the same transaction that writes it: an invitation (`OPER-002`), a just-in-time SSO sign-in or SCIM provisioning (`ADMIN-001`), an API create (`API-001`), a move-in (`MIGRATE-001` to `MIGRATE-004`), event-type creation and duplication (`EVENT-001`) and a managed template publishing to members (`TEAM-006`).
5. A request that would pass a cap is refused with the typed reason `workspace_capacity_reached` carrying the limit's name (`people`, `teams`, `event_types_per_host` or `event_types_per_workspace`), its value and current use, and the operator sees a message naming that limit and its value; nothing is half-created — no identity, invitation, sign-in mail, team membership, event type, calendar entry or audit entry other than the refusal itself — and two concurrent adds for the last place admit exactly one.
6. Booking volume is not a cap that refuses invitees: Dial keeps accepting bookings, and the response-time bounds of `OPER-003`, `AVAIL-008` and `TEAM-003` hold for a workspace at the people and event-type capacity with 1,000,000 bookings retained and 50,000 created in a month.
7. Settings → Workspace → Capacity shows owners and admins each limit's value and current use, the host with the most personal event types, and bookings retained and created this month; each owner and admin is emailed once when a limit reaches 90% of its value, and again only after use falls below 90% and returns.

#### TEAM-001 — Hosts as independent schedulers

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-SIGNIN-001

**Requirement.** Each member is a host with their own profile, booking handle, IANA timezone, working-hours schedules, connected calendars, conferencing accounts, event types and bookings.

**Acceptance.**
1. Each member is a host with their own profile, booking handle, IANA timezone, working-hours schedules, connected calendars, conferencing accounts, event types and bookings.
2. A host's profile and profile timezone (`PROFILE-001`) are that host's own.
3. A host's availability is computed only from that host's schedules (including the named schedules, holidays and time off of `AVAIL-011`), calendars and confirmed bookings across every event type they host, including team events; a host's booking and meeting-time caps (`AVAIL-010`) likewise count every event type that host hosts, team events included.
4. Adding a host never changes another host's availability.
5. Owners and admins add hosts by invitation, by SSO just-in-time membership or SCIM (`ADMIN-001`), by move-in (`MIGRATE-001`) or through the API (`API-001`), up to the people capacity of `OPER-007` and with no seat purchase or billing step, and each added host can publish at once; a removed host's future bookings must be reassigned or canceled before removal completes.
6. When a second host exists, the scheduling report of `REPORT-001` lets an operator choose one host and every figure and drill-through counts only that host's bookings; this clause carries that step of `REPORT-001`.

#### TEAM-002 — Teams and team pages

*Tier:* Core · *Cites:* BASE-ROLE-001

**Requirement.** Admins create teams with members, managers, a team booking page at the documented route listing the team's published listed events, and team-scoped settings (branding, routing, workflows, reporting).

**Acceptance.**
1. Admins create teams with members, managers, a team booking page at the documented route listing the team's published listed events, and team-scoped settings (branding, routing, workflows, reporting).
2. A host may belong to several teams.
3. Team pages never expose members' private calendar detail.
4. Team-scoped reporting includes `REPORT-001`'s team choice: every figure and drill-through can be limited to one team's event types and members; this clause carries that step of `REPORT-001`.

#### ADMIN-001 — Single sign-on and provisioning

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-MAIL-001, BASE-SIGNIN-001 · *Register:* R-41

**Requirement.** Workspaces can require SAML 2.0 or OpenID Connect sign-in through Auth, Okta, Microsoft Entra ID, Google Workspace or JumpCloud, with just-in-time membership and SCIM 2.0 provisioning and deprovisioning of hosts and team membership.

**Acceptance.**
1. Workspaces can require SAML 2.0 or OpenID Connect sign-in through Auth, Okta, Microsoft Entra ID, Google Workspace or JumpCloud, with just-in-time membership and SCIM 2.0 provisioning and deprovisioning of hosts and team membership.
2. Deprovisioning revokes sessions and API credentials at once and starts the `TEAM-001` future-booking hold.
3. Provisioning stops at the people capacity of `OPER-007`: a SCIM the documented command, or a the documented setting re-activating a user, that would pass it returns an RFC 7644 error response with HTTP 403 whose `detail` names the `people` limit and its value, and a just-in-time sign-in that would pass it is refused with a page naming the limit and telling the person to ask an owner; neither creates an identity, host or team membership, and the identity provider's next retry succeeds once capacity is freed.
4. Email-link sign-in remains for workspaces that do not enforce SSO; the protected owner keeps a recovery path.

#### ADMIN-002 — Admin audit log

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-DATA-001, BASE-DATA-003, BASE-PUBLIC-001

**Requirement.** The scheduling audit’s action taxonomy includes: sign-ins, role changes, connection grants and revocations, event-type publication, routing and workflow changes, payment-setting changes, exports, erasures, agent actions under `AGENT-001`, and actions refused under `OPER-001`.

**Acceptance.**
1. The scheduling audit’s action taxonomy includes: sign-ins, role changes, connection grants and revocations, event-type publication, routing and workflow changes, payment-setting changes, exports, erasures, agent actions under `AGENT-001`, and actions refused under `OPER-001`.
2. Each entry records actor, time, action and an opaque subject reference; entries survive subject erasure with the subject anonymized.

### Profiles, event types and links — target

#### EVENT-007 — Group events and capacity

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002

**Requirement.** An event type may be a group event with a seat capacity of 2 to 1,000 per slot: each invitee books a seat with their own answers, manage link and reminders, the slot stays offered until full, and the host's calendar holds one event for the slot with attendees added as seats fill (or invitee names hidden when the operator chooses).

**Acceptance.**
1. An event type may be a group event with a seat capacity of 2 to 1,000 per slot: each invitee books a seat with their own answers, manage link and reminders, the slot stays offered until full, and the host's calendar holds one event for the slot with attendees added as seats fill (or invitee names hidden when the operator chooses).
2. Operators can show remaining seats, close a slot early, and keep an optional waitlist that offers a freed seat to the next person in order with a time limit to accept.
3. Canceling a seat releases one seat; canceling the slot notifies every seat holder once.
4. Studio memberships and class-pass operations belong to Strap; Dial's group events serve webinars, workshops, info sessions and group consultations.

#### EVENT-008 — Bookings that need host approval

*Tier:* Core · *Cites:* BASE-MAIL-001

**Requirement.** An event type may require host approval: the invitee's request holds the slot as tentative for a configurable window (default 24 hours), the host approves or declines from the booking record, mail or the mobile app, and only approval confirms the booking, creates the calendar event and conference and schedules reminders.

**Acceptance.**
1. An event type may require host approval: the invitee's request holds the slot as tentative for a configurable window (default 24 hours), the host approves or declines from the booking record, mail or the mobile app, and only approval confirms the booking, creates the calendar event and conference and schedules reminders.
2. A declined or expired request releases the slot and tells the invitee once.
3. Tentative holds block the slot for other invitees and appear on the host's destination calendar as tentative when the host opts in.
4. Approval requests and decisions go only to the invitee and the event type's host recipients (`NOTIFY-008`).
5. Priced and saved-card-fee approval follows PAY-007 under RL-2.

#### EVENT-009 — Invitee guests

*Tier:* Core · *Cites:* BASE-DATA-003, BASE-MAIL-001

**Requirement.** When an event type allows it, the invitee adds up to a configured number of guest email addresses.

**Acceptance.**
1. When an event type allows it, the invitee adds up to a configured number of guest email addresses.
2. Guests receive the calendar invitation and change notices but no manage link; the invitee can add or remove guests from their manage link.
3. Guest addresses are erased under `DATA-002` like invitee data.
4. Guests are the only recipients this adds to the booking recipients of `NOTIFY-008`.

#### EVENT-010 — Recurring bookings

*Tier:* Core

**Requirement.** An event type may let invitees book a recurring series (weekly, every two weeks or monthly for a set count up to 24 occurrences).

**Acceptance.**
1. An event type may let invitees book a recurring series (weekly, every two weeks or monthly for a set count up to 24 occurrences).
2. Every occurrence is validated under `AVAIL-002` at confirmation; the invitee sees which occurrences are unavailable and may book the available ones or pick alternates.
3. Each occurrence has its own state and can be rescheduled or canceled alone or with all following occurrences; the calendar holds one recurring event with exceptions, and reminders run per occurrence.

#### EVENT-011 — Invitee-selectable durations

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** An event type may offer up to four durations (for example 15, 30 and 60 minutes), one of them the default.

**Acceptance.**
1. An event type may offer up to four durations (for example 15, 30 and 60 minutes), one of them the default.
2. The public event page (`PUBLIC-001`) shows the options with the default selected; choosing another recomputes the offered slots under `AVAIL-002` for that duration — increment, notice, buffers, host-day limit and conflicts all applied to the chosen length — and keeps the selected day.
3. The chosen duration is stored on the booking and carried by the receipt, the managed calendar event and conference, the `.ics` file, every email and reminder, webhooks and reports.
4. A reschedule keeps the chosen duration and may change it only to another offered option, revalidated as a new slot; a price per duration (`PAY-001`) and round-robin or collective assignment (`TEAM-003`, `TEAM-005`) apply to the chosen duration; `PAY-001`, `TEAM-003`, `TEAM-005`, `API-002` and `REPORT-001` each state their part in their own text.

#### LINK-001 — Single-use links and one-off meetings

*Tier:* Core

**Requirement.** A host creates a single-use link for any event type, or a one-off meeting with its own duration, location and availability overrides, without publishing a new event type.

**Acceptance.**
1. A host creates a single-use link for any event type, or a one-off meeting with its own duration, location and availability overrides, without publishing a new event type.
2. A single-use link stops offering times after one booking and shows a used state.
3. One-off meetings appear in the host's link list with their state and expire on a set date.

#### LINK-002 — Host-offered specific times

*Tier:* Core · *Cites:* BASE-MAIL-001

**Requirement.** A host picks specific times from their live availability and sends them as a link or pastes them into an email; the recipient books one and the others are released.

**Acceptance.**
1. A host picks specific times from their live availability and sends them as a link or pastes them into an email; the recipient books one and the others are released.
2. Offered times hold for a configurable window or not at all, and are revalidated at confirmation under `BOOK-001`.
3. This is the host-side counterpart of the invitee's alternative request (`REQUEST-001`).

#### LINK-003 — Prefilled and tracked links

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** Booking links and embeds accept prefilled invitee name, email and answers, and pass UTM parameters and a custom source value through to the booking record, webhooks, CRM handoff and reports.

**Acceptance.**
1. Booking links and embeds accept prefilled invitee name, email and answers, and pass UTM parameters and a custom source value through to the booking record, webhooks, CRM handoff and reports.
2. Prefilled values remain editable by the invitee and are never treated as verified identity.
3. The booking record and operator detail carry the values here; webhook payloads (`API-002`), CRM handoff (`INTEG-002`, `INTEG-003`, `INTEG-004`, `INTEG-008`) and reports (`REPORT-001`) carry the booking's UTM and source values under those clauses, each of which names this clause.

#### POLL-001 — Meeting polls

*Tier:* Core

**Requirement.** A host proposes several candidate times from live availability to a group of up to 50 participants; each participant votes yes, if-needed or no through their own link without an account, sees the tally the host chooses to show, and can change their votes until the poll closes.

**Acceptance.**
1. A host proposes several candidate times from live availability to a group of up to 50 participants; each participant votes yes, if-needed or no through their own link without an account, sees the tally the host chooses to show, and can change their votes until the poll closes.
2. Each participant link is a capability that follows `AUTH-007` (256 bits, bound to the one record and action it names, single-use where single-use, expiring).
3. The host picks the winning time, which books it under `BOOK-012` for every participant with one invitation each and releases the other candidates.
4. Candidate times can be held or unheld; unanswered participants get at most the configured reminders.

#### BRAND-001 — Branding and custom domain

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** Workspaces and teams set a logo, brand color, booking-page background and button text; the Dial footer credit can be removed by deployment configuration (`HOME-001`).

**Acceptance.**
1. Workspaces and teams set a logo, brand color, booking-page background and button text; the Dial footer credit can be removed by deployment configuration (`HOME-001`).
2. Booking pages, embeds and mail use the workspace or team brand.
3. Each deployment serves booking pages from its own configured domain, with optional additional hostnames mapped to teams.

#### LOCALE-001 — Languages and time formats

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** Booking pages, routing forms, polls, embeds, manage pages and invitee mail and SMS render in English, Spanish, French, German, Brazilian Portuguese, Italian or Dutch, chosen per event type or by the invitee's browser and switchable by the invitee on the page, with 12-hour or 24-hour times by locale and invitee choice.

**Acceptance.**
1. Booking pages, routing forms, polls, embeds, manage pages and invitee mail and SMS render in English, Spanish, French, German, Brazilian Portuguese, Italian or Dutch, chosen per event type or by the invitee's browser and switchable by the invitee on the page, with 12-hour or 24-hour times by locale and invitee choice.
2. Operator-entered text is shown as entered.

### Team scheduling

#### TEAM-003 — Round-robin events

*Tier:* Core

**Requirement.** A round-robin event type pools two or more hosts, up to every host of the workspace at the `OPER-007` capacity.

**Acceptance.**
1. A round-robin event type pools two or more hosts, up to every host of the workspace at the `OPER-007` capacity.
2. The page offers a time when at least one eligible pool host is free for the invitee's chosen duration (`EVENT-011`) under `AVAIL-002`; confirmation assigns exactly one host atomically under `BOOK-002`, so two invitees can never be given the same host at the same time.
3. The admin chooses the distribution mode: optimize for availability (offer every time any host is free) or equal distribution (offer only the times of the hosts furthest behind their target share).
4. Each host has a priority (low, medium, high, top) and an optional weight; ties break by fewest bookings in the measured window, then least recently booked, then a stable host order, so the assignment is deterministic and explainable.

#### TEAM-004 — Fairness reporting and rebalancing

*Tier:* Core

**Requirement.** Admins see each pool host's assigned count, target share and drift over the last 7, 30 and 90 days, and can reset the measured window or rebalance forward-only.

**Acceptance.**
1. Admins see each pool host's assigned count, target share and drift over the last 7, 30 and 90 days, and can reset the measured window or rebalance forward-only.
2. Manual reassignment and host absence (`TEAM-007`) are counted explicitly, never silently.
3. Round-robin distribution in the scheduling report (`REPORT-001`) shows each pool host's assigned bookings for the chosen period, states its definition and drills through to the bookings it counts; this clause carries that `REPORT-001` figure.

#### TEAM-005 — Collective events

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001

**Requirement.** A collective event type requires every selected host (or a required subset plus at least N optional hosts) to be free for the invitee's chosen duration (`EVENT-011`) under each host's own rules, calendars and buffers.

**Acceptance.**
1. A collective event type requires every selected host (or a required subset plus at least N optional hosts) to be free for the invitee's chosen duration (`EVENT-011`) under each host's own rules, calendars and buffers.
2. Confirmation claims the time for all of them atomically; one calendar event on the organizer's destination calendar invites the others and the invitee, and a reschedule revalidates every host.
3. If any host's calendar is unreadable, the event fails closed under `AVAIL-004`.
4. Booking mail for a collective booking goes to every host once and to no other member (`NOTIFY-008`).

#### TEAM-006 — Managed event templates

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AUDIT-001

**Requirement.** Admins and team managers publish an event template to selected members or whole teams; each member receives their own event type from it, copied as `EVENT-001` copies an event type (every setting, question, location, schedule binding and template, with no bookings or history).

**Acceptance.**
1. Admins and team managers publish an event template to selected members or whole teams; each member receives their own event type from it, copied as `EVENT-001` copies an event type (every setting, question, location, schedule binding and template, with no bookings or history).
2. The admin locks chosen fields (title, duration, questions, location type, workflows, payment) and leaves others editable; changing the template updates every member copy's locked fields without touching their bookings, and members see which fields are locked.

#### TEAM-007 — Reassignment, absence and delegation

*Tier:* Core · *Cites:* BASE-MAIL-001

**Requirement.** Admins and team managers reassign a booking to another eligible host, which revalidates that host, moves the calendar event and conference under the new host's accounts, and notifies the invitee and both hosts once.

**Acceptance.**
1. Admins and team managers reassign a booking to another eligible host, which revalidates that host, moves the calendar event and conference under the new host's accounts, and notifies the invitee and both hosts once.
2. Hosts record absences (or Dial reads out-of-office events from their calendars) that remove them from pools for that period.
3. A host may delegate booking management to an assistant who acts in their name with every action recorded as the assistant's.
4. After a reassignment the new host is the booking's host recipient and the former host receives only the reassignment notice; an assistant receives a host's booking mail only when that host opts them in (`NOTIFY-008`).

### Routing forms

#### ROUTE-001 — Routing forms

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** Admins build routing forms with ordered questions (text, email, phone, number, single and multiple choice, dropdown, company size, country and US state), required rules and hidden fields fed by URL parameters.

**Acceptance.**
1. Admins build routing forms with ordered questions (text, email, phone, number, single and multiple choice, dropdown, company size, country and US state), required rules and hidden fields fed by URL parameters.
2. Forms are served at their own public URL and embeddable like booking pages (`PUBLIC-004`).
3. A submission is recorded once, with its answers kept on the resulting booking.
4. Its submission capability follows `AUTH-007` (256 bits, bound to the one record and action it names, single-use where single-use, expiring).
5. Routing-form submissions and conversion by route and UTM source are `REPORT-001` figures this clause carries, each stating its definition and drilling through to the submissions and bookings it counts.

#### ROUTE-002 — Routing rules and outcomes

*Tier:* Core

**Requirement.** Ordered rules over answers (equals, contains, in list, greater than, ranges, and/or groups) route a submission to an event type, a specific host within a round-robin pool, a custom message, or an external URL, with a fallback route.

**Acceptance.**
1. Ordered rules over answers (equals, contains, in list, greater than, ranges, and/or groups) route a submission to an event type, a specific host within a round-robin pool, a custom message, or an external URL, with a fallback route.
2. Routing to an event pre-fills the answers into the booking (`LINK-003`), and a route to an event type may carry its own HTTPS redirect after booking (`BOOK-013`).
3. Admins test a set of answers and see the route that would apply before publishing; each submission records the rule that matched.

#### ROUTE-003 — CRM-owner routing and lookup

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001

**Requirement.** A route can look up the submitter in HubSpot, Salesforce, Microsoft Dynamics 365 or Orbit by email or domain and send a known contact or account to its owner's calendar, falling back to the pool when the owner is unavailable or unknown.

**Acceptance.**
1. A route can look up the submitter in HubSpot, Salesforce, Microsoft Dynamics 365 or Orbit by email or domain and send a known contact or account to its owner's calendar, falling back to the pool when the owner is unavailable or unknown.
2. Lookups that fail or time out within 3 seconds use the fallback route and record why.
3. Through the provider sandbox: Real HubSpot and Salesforce sandboxes return the account owner.

#### ROUTE-004 — Routing from existing website forms

*Tier:* Core · *Cites:* BASE-PUBLIC-001

**Requirement.** A website's existing form (HubSpot Forms, Marketo, Pardot/Account Engagement, Pencil, or any HTML form through a small script) can hand its answers to a Dial routing form so the visitor sees the routed scheduling page after submitting, without filling the form twice.

**Acceptance.**
1. A website's existing form (HubSpot Forms, Marketo, Pardot/Account Engagement, Pencil, or any HTML form through a small script) can hand its answers to a Dial routing form so the visitor sees the routed scheduling page after submitting, without filling the form twice.

#### ROUTE-005 — Routing outcomes and follow-up

*Tier:* Core · *Cites:* BASE-MAIL-001

**Requirement.** Every submission records whether it booked, was disqualified, or abandoned before booking.

**Acceptance.**
1. Every submission records whether it booked, was disqualified, or abandoned before booking.
2. Admins see conversion by form, route and source.
3. An unbooked qualified submitter may receive one follow-up email with their booking link after a configured delay, only when the form stated that follow-up and the submitter did not opt out; Mango, not Dial, runs marketing nurture.

### Public booking surfaces — target

#### EMBED-001 — Website embeds and builder plugins

*Tier:* Core · *Cites:* BASE-PUBLIC-001, BASE-INSTALL-001

**Requirement.** Besides the inline and modal script of `PUBLIC-004`, operators copy a floating popup widget and a popup text link (which redirect the parent page after booking as the inline and modal embeds do, `BOOK-013`), configure height, colors and whether host details show, and install through a WordPress plugin, Squarespace, Wix and Webflow embed blocks, Shopify and Pane.

**Acceptance.**
1. Besides the inline and modal script of `PUBLIC-004`, operators copy a floating popup widget and a popup text link (which redirect the parent page after booking as the inline and modal embeds do, `BOOK-013`), configure height, colors and whether host details show, and install through a WordPress plugin, Squarespace, Wix and Webflow embed blocks, Shopify and Pane.
2. The embed passes prefill and UTM values (`LINK-003`) and emits browser events (date selected, booked, rescheduled, canceled) to the parent page so the site's analytics can record conversions (`INTEG-006`).
3. Embeds never set third-party cookies.

#### EMBED-002 — Browser extension

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-MAIL-001, BASE-PUBLIC-001 · *Register:* R-2

**Requirement.** Hosts use a Chrome and Edge extension to copy any booking link, insert a single-use link, a one-off meeting, a poll or a few specific available times (`LINK-002`) as clickable times into an email or message, and to see their next meetings, in Gmail, Outlook on the web and LinkedIn messaging compose boxes.

**Acceptance.**
1. Hosts use a Chrome and Edge extension to copy any booking link, insert a single-use link, a one-off meeting, a poll or a few specific available times (`LINK-002`) as clickable times into an email or message, and to see their next meetings, in Gmail, Outlook on the web and LinkedIn messaging compose boxes.
2. It authenticates with an `AUTH-008` OAuth grant scoped to the host.
3. The Outlook add-in is `EMBED-003` and the Gmail add-on `EMBED-004`.

#### EMBED-003 — Outlook add-in

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-MAIL-001, BASE-INSTALL-001 · *Register:* R-3

**Requirement.** Hosts install a Dial add-in for Outlook from Microsoft AppSource, or an admin deploys it to the whole tenant through Microsoft 365 integrated apps, and use it in Outlook on the web, new and classic Outlook for Windows, Outlook for Mac and, where Microsoft supports compose add-ins, Outlook mobile.

**Acceptance.**
1. Hosts install a Dial add-in for Outlook from Microsoft AppSource, or an admin deploys it to the whole tenant through Microsoft 365 integrated apps, and use it in Outlook on the web, new and classic Outlook for Windows, Outlook for Mac and, where Microsoft supports compose add-ins, Outlook mobile.
2. From a new message or reply the host inserts a booking link, a single-use link or one-off meeting (`LINK-001`), a few specific times as clickable held times (`LINK-002`) or a meeting poll (`POLL-001`), and the task pane lists their next meetings.
3. The add-in signs in with an `AUTH-008` OAuth grant scoped to the host, using Microsoft single sign-on where the tenant allows it, and reads nothing from the mailbox beyond the recipients of the message being composed, which it uses only to prefill an offered-times link.

#### EMBED-004 — Gmail add-on

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-MAIL-001, BASE-INSTALL-001 · *Register:* R-4

**Requirement.** Hosts install a Dial Google Workspace add-on from the Google Workspace Marketplace, or an admin installs it for the whole domain, and use it in Gmail on the web and, where Google supports the add-on's triggers, the Gmail mobile apps.

**Acceptance.**
1. Hosts install a Dial Google Workspace add-on from the Google Workspace Marketplace, or an admin installs it for the whole domain, and use it in Gmail on the web and, where Google supports the add-on's triggers, the Gmail mobile apps.
2. Its compose action inserts a booking link, a single-use link or one-off meeting (`LINK-001`), a few held times (`LINK-002`) or a poll (`POLL-001`) into the draft; its homepage card lists the host's next meetings; and on an opened message it shows whether the sender has an upcoming or past booking with the host.
3. It signs in with an `AUTH-008` OAuth grant scoped to the host and requests only Gmail's compose and current-message scopes.

#### MOBILE-001 — Mobile web booking and operation

*Tier:* Core · *Cites:* BASE-PUBLIC-001 · *Register:* R-39, R-40

**Requirement.** Every public booking, routing, poll and manage page, and every operator page, works at 320 to 430 pixel widths without horizontal scrolling and with touch targets of at least 24 by 24 pixels.

**Acceptance.**
1. Every public booking, routing, poll and manage page, and every operator page, works at 320 to 430 pixel widths without horizontal scrolling and with touch targets of at least 24 by 24 pixels.

#### MOBILE-002 — Native iOS and Android apps

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-INSTALL-001 · *Register:* R-5

**Requirement.** Hosts install Dial for iOS and Android to see today's and upcoming meetings, share links and offered times from the share sheet, approve or decline `EVENT-008` requests, reschedule, cancel, mark attendance (`BOOK-011`), join conferences and receive push notifications for new, changed and canceled bookings.

**Acceptance.**
1. Hosts install Dial for iOS and Android to see today's and upcoming meetings, share links and offered times from the share sheet, approve or decline `EVENT-008` requests, reschedule, cancel, mark attendance (`BOOK-011`), join conferences and receive push notifications for new, changed and canceled bookings.
2. The apps use the same API and roles as the web app and keep working read-only offline with the last synced schedule.

### Availability — target

#### AVAIL-010 — Booking frequency and meeting-time limits

*Tier:* Core

**Requirement.** Per event type and per host, operators cap the number of bookings and the total booked minutes per day, week and month (in the host's zone), and set a minimum gap between bookings of the same invitee.

**Acceptance.**
1. Per event type and per host, operators cap the number of bookings and the total booked minutes per day, week and month (in the host's zone), and set a minimum gap between bookings of the same invitee.
2. A slot that would exceed any cap is not offered and `AVAIL-009` names the cap.

#### AVAIL-011 — Named schedules and holidays

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AUDIT-001

**Requirement.** Each host keeps named reusable schedules (for example Working hours, Evenings, Summer) and assigns one to each event type; editing a schedule updates every event using it.

**Acceptance.**
1. Each host keeps named reusable schedules (for example Working hours, Evenings, Summer) and assigns one to each event type; editing a schedule updates every event using it.
2. Hosts can block US federal holidays automatically, with each holiday shown and individually re-openable, and add multi-day time off in one step.
3. Hours can be copied from one schedule or event type to another, and owners, admins and permitted team managers do all of this on a member's behalf under `OPER-006`, which owns cross-member editing, its role checks (`OPER-001`, `role_forbidden`) and its audit entries (`ADMIN-002`) and names this clause; `TEAM-001` keeps each host's schedules, holidays and time off their own.

#### AVAIL-012 — Locked timezone

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** Per event type, an operator can lock displayed times to one zone (the host's zone by default, or another IANA zone they pick), as Calendly's "Lock timezone" does for in-person events.

**Acceptance.**
1. Per event type, an operator can lock displayed times to one zone (the host's zone by default, or another IANA zone they pick), as Calendly's "Lock timezone" does for in-person events.
2. On a locked event type the public page, picker, details, receipt, emails, SMS and `.ics` show times in the locked zone, each time naming that zone and its UTC offset, and the invitee's zone selector of `AVAIL-005` is replaced by a line stating that times are shown in the locked zone because the meeting happens there.
3. The details and confirmation surfaces also show the time in the invitee's browser zone when it differs, so a traveler sees both.
4. The booking stores the UTC instant, the locked zone and the invitee's browser zone, reminders and `FLOW-001` variables render in the locked zone, and `BASE-PUBLIC-001`'s rule that no visitor-derived value reaches the server on page load still holds. `FLOW-002` (SMS) and `FLOW-001` (variables) each state this rule in their own text.
5. An unlocked event type keeps `AVAIL-005` unchanged.

### Booking lifecycle — target

#### BOOK-013 — Redirect after booking

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** An event type, and each routing route that leads to one (`ROUTE-002`), may send the invitee to an HTTPS page of the operator's choosing once a booking confirms, instead of Dial's receipt.

**Acceptance.**
1. An event type, and each routing route that leads to one (`ROUTE-002`), may send the invitee to an HTTPS page of the operator's choosing once a booking confirms, instead of Dial's receipt.
2. The operator chooses which booking fields to append as URL parameters — event type name, start and end time (ISO 8601 with offset), the invitee's zone, assigned host name, invitee name and email, chosen answers not marked private, a non-capability booking reference, and the `LINK-003` UTM and source values — and never the manage token, a nonce, a private answer or payment details. `ROUTE-002` (per-route redirect) and `EMBED-001` (popup widget redirect) each state their part in their own text.
3. Inside an inline, modal or popup embed (`PUBLIC-004`, `EMBED-001`) the redirect navigates the parent page after the booked event has been emitted to it.
4. The redirect happens only after the claim commits, the confirmation email still carries the manage link, a URL that is not HTTPS is refused when saved, and reschedules and cancellations through the manage link never redirect.

#### BOOK-014 — Request a new booking time

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001 · *Register:* R-7

**Requirement.** On a confirmed booking whose start has not passed, its host, an assistant delegated under `TEAM-007`, or an owner, admin or team manager whose role reaches its host under `OPER-001` can ask the invitee to pick a new time instead of choosing one (`BOOK-009`).

**Acceptance.**
1. On a confirmed booking whose start has not passed, its host, an assistant delegated under `TEAM-007`, or an owner, admin or team manager whose role reaches its host under `OPER-001` can ask the invitee to pick a new time instead of choosing one (`BOOK-009`).
2. The sender writes an optional message of up to 1,000 characters and chooses at send time whether the old time is released now or held until the invitee picks, and, for a round-robin booking, whether the new time stays with the same host or may go to any eligible pool host under `TEAM-003`.
3. Dial sends the invitee exactly one email from the event type's reschedule-request template (`NOTIFY-009`) carrying the message and the booking's own manage link (`BOOK-006`), which opens directly on the `BOOK-007` reschedule step of the same booking: same event type, duration (`EVENT-011`), answers and guests, offering the same host or the pool as chosen.
4. Released now: the slot and its buffers are offered to others at once, the booking's reminders and time-bound workflow steps for the old time are removed, and its managed calendar event and conference stay in place under the same provider event ID and iCalendar UID, marked free and titled "Reschedule requested: …", with no cancellation sent.
5. Held: the old time stays booked and blocked, and is released only once the new time is claimed under `BOOK-002`.

#### BOOK-016 — Complete or expire a reschedule request

*Tier:* Core · *From:* BOOK-014 · *Cites:* BASE-DATA-001, BASE-MAIL-001 · *Register:* R-7

**Requirement.** One optional reminder (off by default, at a chosen offset from 1 hour to 7 days after sending, and never after a held booking's old start) is sent from the reschedule-request reminder template only if the invitee has not picked.

**Acceptance.**
1. One optional reminder (off by default, at a chosen offset from 1 hour to 7 days after sending, and never after a held booking's old start) is sent from the reschedule-request reminder template only if the invitee has not picked.
2. When the invitee picks, the same booking moves under `BOOK-007`: same booking ID and manage token, a new occurrence under `BOOK-004`, the managed event patched in place with its SEQUENCE raised and its busy status and title restored, the conference updated rather than recreated (or moved under `TEAM-007` when the pool assigns another host), reminders scheduled for the new time, and one `NOTIFY-004` change email to each party.
3. The invitee may cancel from the same link under `BOOK-008`.
4. A request that is still open expires 14 days after sending (the sender may choose 1 to 30 days) or, when held, at the old start: an expired held request leaves the booking at its original time, and an expired released request cancels the booking once with the reason "no new time picked" and the ordinary `NOTIFY-004` notices.
5. A paid booking keeps its payment (`PAY-001`) and the pick never re-enters approval (`EVENT-008`).

#### BOOK-017 — Reschedule-request visibility

*Tier:* Core · *From:* BOOK-014 · *Cites:* BASE-MAIL-001 · *Register:* R-7

**Requirement.** The open request, its choices, its reminder time and its expiry show on the booking record and in Bookings' filters (`OPER-003`); `BOOK-010` records the request, reminder, pick or expiry with its actor, and `API-002` delivers a reschedule-requested event.

**Acceptance.**
1. The open request, its choices, its reminder time and its expiry show on the booking record and in Bookings' filters (`OPER-003`); `BOOK-010` records the request, reminder, pick or expiry with its actor, and `API-002` delivers a reschedule-requested event.
2. The request and its reminder carry the assigned host's `Reply-To` under `NOTIFY-010`, so an invitee who answers the email instead of picking a time reaches the host.

#### BOOK-015 — Per-event-type invitee change cut-off

*Tier:* Core · *Cites:* BASE-MAIL-001

**Requirement.** Each event type may set its own cut-off for invitee changes — no invitee reschedule, no invitee cancellation, or neither, within a stated number of hours or days before the start — and a cap on invitee reschedules per booking, overriding `booking.reschedule.v1` and `booking.cancellation.v1` for that event type alone, on free and paid events alike.

**Acceptance.**
1. Each event type may set its own cut-off for invitee changes — no invitee reschedule, no invitee cancellation, or neither, within a stated number of hours or days before the start — and a cap on invitee reschedules per booking, overriding `booking.reschedule.v1` and `booking.cancellation.v1` for that event type alone, on free and paid events alike.
2. The cut-off is stated on the booking page before the invitee books and in the confirmation.
3. Inside the cut-off the manage page (`BOOK-006`) shows the booking, the cut-off and a "Contact the host" action that emails the assigned host under `NOTIFY-010`, instead of the blocked reschedule or cancel step; a direct request to the blocked step is refused with a typed reason and leaves the booking, its reminders and its calendar event unchanged.
4. Operator changes (`BOOK-009`) and `BOOK-014` requests are not limited by it.
5. On a paid event `PAY-003`'s windows remain the money rules, and the editor shows them beside the cut-off and refuses a fee-free cancellation window that the cut-off would make unreachable.

### Calendars and meetings — target

#### CAL-010 — Microsoft 365 and Outlook calendars

*Tier:* Core · *Register:* R-13

**Requirement.** Hosts connect Microsoft 365 work accounts and Outlook.com personal accounts through Microsoft Graph with the same guarantees as Google: free/busy across selected calendars with the `AVAIL-004` freshness and fail-closed rules, one managed event per booking with the invitee as attendee, idempotent create/update/cancel (`CAL-004`), change notifications with subscription renewal and delta sync (`CAL-007`), external deletion and edit handling (`CAL-008`), connection health and alerts (`CAL-006`, `NOTIFY-007`).

**Acceptance.**
1. Hosts connect Microsoft 365 work accounts and Outlook.com personal accounts through Microsoft Graph with the same guarantees as Google: free/busy across selected calendars with the `AVAIL-004` freshness and fail-closed rules, one managed event per booking with the invitee as attendee, idempotent create/update/cancel (`CAL-004`), change notifications with subscription renewal and delta sync (`CAL-007`), external deletion and edit handling (`CAL-008`), connection health and alerts (`CAL-006`, `NOTIFY-007`).
2. Tenant admin consent is supported for organization-wide setup.
3. Busy privacy follows `CAL-002`.
4. This provider owns CAL-003’s managed event guarantees: one event per booking with saved title/description templates, zoned times, stable UID, location and invitee, updated on reschedule and canceled with the booking; invitation links and wider template scope follow NOTIFY-009.

#### CAL-011 — iCloud and CalDAV calendars

*Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-14

**Requirement.** Hosts connect iCloud Calendar with an app-specific password, or another CalDAV server (Fastmail, Nextcloud), for busy reads and managed events.

**Acceptance.**
1. Hosts connect iCloud Calendar with an app-specific password, or another CalDAV server (Fastmail, Nextcloud), for busy reads and managed events.
2. Because CalDAV has no push, Dial polls selected calendars at least every 5 minutes and states that bound in the connection view; a booking's final check (`BOOK-001`) still reads live.
3. This provider owns CAL-003’s managed event guarantees: one event per booking with saved title/description templates, zoned times, stable UID, location and invitee, updated on reschedule and canceled with the booking; invitation links and wider template scope follow NOTIFY-009.

#### CAL-012 — Busy-time copies across calendars

*Tier:* Core

**Requirement.** A host may opt in to have Dial copy busy blocks between their connected calendars (for example a personal Google calendar's events as private Busy blocks on a work Microsoft calendar), so colleagues' schedulers see real availability.

**Acceptance.**
1. A host may opt in to have Dial copy busy blocks between their connected calendars (for example a personal Google calendar's events as private Busy blocks on a work Microsoft calendar), so colleagues' schedulers see real availability.
2. Copies carry no title or detail unless the host opts in, are tagged as Dial-managed, update and delete with their source within 5 minutes, and are never read back as new busy sources.

#### MEET-001 — Zoom meetings

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002 · *Register:* R-15

**Requirement.** A host connects their Zoom account (OAuth, user-level or account-level app).

**Acceptance.**
1. A host connects their Zoom account (OAuth, user-level or account-level app).
2. Each booking with a Zoom location creates one Zoom meeting under that host with the booking's topic, time and zone, waiting room and passcode per the host's Zoom defaults; reschedule updates it, cancellation deletes it, and reassignment (`TEAM-007`) moves it to the new host's account.
3. Commands are idempotent under `CAL-004`, failures follow `CAL-005`, and the joining link is delivered under `NOTIFY-002`.
4. A revoked Zoom grant makes Zoom events stop offering slots and alerts the host.
5. Only a booking whose chosen location is Zoom provisions a meeting and discloses its joining link; the other offered locations are neither provisioned nor shown (`EVENT-004`).

#### MEET-002 — Microsoft Teams meetings

*Tier:* Core · *Register:* R-16

**Requirement.** Microsoft 365 hosts get a Teams online meeting created with the managed Outlook event (`CAL-010`) or, when the destination calendar is not Microsoft, through the Graph online-meetings API.

**Acceptance.**
1. Microsoft 365 hosts get a Teams online meeting created with the managed Outlook event (`CAL-010`) or, when the destination calendar is not Microsoft, through the Graph online-meetings API.
2. The joining link, dial-in numbers when the tenant has audio conferencing, and updates follow the same lifecycle as `MEET-001`.
3. Only a booking whose chosen location is Microsoft Teams provisions a meeting and discloses its joining link; the other offered locations are neither provisioned nor shown (`EVENT-004`).

#### MEET-003 — Other conferencing and readiness

*Tier:* Core · *Cites:* BASE-PUBLIC-001

**Requirement.** Webex and GoTo Meeting are connected the same way as Zoom.

**Acceptance.**
1. Webex and GoTo Meeting are connected the same way as Zoom.
2. Every provider-conference location takes part in publication readiness (`EVENT-006`) and connection health (`CAL-006`), and a booking never shows a joining link that the provider did not return.
3. Only a booking whose chosen location is Webex or GoTo Meeting provisions a meeting and discloses its joining link; the other offered locations are neither provisioned nor shown (`EVENT-004`).

#### MEET-004 — Attendance facts from conferencing

*Tier:* Core · *Cites:* BASE-MAIL-001

**Requirement.** When the host allows it, Dial reads the participant report of a completed Zoom, Teams or Meet meeting (join and leave times, matched to the invitee by email where the provider supplies it) and records it on the booking as a provider fact, separate from the host's own attendance mark of `BOOK-011`.

**Acceptance.**
1. When the host allows it, Dial reads the participant report of a completed Zoom, Teams or Meet meeting (join and leave times, matched to the invitee by email where the provider supplies it) and records it on the booking as a provider fact, separate from the host's own attendance mark of `BOOK-011`.
2. A missing report is recorded as unknown, never as a no-show.

### Payments

#### PAY-001 — Stripe connection

*Tier:* Core · *Cites:* BASE-ACCESS-002, BASE-SECRET-001 · *Register:* R-17

**Requirement.** A host connects their own Stripe account (Stripe Connect Standard OAuth).

**Acceptance.**
1. A host connects their own Stripe account (Stripe Connect Standard OAuth).
2. The OAuth state is signed, bound to the operator session that started it, single use and expires in 10 minutes, as `AUTH-004` requires: missing, unsigned, mismatched, replayed or expired state connects nothing and returns 400.
3. Dial stores the connected account ID, never a token or a card number.
4. Stripe's `account.application.deauthorized` event marks the connection unhealthy and stops new paid bookings, which fail closed with a named reason; free event types are unchanged.
5. Operator Settings shows connect, status, ACH choice and disconnect, and the exact redirect URI and webhook endpoint to register.

#### PAY-008 — Paid booking confirmation

*Tier:* Core · *From:* PAY-001 · *Cites:* BASE-ACCESS-002, BASE-DATA-001, BASE-MAIL-001, BASE-PUBLIC-001 · *Register:* R-17

**Requirement.** An event type sets a USD price, or a price per duration option (`EVENT-011`: the chosen option's price applies), and the invitee pays through Stripe Checkout or an embedded Payment Element (cards, Apple Pay, Google Pay, Link, and ACH Direct Debit where the host enables it) before the booking confirms.

**Acceptance.**
1. An event type sets a USD price, or a price per duration option (`EVENT-011`: the chosen option's price applies), and the invitee pays through Stripe Checkout or an embedded Payment Element (cards, Apple Pay, Google Pay, Link, and ACH Direct Debit where the host enables it) before the booking confirms.
2. The slot is held for the payment window (default 10 minutes) through the same atomic claim as `BOOK-002`, so two payers cannot hold one slot; Dial expires the Checkout Session when its window ends.
3. Confirmation happens only when Dial receives Stripe's signed `checkout.session.completed` or `payment_intent.succeeded` event (`AUTH-005`: a missing or bad signature, a timestamp outside 300 seconds, or a connected account that is not the event type's host connection returns 401 and changes nothing), never from the return URL alone; a duplicated event confirms once (`BOOK-003`).
4. Any payment-return capability follows `AUTH-007` (256 bits, bound to one record and action, expiring).
5. An abandoned, expired or failed payment releases the hold and creates no booking. Dial never sees or stores card numbers.
6. The receipt (`BOOK-005` mail and page), the manage page and the operator booking record (`OPER-004`) show the amount and the Stripe reference; a reschedule keeps the amount paid.
7. Cancelling or rescheduling a paid booking keeps the payment record; any refund, deposit balance or fee follows the cancellation policy and host actions of `PAY-003`.
8. Inherited and named both ways: `PAY-003` owns refunds, deposits and cancellation or no-show fees; `PAY-004` owns packages, coupons and gift certificates; `PAY-005` owns sales tax, invoices and receipts beyond the amount line; `PAY-006` owns reconciliation, disputes and accounting export.

#### PAY-002 — PayPal and Venmo

*Tier:* Core · *Cites:* BASE-SIGNIN-001

**Requirement.** A host connects PayPal (Business account) as an alternative or additional processor; the invitee pays with PayPal or Venmo through PayPal's hosted checkout, and the booking confirms only on PayPal's verified capture webhook, with the same hold, release and idempotence rules as `PAY-001`.

**Acceptance.**
1. A host connects PayPal (Business account) as an alternative or additional processor; the invitee pays with PayPal or Venmo through PayPal's hosted checkout, and the booking confirms only on PayPal's verified capture webhook, with the same hold, release and idempotence rules as `PAY-001`.
2. Through the provider sandbox: A PayPal sandbox business account completes a PayPal and a Venmo payment.

#### PAY-003 — Deposits, refunds and cancellation or no-show fees

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-SIGNIN-001

**Requirement.** An event type may take a deposit instead of the full price, collect the balance later through a payment link, or save the invitee's card with explicit consent (Stripe SetupIntent) to charge a stated late-cancellation or no-show fee.

**Acceptance.**
1. An event type may take a deposit instead of the full price, collect the balance later through a payment link, or save the invitee's card with explicit consent (Stripe SetupIntent) to charge a stated late-cancellation or no-show fee.
2. The cancellation policy shown before booking states the windows and amounts.
3. Invitee cancellation inside the free window refunds automatically per policy; outside it the stated fee applies.
4. When the host or an operator cancels a paid booking, or it is cancelled by the host's calendar deletion or an expired host reschedule request, Dial refunds everything captured for it in full, once, charges no fee, and voids any open balance link or invoice; an operator cancelling from the booking record may instead choose a smaller refund or none by entering a reason, and the invitee's cancellation mail states the amount refunded and that reason.
5. Hosts issue full or partial refunds and charge the no-show fee from the booking record; every money movement records actor, amount, reason and processor reference, and Dial never charges an amount the invitee was not shown.
6. This clause owns refunds, deposits and cancellation or no-show fees for paid bookings, which `PAY-001` names as inherited.
7. Through the provider sandbox: A Stripe test-mode run issues a real refund and an off-session fee on a saved test card, voids a real open invoice, and Stripe delivers a balance payment event to a deployed Dial.

#### PAY-004 — Packages, coupons and gift certificates

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-AUDIT-001, BASE-DATA-001, BASE-MAIL-001

**Requirement.** Hosts sell appointment packages (for example 5 coaching sessions valid for 6 months) and recurring appointment memberships through Stripe, and issue coupons and gift certificates in USD.

**Acceptance.**
1. Hosts sell appointment packages (for example 5 coaching sessions valid for 6 months) and recurring appointment memberships through Stripe, and issue coupons and gift certificates in USD.
2. Invitees redeem them at booking with a code or the email they bought with; each redemption decrements the balance atomically with the booking claim and is restored on eligible cancellation.
3. Balances, expiry and redemption history appear to the host and, through the manage link, to the invitee.
4. Studio memberships and class-pass operations are Strap's product; complex subscription catalogs are Nectar's.
5. This clause owns packages, coupons and gift certificates for paid bookings, which `PAY-001` names as inherited; until it ships, `PAY-001` states that Dial issues none of them.
6. Through the provider sandbox: Stripe test-clock fixtures prove subscription renewal and failed collection.

#### PAY-005 — Sales tax, receipts and invoices

*Tier:* Core · *Cites:* BASE-MAIL-001

**Requirement.** Hosts may enable Stripe Tax so US sales tax is calculated by the invitee's address where the service is taxable; Dial shows tax before payment and on the receipt.

**Acceptance.**
1. Hosts may enable Stripe Tax so US sales tax is calculated by the invitee's address where the service is taxable; Dial shows tax before payment and on the receipt.
2. Every payment produces a receipt email with the host's business name, amount, tax and reference, and hosts can issue an invoice with a payment link for a booking instead of upfront payment.
3. Receipt emails go only to the invitee and the booking's host recipients (`NOTIFY-008`).
4. This clause owns sales tax, invoices and receipts beyond the amount line for paid bookings, which `PAY-001` names as inherited.
5. Through the provider sandbox: A Stripe test-mode account with Stripe Tax registrations charges real tax at Checkout and a hosted invoice is paid on Stripe's page.

#### PAY-006 — Payment reconciliation and accounting export

*Tier:* Core · *Cites:* BASE-DATA-001, BASE-SIGNIN-001

**Requirement.** A payments view lists every charge, refund, fee, dispute and payout reference per booking, reconciled against the processor's events; a payment whose processor state disagrees with Dial (for example a dispute or an out-of-band refund) is flagged for the host.

**Acceptance.**
1. A payments view lists every charge, refund, fee, dispute and payout reference per booking, reconciled against the processor's events; a payment whose processor state disagrees with Dial (for example a dispute or an out-of-band refund) is flagged for the host.
2. Hosts export payments as CSV and send them to QuickBooks Online, Xero or Pantry as sales receipts against a mapped income account.
3. This clause owns reconciliation, disputes and accounting export for paid bookings, which `PAY-001` names as inherited; until it ships, `PAY-001` states that Dial issues none of them.
4. Accounting export uses CSV and anonymous QuickBooks Online receipts against a host-mapped income account, with a USD company and custom transaction numbers; tax-bearing receipts are refused until tax mapping exists. Xero remains within this capability; Pantry is linked until it supplies a sales-receipt receiving door.

#### PAY-007 — Priced and saved-card-fee approval

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-SIGNIN-001

**Requirement.** Priced and saved-card-fee event types may require host approval (`EVENT-008`); refusing them is withdrawn as the target.

**Acceptance.**
1. Priced and saved-card-fee event types may require host approval (`EVENT-008`); refusing them is withdrawn as the target.
2. A priced approval type takes cards and Link only; ACH Direct Debit and other methods that cannot be authorized are refused on approval types with a named reason.
3. At request the invitee authorizes the shown total with manual capture (a hold, no charge), and the `PAY-001` 10-minute payment window applies to completing the authorization.
4. Approval captures it, and the booking confirms only on the signed capture event under the `PAY-001` and `AUTH-005` rules; decline, expiry or host cancellation voids the authorization, releases the slot and tells the invitee once.
5. The approval window is configurable up to 7 days (the card authorization limit) and defaults to 24 hours.
6. A deposit type authorizes only the deposit and sends the balance link after approval.
7. A saved-card-fee type collects SetupIntent consent at request, bound to the shown terms, charges nothing before approval, and detaches the saved card on decline or expiry.
8. The amount never exceeds the shown terms, approval sends one receipt or confirmation email, and every money movement records actor, amount, reason and processor reference (`PAY-003`).

### Notifications and workflows — target

#### NOTIFY-008 — Booking host recipients

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001 · *Register:* R-23

**Requirement.** Mail about a booking — confirmation, reminders, changes, link-ready, approval requests and payment receipts — goes to the invitee (and guests where `EVENT-009` says so) and to the booking's host recipients only: the assigned host of a one-on-one or round-robin booking, every host on a collective booking (`TEAM-005`), and after a reassignment (`TEAM-007`) the new host, the former host receiving only the reassignment notice.

**Acceptance.**
1. Mail about a booking — confirmation, reminders, changes, link-ready, approval requests and payment receipts — goes to the invitee (and guests where `EVENT-009` says so) and to the booking's host recipients only: the assigned host of a one-on-one or round-robin booking, every host on a collective booking (`TEAM-005`), and after a reassignment (`TEAM-007`) the new host, the former host receiving only the reassignment notice.
2. A delegated assistant (`TEAM-007`) receives a host's booking mail only when that host opts them in.
3. Owners, admins and team managers receive no booking mail by default; each may opt in, per team or event type they manage, to copies of that scope's bookings, and those copies omit answers marked private and never carry the manage token.
4. Members never receive mail for another member's bookings, and viewers never receive booking mail.
5. An alternative request (`REQUEST-004`) follows the same rule for the event type it was made on.
6. No mail discloses a booking, invitee or answer to a person whom `OPER-001` would refuse a read of that booking.
7. An invitee-supplied "Ask invitee" location (`EVENT-004`) on a round-robin or collective booking appears only in mail to that booking's host recipients (the assigned host, or every host of a collective booking).

#### NOTIFY-011 — Single-host mail preferences

*Tier:* Core · *From:* NOTIFY-008 · *Cites:* BASE-MAIL-001, BASE-INSTALL-001 · *Register:* R-23

**Requirement.** In a single-host install every operator acts as the one host (`OPER-001`), so every operator who has not muted booking mail is a host recipient, which is the single-host behavior.

**Acceptance.**
1. In a single-host install every operator acts as the one host (`OPER-001`), so every operator who has not muted booking mail is a host recipient, which is the single-host behavior.
2. The `NOTIFY-001` mute covers booking mail only (confirmations, changes and reminders): alternative-request notices reach every host recipient whether or not they muted booking mail, and `REQUEST-004`'s routing policy is what narrows them.

#### NOTIFY-012 — Reply recipient routing

*Tier:* Core · *From:* NOTIFY-008 · *Cites:* BASE-ROLE-001 · *Register:* R-23

**Requirement.** Replies follow the same recipients under `NOTIFY-010`: an invitee's reply reaches the booking's assigned host (the organizer of a collective booking, the new host after a reassignment), never a shared inbox or another member, and a host recipient's reply reaches the invitee.

**Acceptance.**
1. Replies follow the same recipients under `NOTIFY-010`: an invitee's reply reaches the booking's assigned host (the organizer of a collective booking, the new host after a reassignment), never a shared inbox or another member, and a host recipient's reply reaches the invitee.

#### NOTIFY-009 — Event and locale message templates

*Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-24

**Requirement.** Each event type, and each managed team template under `TEAM-006`, has editable templates for the managed calendar event's title and description (`CAL-003`, `CAL-010`, `CAL-011`) and for the subject and body of the invitee's confirmation, reschedule, cancellation and reminder emails (`NOTIFY-001`, `NOTIFY-003`, `NOTIFY-004`) and of the reschedule-request email and its reminder (`BOOK-014`), which add the sender's message as a variable.

**Acceptance.**
1. Each event type, and each managed team template under `TEAM-006`, has editable templates for the managed calendar event's title and description (`CAL-003`, `CAL-010`, `CAL-011`) and for the subject and body of the invitee's confirmation, reschedule, cancellation and reminder emails (`NOTIFY-001`, `NOTIFY-003`, `NOTIFY-004`) and of the reschedule-request email and its reminder (`BOOK-014`), which add the sender's message as a variable.
2. Templates use the variable set of `FLOW-001` — invitee full and first name, host name or names, event name, date and time in the recipient's zone with the zone named, duration, location or joining link, each answer by question, and the manage link — and the editor previews each template against a real or sample booking and refuses an unknown variable by name.
3. The default calendar title is `{event name}: {invitee full name} and {host name}`, and the default description carries the location or joining link, the answers not marked private and the invitation manage link.
4. An edited template replaces the built-in message rather than adding one, and a `FLOW-001` workflow that adds a booked-trigger invitee email offers to turn the built-in confirmation off so the invitee never receives two.
5. Templates are kept per locale (`LOCALE-001`); a locale without its own edited template uses the workspace default language's edited text, never the built-in one.
6. Each template's preview shows the From name and reply address of `NOTIFY-010` that the message will carry, and the No-reply note of `NOTIFY-010` is added to the body of an event type set to No-reply, whatever its template says.
7. This clause owns CAL-003’s direct Reschedule/Cancel links and template scope beyond native Google, including other providers and managed team/locale templates.

#### NOTIFY-013 — Invitation replacement link

*Tier:* Core · *From:* NOTIFY-009 · *Cites:* BASE-AUDIT-001, BASE-MAIL-001 · *Register:* R-24

**Requirement.** The invitation manage link is on by default and can be turned off per event type; it is a capability under `AUTH-007` that on an explicit “Email me my link” request rotates the booking's `BOOK-006` capability and emails a replacement link only to the invitee's stored booking address, showing nothing about the booking.

**Acceptance.**
1. The invitation manage link is on by default and can be turned off per event type; it is a capability under `AUTH-007` that on an explicit “Email me my link” request rotates the booking's `BOOK-006` capability and emails a replacement link only to the invitee's stored booking address, showing nothing about the booking.
2. The email and page state that the earlier manage link no longer works, including the link in the confirmation email; the rotation is audited.
3. RL-1 governs the replacement-link outcome; calendar readers receive no private manage authority.

#### NOTIFY-014 — Direct calendar change links

*Tier:* Core · *From:* NOTIFY-009 · *Register:* R-24

**Requirement.** An event type may instead turn on direct links, as Calendly's invitations carry: the description then holds separate Reschedule and Cancel links, each a calendar-scoped capability under `AUTH-007` that opens straight on `BOOK-007`'s reschedule step or `BOOK-008`'s cancel step for that booking alone, shows only the event name, the time and the host, never the answers, the invitee's details or the manage token, cannot read or change anything else, and is replaced in the calendar on every reschedule so a superseded link stops working.

**Acceptance.**
1. An event type may instead turn on direct links, as Calendly's invitations carry: the description then holds separate Reschedule and Cancel links, each a calendar-scoped capability under `AUTH-007` that opens straight on `BOOK-007`'s reschedule step or `BOOK-008`'s cancel step for that booking alone, shows only the event name, the time and the host, never the answers, the invitee's details or the manage token, cannot read or change anything else, and is replaced in the calendar on every reschedule so a superseded link stops working.

#### NOTIFY-010 — Reply-To and sender identity

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001 · *Register:* R-25

**Requirement.** Every email Dial sends an invitee about a booking — confirmation, reminders, change and cancellation notices, link-ready, approval decisions (`EVENT-008`), payment receipts, the reschedule request and its reminder (`BOOK-014`), poll invitations (`POLL-001`), replies to an alternative-time request (`REQUEST-003`, `REQUEST-005`), workflow emails (`FLOW-001`, `FLOW-003`, `FLOW-004`) and agent-sent messages (`AGENT-002`, `AGENT-003`, `AGENT-006`) — carries a `Reply-To` of the booking's assigned host, so an invitee's "running ten minutes late" or "here's the deck" reaches the person they are meeting, as it does on Calendly.

**Acceptance.**
1. Every email Dial sends an invitee about a booking — confirmation, reminders, change and cancellation notices, link-ready, approval decisions (`EVENT-008`), payment receipts, the reschedule request and its reminder (`BOOK-014`), poll invitations (`POLL-001`), replies to an alternative-time request (`REQUEST-003`, `REQUEST-005`), workflow emails (`FLOW-001`, `FLOW-003`, `FLOW-004`) and agent-sent messages (`AGENT-002`, `AGENT-003`, `AGENT-006`) — carries a `Reply-To` of the booking's assigned host, so an invitee's "running ten minutes late" or "here's the deck" reaches the person they are meeting, as it does on Calendly.
2. The assigned host is the host of a one-on-one, group or round-robin booking; on a collective booking (`TEAM-005`) it is the organizer host, whose calendar holds the managed event; after a reassignment (`TEAM-007`) it is the new host for every message sent from the reassignment on, while messages already sent are unchanged.
3. A host's reply address is their account email by default; a host may instead set a reply address they confirm through a one-time link sent to it (a sales alias, say), and an unconfirmed address is never used.
4. The `From` header carries the assigned host's name as its display name (a team event type may choose the team's name instead) beside the verified sending address of `NOTIFY-006`, encoded under RFC 5322 and RFC 2047 with quotes, angle brackets, CR and LF removed from the name, so no name can add or split a header.
5. Each event type has a "Reply-to address" setting with two choices, "Host's email address" (the default) and "No-reply": with No-reply the invitee's mail for that event type carries no `Reply-To` and no host address in any header, and its body states in the invitee's language (`LOCALE-001`) that replies to this email are not received and that the manage link changes the booking.
6. Mail to a host recipient (`NOTIFY-008`) carries a `Reply-To` of the invitee's booking address, so the host answers from the notice; an owner, admin or manager opt-in copy carries the same, since `OPER-001` already lets that reader see the invitee; host mail about an alternative request (`REQUEST-004`) carries the requester's address.
7. No mail carries a `Reply-To` naming a member other than the booking's assigned host, the unread sender address, or the assistant address of `AGENT-009`.
8. The template editors of `NOTIFY-009` and `FLOW-001` show the From name and reply address each message will carry. This clause carries the reply rule of `NOTIFY-008`.

#### NOTIFY-015 — Send through the host mailbox

*Tier:* Core · *From:* NOTIFY-010 · *Cites:* BASE-ROLE-001, BASE-MAIL-001 · *Register:* R-25

**Requirement.** A host may also connect their own Gmail (Gmail API send scope) or Microsoft 365 mailbox (Graph `Mail.Send`) and choose to send the invitee mail of their personal event types from it, as Calendly offers for workflow emails: replies then reach that mailbox natively and each message appears in its Sent folder; a revoked or failing mailbox grant marks the mailbox disconnected, emails the host once in the manner of `NOTIFY-007`, and sends each later message from the verified sender with the host's `Reply-To`, recording the sending route on every delivery.

**Acceptance.**
1. A host may also connect their own Gmail (Gmail API send scope) or Microsoft 365 mailbox (Graph `Mail.Send`) and choose to send the invitee mail of their personal event types from it, as Calendly offers for workflow emails: replies then reach that mailbox natively and each message appears in its Sent folder; a revoked or failing mailbox grant marks the mailbox disconnected, emails the host once in the manner of `NOTIFY-007`, and sends each later message from the verified sender with the host's `Reply-To`, recording the sending route on every delivery.

#### FLOW-001 — Workflow builder

*Tier:* Core · *Cites:* BASE-MAIL-001

**Requirement.** Hosts and admins build workflows attached to one or more event types (or a whole team): a trigger (booked, rescheduled, canceled, a set time before start, a set time after end, marked no-show or attended, payment received, routing submission without booking) and one or more actions (email the invitee, hosts or a fixed address; SMS the invitee or host under `FLOW-002`; send a webhook under `API-002`; update a CRM under `INTEG-002` to `INTEG-004`).

**Acceptance.**
1. Hosts and admins build workflows attached to one or more event types (or a whole team): a trigger (booked, rescheduled, canceled, a set time before start, a set time after end, marked no-show or attended, payment received, routing submission without booking) and one or more actions (email the invitee, hosts or a fixed address; SMS the invitee or host under `FLOW-002`; send a webhook under `API-002`; update a CRM under `INTEG-002` to `INTEG-004`).
2. Message templates use variables (invitee and host names, event, local time and zone (the locked zone when the event type has one, `AVAIL-012`), location, manage link, answers) with a preview against a real booking.
3. Timed actions are durable jobs replaced on reschedule and removed on cancel exactly as `NOTIFY-003` requires; each run records sent, skipped (with reason) or failed per action.
4. The default 24-hour and 1-hour email reminders are a built-in workflow under `reminder.schedule.v1`.
5. Workflow emails to invitees carry the From name and `Reply-To` of `NOTIFY-015` and, for a host who connected their mailbox under it, are sent from that mailbox.
6. Workflow attachments duplicate with their event type (`EVENT-001`): the copy carries the same attachments and none of the original's runs.
7. A workflow unsubscribe link is a capability that follows `AUTH-007` (256 bits, bound to the one record and action it names, single-use where single-use, expiring).

#### FLOW-002 — SMS reminders and confirmations

*Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-26

**Requirement.** Dial sends transactional SMS through RER Managed SMS (`FLOW-006`), which needs no Twilio account or carrier registration from the workspace, or, when the workspace chooses, through its own Twilio account (Messaging Service with registered A2P 10DLC campaign or toll-free verification); every rule below applies to both senders.

**Acceptance.**
1. Dial sends transactional SMS through RER Managed SMS (`FLOW-006`), which needs no Twilio account or carrier registration from the workspace, or, when the workspace chooses, through its own Twilio account (Messaging Service with registered A2P 10DLC campaign or toll-free verification); every rule below applies to both senders.
2. The invitee opts in with an unticked checkbox and the disclosed message purpose and frequency at booking; STOP, HELP and START replies are honored at once, opt-out is recorded per number and respected across all workflows, quiet hours default to 8 a.m.–9 p.m. in the invitee's zone, and delivery status from Twilio's signed callbacks marks each message delivered, failed or undelivered.
3. No SMS is sent to a number without recorded consent.
4. Hosts can receive their own SMS alerts the same way.
5. Every SMS for an event type with a locked timezone shows the time in that zone, naming the zone and its UTC offset (`AVAIL-012`).

#### FLOW-003 — Post-meeting follow-ups

*Tier:* Core

**Requirement.** Workflows send follow-ups after the meeting ends: a thank-you with notes or resources, a rebooking link for the same or a next event type, a feedback request the host writes, or a payment link for a balance (`PAY-003`).

**Acceptance.**
1. Workflows send follow-ups after the meeting ends: a thank-you with notes or resources, a rebooking link for the same or a next event type, a feedback request the host writes, or a payment link for a balance (`PAY-003`).
2. A follow-up is sent only when the booking was not canceled and, when the host chooses, only when it was marked attended.

#### FLOW-004 — No-show handling

*Tier:* Core · *Cites:* BASE-MAIL-001

**Requirement.** Marking a booking no-show (`BOOK-011`) can trigger a no-show workflow: a rebooking email or SMS to the invitee, a no-show fee under `PAY-003`, a CRM update, and a host task.

**Acceptance.**
1. Marking a booking no-show (`BOOK-011`) can trigger a no-show workflow: a rebooking email or SMS to the invitee, a no-show fee under `PAY-003`, a CRM update, and a host task.
2. Hosts can configure automatic no-show marking from conferencing attendance facts (`MEET-004`) only after confirming each proposed mark, and repeated no-shows by one invitee can require deposits on that invitee's next bookings.

#### FLOW-005 — Host notifications in Slack and Microsoft Teams

*Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-27

**Requirement.** Hosts and teams route new, rescheduled, canceled and routed-unbooked notices to a Slack channel or DM and to a Microsoft Teams channel, with the booking summary and a link to the record but no manage token and no answers marked private.

**Acceptance.**
1. Hosts and teams route new, rescheduled, canceled and routed-unbooked notices to a Slack channel or DM and to a Microsoft Teams channel, with the booking summary and a link to the record but no manage token and no answers marked private.
2. Workspace notices use an owner-configured Slack destination or a sealed Teams Workflows URL. Ambiguous sends retain an unknown outcome and are not automatically replayed; Teams erasure reports pending manual cleanup when that provider supplies no deletion authority.

#### FLOW-006 — Managed transactional SMS

*Tier:* Core · *Register:* R-28

**Requirement.** A workspace sends transactional SMS on the day it turns SMS on, with no Twilio account or carrier registration of its own: RER Managed SMS sends its consented confirmations, reminders, follow-ups and host alerts from numbers RER operates under its own toll-free verification and A2P 10DLC registration for appointment messages, each message naming the workspace and carrying opt-out text.

**Acceptance.**
1. A workspace sends transactional SMS on the day it turns SMS on, with no Twilio account or carrier registration of its own: RER Managed SMS sends its consented confirmations, reminders, follow-ups and host alerts from numbers RER operates under its own toll-free verification and A2P 10DLC registration for appointment messages, each message naming the workspace and carrying opt-out text.
2. The consent, STOP/HELP/START, opt-out, quiet-hours and delivery-status rules of `FLOW-002` apply unchanged; because carriers apply opt-out per sending number, a STOP to a shared number stops every later message from that number to that handset, for every workspace, until START.
3. A host verifies their own phone with a one-time code before receiving host alerts.
4. Managed SMS carries transactional appointment messages only, never marketing (Mango's job).

#### FLOW-007 — Managed SMS allowance and exhaustion

*Tier:* Core · *From:* FLOW-006 · *Cites:* BASE-ROLE-001, BASE-MAIL-001 · *Register:* R-28

**Requirement.** Its allowance is 250 messages per host seat per calendar month, pooled across the workspace (a 15-host workspace has 3,750), declared in the documented capacity limits with 250 per seat as its floor; a message to a US or Canadian number counts as one whatever its length, and a message to another country counts at that country's rate, which Settings → SMS shows before a number there is messaged.

**Acceptance.**
1. Its allowance is 250 messages per host seat per calendar month, pooled across the workspace (a 15-host workspace has 3,750), declared in the documented capacity limits with 250 per seat as its floor; a message to a US or Canadian number counts as one whatever its length, and a message to another country counts at that country's rate, which Settings → SMS shows before a number there is messaged.
2. Settings → SMS shows owners and admins the period's used and remaining count, per host and per workflow, and the reset time.
3. Each owner and admin is emailed once per period when usage reaches 90%.
4. From 100%, every SMS action that would have been sent is sent instead as an email with the same text to the same recipient (the invitee's booking address or the host's account address), each owner and admin is emailed once that SMS has paused, and the `FLOW-001` run log records the action as "sent as email: SMS allowance reached", so no workflow step is skipped or silently dropped.
5. The allowance resets on the first day of each month at 00:00 UTC, and unused messages do not carry over.
6. A workspace sending through its own Twilio Messaging Service has no Dial allowance or cap; Twilio bills it directly.

#### FLOW-008 — Move to a workspace sender

*Tier:* Core · *From:* FLOW-006 · *Cites:* BASE-MAIL-001 · *Register:* R-28

**Requirement.** A workspace may move to its own Twilio Messaging Service (`FLOW-002`) at any time: Settings → SMS shows the active sender and, for an own-Twilio service, a guided registration (brand, campaign use case, sample messages, the booking page's opt-in wording) with Twilio's registration status read back, and Dial switches sender only once that status is approved, so messages never stop during registration.

**Acceptance.**
1. A workspace may move to its own Twilio Messaging Service (`FLOW-002`) at any time: Settings → SMS shows the active sender and, for an own-Twilio service, a guided registration (brand, campaign use case, sample messages, the booking page's opt-in wording) with Twilio's registration status read back, and Dial switches sender only once that status is approved, so messages never stop during registration.
2. The switch-over checklist (`MIGRATE-005`) lists every SMS workflow without a ready sender.

### Clients and reporting

#### CLIENT-001 — Client records

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AUDIT-001, BASE-MAIL-001

**Requirement.** Every invitee email becomes a client record listing their bookings across hosts, answers, attendance, payments, packages, SMS consent, notes and custom fields, with merge of duplicates.

**Acceptance.**
1. Every invitee email becomes a client record listing their bookings across hosts, answers, attendance, payments, packages, SMS consent, notes and custom fields, with merge of duplicates.
2. Repeat clients can book with their details remembered through a signed-in-free magic link sent to their email, never by email address alone.
3. Client records are a scheduling history, not a CRM: deals, pipelines and sales activity live in Orbit, HubSpot or Salesforce through `INTEG-002` to `INTEG-004`.

#### REPORT-001 — Scheduling analytics

*Tier:* Core · *Cites:* BASE-ROLE-001

**Requirement.** Admins and hosts see, for a chosen period, host, team and event type: bookings created, rescheduled and canceled with reasons, no-show and attendance rates, lead time, popular days and hours in the host's zone, bookings by the UTM and source values of `LINK-003` and by chosen duration (`EVENT-011`), routing-form submissions and conversion by route and UTM source, round-robin distribution (`TEAM-004`), and revenue, refunds and fees.

**Acceptance.**
1. Admins and hosts see, for a chosen period, host, team and event type: bookings created, rescheduled and canceled with reasons, no-show and attendance rates, lead time, popular days and hours in the host's zone, bookings by the UTM and source values of `LINK-003` and by chosen duration (`EVENT-011`), routing-form submissions and conversion by route and UTM source, round-robin distribution (`TEAM-004`), and revenue, refunds and fees.
2. Every figure states its definition and drills through to the bookings it counts.
3. Host and team choice are carried by `TEAM-001` and `TEAM-002`, routing-form submissions and conversion by `ROUTE-001`, round-robin distribution by `TEAM-004` and the member-only step by `OPER-001`, each of which names this clause.

#### REPORT-002 — Host calendar view and booking workspace

*Tier:* Core

**Requirement.** Besides the filtered list of `OPER-003`, hosts and admins see bookings in day, week and month calendar grids by host or team, in the viewer's zone, with filters for host, team, event type, state, payment state and attendance; selecting a meeting opens its `OPER-004` record.

**Acceptance.**
1. Besides the filtered list of `OPER-003`, hosts and admins see bookings in day, week and month calendar grids by host or team, in the viewer's zone, with filters for host, team, event type, state, payment state and attendance; selecting a meeting opens its `OPER-004` record.

#### REPORT-003 — Exports and scheduled reports

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001, BASE-MAIL-001, BASE-INSTALL-001

**Requirement.** People export bookings, clients, routing submissions and payments as CSV with the current filters, and schedule a weekly or monthly emailed report to named workspace members, within their `OPER-001` role: owners and admins export everything and schedule reports to anyone; team managers export and schedule reports for their teams' hosts; members export only their own bookings, clients and payments; viewers export CSVs of the bookings and reports they can read and may be named recipients of a scheduled report, but cannot create, change or delete one.

**Acceptance.**
1. People export bookings, clients, routing submissions and payments as CSV with the current filters, and schedule a weekly or monthly emailed report to named workspace members, within their `OPER-001` role: owners and admins export everything and schedule reports to anyone; team managers export and schedule reports for their teams' hosts; members export only their own bookings, clients and payments; viewers export CSVs of the bookings and reports they can read and may be named recipients of a scheduled report, but cannot create, change or delete one.
2. Exports include no manage tokens.
3. The whole-install archive of `DATA-001` remains the complete owner export.

### Integrations

#### API-001 — Public REST API

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-PUBLIC-001

**Requirement.** A versioned REST API under the documented route with `AUTH-008` credentials covers event types, availability (free slots for an event type and range), bookings (create, read, list, reschedule, cancel, mark attendance), hosts, teams, routing forms and submissions, polls, workflows and webhook subscriptions.

**Acceptance.**
1. A versioned REST API under the documented route with `AUTH-008` credentials covers event types, availability (free slots for an event type and range), bookings (create, read, list, reschedule, cancel, mark attendance), hosts, teams, routing forms and submissions, polls, workflows and webhook subscriptions.
2. It uses cursor pagination, idempotency keys on writes, documented error codes, per-credential rate limits with 429 and `Retry-After`, and an OpenAPI document.
3. API bookings run the same validation, claim and side effects as the public flow.

#### API-002 — Webhooks

*Tier:* Core

**Requirement.** Admins subscribe HTTPS endpoints to booking created, rescheduled, reschedule requested (`BOOK-014`), canceled, no-show, attendance, payment, routing submission and poll events at workspace, team or host scope.

**Acceptance.**
1. Admins subscribe HTTPS endpoints to booking created, rescheduled, reschedule requested (`BOOK-014`), canceled, no-show, attendance, payment, routing submission and poll events at workspace, team or host scope.
2. This clause also owns subscriber and webhook dispatch of CAL-006’s natively recorded `calendar.connection-health-changed.v1` facts, retaining their event IDs, states, named reasons and times.
3. Each delivery is signed (HMAC-SHA256 with a timestamp), retried with backoff for 24 hours, shown with its status and response code, and redeliverable by hand; payloads carry no manage token and carry the booking's UTM and source values (`LINK-003`) and its chosen duration (`EVENT-011`).

#### API-003 — Machine-credential booking

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-MAIL-001, BASE-PUBLIC-001, BASE-SIGNIN-001 · *Register:* R-29

**Requirement.** Another product (for example Handset) books, reschedules and cancels through Dial with a scoped bearer credential and no operator session.

**Acceptance.**
1. Another product (for example Handset) books, reschedules and cancels through Dial with a scoped bearer credential and no operator session.
2. This clause adds to `AUTH-008`, `API-001` and `API-002` and weakens none of them.
3. A booking resource names its state, occurrences, event type, host, invitee answers, chosen duration, payment and approval state, `created_by` (type and credential name) and never a manage token.
4. A create runs the same validation, atomic claim and side effects as the public flow (`BOOK-001`, `BOOK-002`, `AVAIL-002`): the invitee gets the ordinary `NOTIFY-001` mail and manage link, a blocked email or domain (`PUBLIC-006`) is refused exactly as the public flow refuses it and creates nothing, and an event type that needs host approval (`EVENT-008`) answers 202 with the booking `pending_approval` and the slot held, confirming only when the host approves.
5. A priced, deposit or saved-card-fee event type (`PAY-001`, `PAY-003`, `PAY-007`) answers 202 `payment_required` with the hosted payment step and the booking confirms only on the signed processor event under `AUTH-005`; the credential cannot set, waive or reduce an amount, choose a method the event type forbids, or mark anything paid, and a priced approval type keeps the `PAY-007` authorization and decision rules.
6. A request carries SMS consent only as an object naming the disclosure text version, acceptance and capture time; Dial accepts it only from a credential whose owner attested that its application collects consent, records the credential and disclosure version as the source, and otherwise refuses the object with 422 `consent_not_permitted` and sends no SMS; an opted-out number (`FLOW-002`) stays suppressed whatever the request says.
7. Reschedule follows `BOOK-007` and cancel follows `BOOK-008` (cancellation is irreversible, repeats return the stored result and notify once, and refund or fee follows `PAY-003` policy exactly as for an invitee); both refuse a booking outside the credential's scope.

#### API-004 — Machine credential lifecycle

*Tier:* Core · *From:* API-003 · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-MAIL-001 · *Register:* R-29

**Requirement.** An owner or admin (`OPER-001`; until it ships, the owner) creates a machine credential in Settings under a fresh operator session.

**Acceptance.**
1. An owner or admin (`OPER-001`; until it ships, the owner) creates a machine credential in Settings under a fresh operator session.
2. It has a name; a display name that invitee-facing notices use for the machine actor (default: the host's name); scopes from the `AUTH-008` set, where read bookings and write bookings are independent and neither implies the other, plus read availability; an allow-list of event types and an allow-list of host calendars (`CAL-001`) it may reach, each empty meaning none and never all; a required expiry no later than the documented maximum credential lifetime; and an attestation, off by default, that the calling application collects SMS consent itself (see below).
3. The secret is at least 256 bits from a cryptographically secure source, carries the fixed prefix `dial_` so secret scanners can find it, is shown once at creation and once at each rotation, and is stored only as a hash; Settings, the API and every log line show only the credential ID and the first 8 characters.
4. A credential can reach only event types and calendars the creating person may act on under `OPER-001`, re-checked on every request, so demoting or removing the creator (`ADMIN-001`) stops it on the next request.
5. The creating person and every later change are recorded.
6. Rotation issues a second secret and keeps the old one valid for an overlap the owner sets up to 24 hours (default 0); expiry, revocation and the end of an overlap take effect on the next request.
7. The credential list shows each credential's name, prefix, scopes, allow-lists, creation, expiry, rotation state, last-used time and revoked state; a credential that has never been used shows no last-used time.
8. It is accepted only in an `Authorization: Bearer` header over HTTPS, never in a query string or body, and Dial sends no CORS headers on the documented route, so a browser page cannot hold one.

#### API-005 — Machine action scope

*Tier:* Core · *From:* API-003 · *Cites:* BASE-ROLE-001, BASE-MAIL-001 · *Register:* R-29

**Requirement.** A static booking credential authorizes only its declared booking actions and never relaxes the event's price, consent, conflict, notice, horizon or buffer rules; named-person agent actions use the Agent surface and its company-policy classes.

**Acceptance.**
1. A static booking credential authorizes only its declared booking actions and never relaxes the event's price, consent, conflict, notice, horizon or buffer rules; named-person agent actions use the Agent surface and its company-policy classes.

#### API-006 — Machine API resource doors

*Tier:* Core · *From:* API-003 · *Cites:* BASE-ROLE-001, BASE-PUBLIC-001 · *Register:* R-29

**Requirement.** all under the documented route and checked at the `AUTH-001` boundary: the documented command (the caller's own name, scopes, allow-lists, expiry and remaining rate allowance); the documented command and the documented command (the same slots as the public page under `AVAIL-002`, hiding everything the credential's allow-lists exclude); the documented command; the documented command (cursor, filter by state, event type and start range) and the documented command; the documented command; the documented command; `GET`, the documented setting and the documented command; the documented command and the documented command.

**Acceptance.**
1. all under the documented route and checked at the `AUTH-001` boundary: the documented command (the caller's own name, scopes, allow-lists, expiry and remaining rate allowance); the documented command and the documented command (the same slots as the public page under `AVAIL-002`, hiding everything the credential's allow-lists exclude); the documented command; the documented command (cursor, filter by state, event type and start range) and the documented command; the documented command; the documented command; `GET`, the documented setting and the documented command; the documented command and the documented command.

#### API-007 — Machine command retries and limits

*Tier:* Core · *From:* API-003 · *Cites:* BASE-ROLE-001, BASE-MAIL-001 · *Register:* R-29

**Requirement.** Every POST that creates or changes a booking requires an `Idempotency-Key` of 16 to 128 characters, scoped to the credential and kept 24 hours.

**Acceptance.**
1. Every POST that creates or changes a booking requires an `Idempotency-Key` of 16 to 128 characters, scoped to the credential and kept 24 hours.
2. The same key with a canonically identical payload returns the stored result with the original status and `Idempotent-Replay: true` and creates no second booking, mail, calendar event or webhook; the same key with a different payload returns 409 `idempotency_key_reused` and creates nothing; a concurrent request on a key still in flight returns 409 `request_in_progress` with `Retry-After` and creates nothing; a missing key returns 400 `idempotency_key_required`.
3. Every refusal is JSON `{error: {code, message, request_id}}` with a stable code: 401 `invalid_credential`, `credential_expired`, `credential_revoked`; 403 `scope_forbidden` (the credential lacks the scope for this action); 404 `not_found` for any booking, event type or calendar outside its allow-lists or workspace, identical to a record that does not exist; 409 and 422 per above and per the booking rules with the named reason of the failed rule; 429 `rate_limited` with `Retry-After` and `X-RateLimit-Limit`, `-Remaining` and `-Reset` headers on every response, with separate per-credential limits for reads, for writes and for failed authentications (the failed-authentication limit also applies per source address under `BASE-ACCESS-003`), set in the documented capacity limits; a limited or refused request changes nothing.

#### API-008 — Scoped webhook subscriptions

*Tier:* Core · *From:* API-003 · *Cites:* BASE-ROLE-001, BASE-DATA-003, BASE-MAIL-001 · *Register:* R-29

**Requirement.** A credential with the webhooks scope manages only subscriptions that deliver events for its own allow-listed event types and calendars, and a subscription's payloads never include another event type's bookings.

**Acceptance.**
1. A credential with the webhooks scope manages only subscriptions that deliver events for its own allow-listed event types and calendars, and a subscription's payloads never include another event type's bookings.
2. Endpoints must be HTTPS and are refused if they resolve at subscription time or at each delivery to a private, loopback, link-local or metadata address.
3. Each subscription has its own signing secret, shown once and rotatable with the overlap rule above; each delivery carries `Dial-Signature: t=<unix>,v1=<HMAC-SHA256 of t.body>`, a unique event ID, a per-booking sequence number so receivers can order and drop stale events, and the timestamp window (5 minutes) that receivers are told to enforce.
4. Delivery, retry for 24 hours and manual redelivery stay as `API-002` says; a replay through the API re-sends the same event ID and body with a fresh timestamp and signature, works only for deliveries of the credential's own scope within 30 days, and refuses an event whose booking has been erased with 410 `erased`.
5. A subscription whose endpoint fails for 24 hours of retries is disabled with a named reason, an `ADMIN-002` entry and one notice to the credential's owner.

#### API-009 — Machine actor history and erasure

*Tier:* Core · *From:* API-003 · *Cites:* BASE-ROLE-001, BASE-AUDIT-001, BASE-DATA-003, BASE-MAIL-001, BASE-PUBLIC-001 · *Register:* R-29

**Requirement.** Every booking created, rescheduled or canceled by a credential records the credential as the actor in `BOOK-010` history with the credential's ID and name at that time; the `NOTIFY-004` notice names the credential's display name as who made the change; and `ADMIN-002` records credential creation, scope or allow-list change, rotation, revocation, expiry, the last use before revocation, each webhook subscription change, endpoint disabling, and, collapsed to one entry per credential, reason and minute, each refused call (`scope_forbidden`, `credential_revoked`, `credential_expired`, `rate_limited`).

**Acceptance.**
1. Every booking created, rescheduled or canceled by a credential records the credential as the actor in `BOOK-010` history with the credential's ID and name at that time; the `NOTIFY-004` notice names the credential's display name as who made the change; and `ADMIN-002` records credential creation, scope or allow-list change, rotation, revocation, expiry, the last use before revocation, each webhook subscription change, endpoint disabling, and, collapsed to one entry per credential, reason and minute, each refused call (`scope_forbidden`, `credential_revoked`, `credential_expired`, `rate_limited`).
2. Entries keep the credential's name after it is deleted and keep a stable opaque ID.
3. Nothing here relaxes `PAY-007` approval, payment authorization, `FLOW-002` consent, `PUBLIC-006` blocks, the `AUTH-003` rule that a manage token is the only public booking authority (no response, webhook, log or notice carries one for the credential's use), or `DATA-002` erasure; erasing an invitee deletes that person's data from stored idempotency results, webhook delivery bodies and replayable payloads, leaves a tombstone so a replayed idempotency key returns 410 `erased` and creates nothing, and keeps the anonymized audit entries.

#### API-010 — Machine metadata without restored authority

*Tier:* Core · *From:* API-003 · *Cites:* BASE-ROLE-001, BASE-DATA-001, BASE-INSTALL-001 · *Register:* R-29

**Requirement.** Under `DATA-004`, the `DATA-001`, `DATA-009` archive carries each credential's metadata (ID, name, display name, prefix, scopes, allow-lists, creation, expiry, rotation, last-used and revoked state) and each webhook subscription's endpoint and scope, and excludes every secret, secret hash, signing secret and idempotency record; restoring into an empty install brings every credential back revoked with reason `restored_from_archive` and every subscription back disabled until its signing secret is rotated, so no archive and no restore ever carries or recreates machine authority.

**Acceptance.**
1. Under `DATA-004`, the `DATA-001`, `DATA-009` archive carries each credential's metadata (ID, name, display name, prefix, scopes, allow-lists, creation, expiry, rotation, last-used and revoked state) and each webhook subscription's endpoint and scope, and excludes every secret, secret hash, signing secret and idempotency record; restoring into an empty install brings every credential back revoked with reason `restored_from_archive` and every subscription back disabled until its signing secret is rotated, so no archive and no restore ever carries or recreates machine authority.

#### INTEG-001 — Zapier, Make and Crank

*Tier:* Core · *Register:* R-30

**Requirement.** Dial publishes a Zapier app and a Make app with booking, cancellation, routing and no-show triggers and create-booking and find-slots actions, and a Crank connector built on the same API and webhooks.

**Acceptance.**
1. Dial publishes a Zapier app and a Make app with booking, cancellation, routing and no-show triggers and create-booking and find-slots actions, and a Crank connector built on the same API and webhooks.

#### INTEG-002 — HubSpot

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-SIGNIN-001

**Requirement.** A connected HubSpot portal receives, per booking, a contact (matched by email, created if absent), a meeting engagement associated with the contact and owner, and updates on reschedule, cancel and no-show; routing answers map to chosen contact properties.

**Acceptance.**
1. A connected HubSpot portal receives, per booking, a contact (matched by email, created if absent), a meeting engagement associated with the contact and owner, and updates on reschedule, cancel and no-show; routing answers map to chosen contact properties.
2. Routing can read HubSpot owners (`ROUTE-003`) and forms (`ROUTE-004`).
3. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`).
4. The booking's UTM and source values (`LINK-003`) ride in the handoff.
5. Through the provider sandbox: A HubSpot developer test portal shows the meeting on the contact timeline.

#### INTEG-003 — Salesforce

*Tier:* Core · *Cites:* BASE-ROLE-001

**Requirement.** A connected Salesforce org receives Event records linked to the matched Lead or Contact (and Account), creates Leads for unknown invitees when the admin chooses, updates Events on change, and writes routing answers to mapped fields; routing can read account and lead owners.

**Acceptance.**
1. A connected Salesforce org receives Event records linked to the matched Lead or Contact (and Account), creates Leads for unknown invitees when the admin chooses, updates Events on change, and writes routing answers to mapped fields; routing can read account and lead owners.
2. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`).
3. The booking's UTM and source values (`LINK-003`) ride in the handoff.
4. Through the provider sandbox: A Salesforce Developer Edition org shows the Event.

#### INTEG-004 — Orbit and Pipedrive

*Tier:* Core

**Requirement.** Bookings, attendance and routing answers hand off to Orbit, Dial's sibling CRM, as meeting activities on the matched person and company, and to Pipedrive as activities on the matched person and deal.

**Acceptance.**
1. Bookings, attendance and routing answers hand off to Orbit, Dial's sibling CRM, as meeting activities on the matched person and company, and to Pipedrive as activities on the matched person and deal.
2. Dial never becomes the CRM; it links each booking to the CRM record it created or updated.
3. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`).
4. The booking's UTM and source values (`LINK-003`) ride in the handoff.

#### INTEG-005 — Calendar and conferencing marketplace presence

*Tier:* Core · *Cites:* BASE-ACCESS-002, BASE-PUBLIC-001, BASE-INSTALL-001 · *Register:* R-31

**Requirement.** Dial ships the Google Workspace Marketplace listing, Microsoft AppSource listing and Zoom App Marketplace listing needed for organization-wide installation of `CAL-001`, `CAL-010`, `MEET-001` and `EMBED-002` to `EMBED-004`, with the verified OAuth consent screens and least-privilege scopes those providers require.

**Acceptance.**
1. Dial ships the Google Workspace Marketplace listing, Microsoft AppSource listing and Zoom App Marketplace listing needed for organization-wide installation of `CAL-001`, `CAL-010`, `MEET-001` and `EMBED-002` to `EMBED-004`, with the verified OAuth consent screens and least-privilege scopes those providers require.

#### INTEG-006 — Analytics and conversion tracking

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** Owners and admins (`OPER-001`) add a Google Analytics 4 measurement ID, Google Tag Manager container, Meta Pixel ID, Google Ads conversion tag or LinkedIn Insight Tag to booking pages and routing forms; Dial reports page view, slot selected and booking confirmed events, loads these scripts only when configured, and states their use in the invitee privacy notice.

**Acceptance.**
1. Owners and admins (`OPER-001`) add a Google Analytics 4 measurement ID, Google Tag Manager container, Meta Pixel ID, Google Ads conversion tag or LinkedIn Insight Tag to booking pages and routing forms; Dial reports page view, slot selected and booking confirmed events, loads these scripts only when configured, and states their use in the invitee privacy notice.
2. When an admin connects a LinkedIn Ads or Google Ads account, Dial also sends each confirmed booking server-side as a conversion (LinkedIn Conversions API, Google Ads offline conversion upload) with the click ID captured from the booking link (`li_fat_id`, `gclid`) and no answers.
3. Embeds report through the parent-page events of `EMBED-001` instead, and a buyer who measures on their own thank-you page uses the redirect of `BOOK-013`.

#### INTEG-007 — Intercom

*Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-32

**Requirement.** A connected Intercom workspace gets a Dial app in the Messenger and the inbox: teammates send a booking link or offered times (`LINK-002`) from a conversation, visitors book inside the Messenger, and each booking creates or updates the Intercom contact (matched by email), adds a note to the conversation it came from, and adds notes on reschedule, cancellation and no-show.

**Acceptance.**
1. A connected Intercom workspace gets a Dial app in the Messenger and the inbox: teammates send a booking link or offered times (`LINK-002`) from a conversation, visitors book inside the Messenger, and each booking creates or updates the Intercom contact (matched by email), adds a note to the conversation it came from, and adds notes on reschedule, cancellation and no-show.

#### INTEG-008 — Microsoft Dynamics 365 Sales

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002 · *Register:* R-33

**Requirement.** A connected Dynamics 365 Sales environment (Dataverse Web API, OAuth through Microsoft Entra ID) receives an appointment activity per booking regarding the matched contact or lead (an unknown invitee becomes a lead when the admin chooses), updated on reschedule, cancellation and no-show, with routing answers written to mapped fields; routing reads contact and account owners (`ROUTE-003`).

**Acceptance.**
1. A connected Dynamics 365 Sales environment (Dataverse Web API, OAuth through Microsoft Entra ID) receives an appointment activity per booking regarding the matched contact or lead (an unknown invitee becomes a lead when the admin chooses), updated on reschedule, cancellation and no-show, with routing answers written to mapped fields; routing reads contact and account owners (`ROUTE-003`).
2. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`).
3. The booking's UTM and source values (`LINK-003`) ride in the handoff.

### Data and migration — target

#### DATA-004 — Full-scope portability and erasure

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001, BASE-DATA-003, BASE-SIGNIN-001

**Requirement.** Every record the target adds joins the `DATA-001` archive and the `DATA-002` erasure census before it ships: an unclassified table refuses export and stops erasure before any deletion.

**Acceptance.**
1. Every record the target adds joins the `DATA-001` archive and the `DATA-002` erasure census before it ships: an unclassified table refuses export and stops erasure before any deletion.
2. Credentials, API secrets and processor tokens stay excluded.
3. The target's own record kinds, personal rows and external deletion requests are carried by `DATA-005`, `DATA-006`, `DATA-007` and `DATA-008`.

#### DATA-005 — Target record kinds in the archive

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-DATA-001, BASE-SIGNIN-001

**Requirement.** Under `DATA-004`, the archive carries hosts, teams and roles, schedules, routing forms and submissions, polls and votes, guests, recurring series, workflows and their run logs, SMS consent and opt-outs, payment references (never card data), packages and redemptions, client records, webhook subscriptions and delivery logs, integration mappings and agent records (`AGENT-001`).

**Acceptance.**
1. Under `DATA-004`, the archive carries hosts, teams and roles, schedules, routing forms and submissions, polls and votes, guests, recurring series, workflows and their run logs, SMS consent and opt-outs, payment references (never card data), packages and redemptions, client records, webhook subscriptions and delivery logs, integration mappings and agent records (`AGENT-001`).
2. Credentials, API secrets and processor tokens stay excluded.

#### DATA-006 — Target personal rows in erasure

*Tier:* Core · *Cites:* BASE-DATA-003

**Requirement.** Under `DATA-004`, erasing a person removes their votes, guest entries, phone numbers, consent rows and client record.

**Acceptance.**
1. Under `DATA-004`, erasing a person removes their votes, guest entries, phone numbers, consent rows and client record.

#### DATA-007 — Processor deletion requests

*Tier:* Core · *Cites:* BASE-DATA-003, BASE-SIGNIN-001

**Requirement.** Under `DATA-004`, erasing a person asks each connected processor (today Stripe, `PAY-001`; PayPal and Venmo with `PAY-002`) to delete or anonymize what Dial sent, and reports each outcome.

**Acceptance.**
1. Under `DATA-004`, erasing a person asks each connected processor (today Stripe, `PAY-001`; PayPal and Venmo with `PAY-002`) to delete or anonymize what Dial sent, and reports each outcome.
2. Stripe Customers are anonymized and cards detached, retaining anonymous cleanup lookup references after local erasure; immutable Checkout email stays explicitly pending without an invented deletion request.

#### DATA-008 — CRM deletion requests

*Tier:* Core · *Cites:* BASE-DATA-003

**Requirement.** Under `DATA-004`, erasing a person asks each connected CRM (`INTEG-002`, `INTEG-003`, `INTEG-004`, `INTEG-007`, `INTEG-008`) to delete or anonymize what Dial sent, and reports each outcome.

**Acceptance.**
1. Under `DATA-004`, erasing a person asks each connected CRM (`INTEG-002`, `INTEG-003`, `INTEG-004`, `INTEG-007`, `INTEG-008`) to delete or anonymize what Dial sent, and reports each outcome.

#### MIGRATE-001 — Calendly connected move-in

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-AUDIT-001, BASE-PUBLIC-001 · *Register:* R-35

**Requirement.** Besides the saved-file import of `DATA-003`, an owner or admin connects a Calendly organization through Calendly's public API (OAuth) and previews, then imports, everything that API publishes: organization members as hosts, event types with their name, slug, durations including every duration option (`EVENT-011`), locations, questions, round-robin or collective kind and hosts, each member's availability schedules (the documented route) as `AVAIL-011` named schedules, the schedule each event type uses, routing forms with their questions and past submissions, contacts with their custom field definitions, every past and future scheduled event with its invitees and answers, invitee no-shows and meeting recaps, without notifying invitees or creating calendar events again.

**Acceptance.**
1. Besides the saved-file import of `DATA-003`, an owner or admin connects a Calendly organization through Calendly's public API (OAuth) and previews, then imports, everything that API publishes: organization members as hosts, event types with their name, slug, durations including every duration option (`EVENT-011`), locations, questions, round-robin or collective kind and hosts, each member's availability schedules (the documented route) as `AVAIL-011` named schedules, the schedule each event type uses, routing forms with their questions and past submissions, contacts with their custom field definitions, every past and future scheduled event with its invitees and answers, invitee no-shows and meeting recaps, without notifying invitees or creating calendar events again.
2. Contacts (the documented route, the documented route) become `CLIENT-001` records with their custom fields; past scheduled events become booking history in their final state for `REPORT-001` and `CLIENT-001`, never re-offered, re-sent or written to a calendar; the documented route become `BOOK-011` no-show marks with "Calendly import" as the actor; the documented route are stored with their booking as cited context `AGENT-007` may read only under an `AGENT-001` grant; and routing-form submissions (the documented route) count in `REPORT-001`'s routing figures.
3. Dial reads only fields Calendly's published OpenAPI document defines.
4. Catch-up, differences, undo and the switch-over checklist of `DATA-003`, `DATA-014`, `DATA-017`, `DATA-015` apply.
5. Connecting, previewing, importing, resolving the over-capacity step, catch-up and undo are for owners and admins only: every other role gets 403 `role_forbidden` with no Calendly authorization started and nothing written (`OPER-001`).

#### MIGRATE-006 — Calendly schedule bindings

*Tier:* Core · *From:* MIGRATE-001 · *Register:* R-35

**Requirement.** For every imported event type Dial reads the documented command: an entry whose `availability_rule` references a schedule (`uri`, `name`) binds that event type, for the host its `user` names, to the imported schedule with the same URI; an entry carrying its own `rules` becomes that event type's custom hours in the entry's `timezone`; and for round-robin and collective event types each pool host's entry binds that host's hours.

**Acceptance.**
1. For every imported event type Dial reads the documented command: an entry whose `availability_rule` references a schedule (`uri`, `name`) binds that event type, for the host its `user` names, to the imported schedule with the same URI; an entry carrying its own `rules` becomes that event type's custom hours in the entry's `timezone`; and for round-robin and collective event types each pool host's entry binds that host's hours.
2. The preview shows each event type, per host, as "schedule: <name>" or "custom hours", and a reference Dial cannot match to an imported schedule is a named manual step, never a silent default.

#### MIGRATE-007 — Calendly manual steps and capacity

*Tier:* Core · *From:* MIGRATE-001 · *Cites:* BASE-ROLE-001, BASE-MAIL-001 · *Register:* R-35

**Requirement.** Every setting that API does not expose is listed in the preview as a named manual step per event type, member or form, with where to set it in Dial: workflows and their messages, notification and invitation customization, buffers, minimum notice, booking horizon, daily limits, round-robin distribution, priorities and weights, routing rules, and payment settings.

**Acceptance.**
1. Every setting that API does not expose is listed in the preview as a named manual step per event type, member or form, with where to set it in Dial: workflows and their messages, notification and invitation customization, buffers, minimum notice, booking horizon, daily limits, round-robin distribution, priorities and weights, routing rules, and payment settings.
2. Nothing is guessed: a value Dial sets itself is labeled as a Dial default, and each manual step becomes an item of the switch-over checklist (`MIGRATE-005`).
3. Before any write, the preview counts the organization's active members and the event types they would bring against the capacity of `OPER-007`: when importing them would pass a limit, the preview shows a blocking "Over capacity" step that names the limit and lists, by name, every member and event type that cannot be imported, and the import stays disabled — nothing is written — until the admin deselects members or event types to fit (each deselected member's event types and bookings are then listed in the preview as not imported) or frees capacity; an import never proceeds partially or silently past a limit.

#### MIGRATE-002 — Acuity Scheduling move-in

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-ACCESS-002, BASE-DATA-001 · *Register:* R-36

**Requirement.** An owner or admin connects Acuity through its API key or OAuth, or uploads its CSV exports, and imports calendars as hosts, appointment types (price, duration, padding, intake forms), availability, clients, packages, gift certificates and coupons with remaining balances, and future appointments with form answers and paid state, with the same preview, silence, undo and catch-up rules as `DATA-003`, `DATA-014`, `DATA-015`, including its owner-and-admin restriction (`OPER-001`).

**Acceptance.**
1. An owner or admin connects Acuity through its API key or OAuth, or uploads its CSV exports, and imports calendars as hosts, appointment types (price, duration, padding, intake forms), availability, clients, packages, gift certificates and coupons with remaining balances, and future appointments with form answers and paid state, with the same preview, silence, undo and catch-up rules as `DATA-003`, `DATA-014`, `DATA-015`, including its owner-and-admin restriction (`OPER-001`).

#### MIGRATE-003 — Microsoft Bookings move-in

*Tier:* Core · *Cites:* BASE-ROLE-001 · *Register:* R-37

**Requirement.** An owner or admin connects Microsoft 365 and imports a Bookings business: staff as hosts, services as event types (duration, buffers, price display, custom questions, Teams setting), business hours and staff availability, customers as clients, and future appointments, with the same preview and silence rules and the owner-and-admin restriction of `DATA-003` (`OPER-001`).

**Acceptance.**
1. An owner or admin connects Microsoft 365 and imports a Bookings business: staff as hosts, services as event types (duration, buffers, price display, custom questions, Teams setting), business hours and staff availability, customers as clients, and future appointments, with the same preview and silence rules and the owner-and-admin restriction of `DATA-003` (`OPER-001`).

#### MIGRATE-004 — Cal.com, SavvyCal, Doodle and generic move-in

*Tier:* Core · *Cites:* BASE-ROLE-001

**Requirement.** Owners and admins import from Cal.com (API), SavvyCal (API) and Doodle or any other scheduler through a documented CSV and `.ics` template covering event types, availability and future bookings, with the same preview, losses, silence and undo rules; every other role gets 403 `role_forbidden` with nothing written (`OPER-001`).

**Acceptance.**
1. Owners and admins import from Cal.com (API), SavvyCal (API) and Doodle or any other scheduler through a documented CSV and `.ics` template covering event types, availability and future bookings, with the same preview, losses, silence and undo rules; every other role gets 403 `role_forbidden` with nothing written (`OPER-001`).

#### MIGRATE-005 — Cutover and old links

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-PUBLIC-001

**Requirement.** After move-in, the switch-over checklist (`DATA-003`, `DATA-017`) also covers teams, routing forms, workflows, payments and embeds.

**Acceptance.**
1. After move-in, the switch-over checklist (`DATA-003`, `DATA-017`) also covers teams, routing forms, workflows, payments and embeds.
2. Each manual re-entry step a move-in lists (`MIGRATE-001` to `MIGRATE-004`) and each SMS workflow without a ready sender (`FLOW-006`) is a checklist item, and the earliest day the source can be closed stays unset until every such item is marked done or waived by a named owner or admin (`OPER-001`), with the time recorded; Dial produces a redirect map from each old Calendly, Acuity, Bookings, Cal.com or SavvyCal link to its Dial link and the website snippets to replace, and checks each replaced embed by fetching the owner's pages.
3. Dial never changes the source account.

### Agent surface

**Specialist: scheduling coordinator.** It keeps the host’s real calendar, invitee scheduling, payments and follow-through coherent across a seeded business week.

Inherits BASE-AGENT-001 to BASE-AGENT-013. The company’s policy decides every call; Dial presets no disposition.

**How Dial computes each class.**

- standard: reversible internal drafts, notes, holds and scheduling updates, measured by affected items.
- external: saved calendar destinations, recipients and visibility determine recipients and whether the counterparty is known, new or public; publishing an open booking link is public.
- money: saved price, deposit, balance, refund, fee, package or invoice facts determine amount, currency and processor counterparty.
- commitment: a binding sign-off determines value and counterparty.
- accounts: creation of an outside provider account or resource names its provider.
- gated: the provider’s consent, hosted checkout, verification or registration step names the provider and the step it keeps for a person.
- access: the membership or grant delta determines people and whether authority widens or narrows.
- security: credential handling or a protective-setting delta names the setting and provider.
- destructive: irreversible cancellation, erasure or restore determines the affected item count.
- sensitive: trusted intake-field classification determines regulated data kind and record count.
- live: publication and active scheduling, routing or workflow settings name the running service affected.

| Tool | Does | Core clauses | Risk class | Today |
| --- | --- | --- | --- | --- |
| `dial.auth.manage_grants` | Public authority; Booking nonce; Booking access; Calendar authorization callback; Provider callbacks; First-owner admission; Capabilities for new public surfaces; API credentials and connected apps | AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, AUTH-006, AUTH-007, AUTH-008 | access · security (+ gated) | not implemented |
| `dial.oper.manage_workspace` | Roles and permissions; Role-scoped booking mail; Role-scoped reporting; Operator invitations and roles; Destructive operator removal; Booking workspace; Booking record; First-run checklist; Durable setup completion; Editing a member's availability and event types; Workspace capacity | OPER-001, OPER-008, OPER-009, OPER-002, OPER-010, OPER-003, OPER-004, OPER-005, OPER-011, OPER-006, OPER-007 | standard or access (+ destructive) (+ external) (+ live) | not implemented |
| `dial.editor.edit_installation` | Owner editor | EDITOR-001 | live · security | not implemented |
| `dial.profile.update` | Host profile; Public profile; Avatar asset | PROFILE-001, PROFILE-002, PROFILE-003 | standard or external | not implemented |
| `dial.event.configure` | Event type lifecycle; Scheduling constraints; Invitee questions; Locations; Removing an event type; Publication readiness; Group events and capacity; Bookings that need host approval; Invitee guests; Recurring bookings; Invitee-selectable durations | EVENT-001, EVENT-002, EVENT-003, EVENT-004, EVENT-005, EVENT-006, EVENT-007, EVENT-008, EVENT-009, EVENT-010, EVENT-011 | standard or live (+ external) | not implemented |
| `dial.public.prepare_booking` | Event presentation; Invitee-first flow; Progress and recovery; Embed; Unavailable pages; Abuse | PUBLIC-001, PUBLIC-002, PUBLIC-003, PUBLIC-004, PUBLIC-005, PUBLIC-006 | standard or external | not implemented |
| `dial.avail.configure` | Schedule and overrides; Valid slots; Buffers; Freshness and failure; Timezones; Daylight saving time; Recommendations and filters; Response time; Operator diagnostics; Booking frequency and meeting-time limits; Named schedules and holidays; Locked timezone | AVAIL-001, AVAIL-002, AVAIL-003, AVAIL-004, AVAIL-005, AVAIL-006, AVAIL-007, AVAIL-008, AVAIL-009, AVAIL-010, AVAIL-011, AVAIL-012 | standard or live | not implemented |
| `dial.book.manage` | Final validation; Atomic claim; Idempotent confirmation; States and occurrences; Confirmation receipt; Manage link; Invitee rescheduling; Invitee cancellation; Operator changes; History; Attendance; Operator-created booking; Redirect after booking; Request a new booking time; Complete or expire a reschedule request; Reschedule-request visibility; Per-event-type invitee change cut-off | BOOK-001, BOOK-002, BOOK-003, BOOK-004, BOOK-005, BOOK-006, BOOK-007, BOOK-008, BOOK-009, BOOK-010, BOOK-011, BOOK-012, BOOK-013, BOOK-014, BOOK-016, BOOK-017, BOOK-015 | standard or external (+ money) (+ destructive) | not implemented |
| `dial.cal.reconcile` | Calendar connections; Busy privacy; Managed event; Idempotent side effects; Provider failure; Connection health; Provider callbacks; External deletion and edits; Calendar file; Microsoft 365 and Outlook calendars; iCloud and CalDAV calendars; Busy-time copies across calendars | CAL-001, CAL-002, CAL-003, CAL-004, CAL-005, CAL-006, CAL-007, CAL-008, CAL-009, CAL-010, CAL-011, CAL-012 | standard or external (+ security) (+ gated) | not implemented |
| `dial.request.handle` | Compose; Submit; Operator workflow; Routing; Invitee updates | REQUEST-001, REQUEST-002, REQUEST-003, REQUEST-004, REQUEST-005 | standard or external | not implemented |
| `dial.notify.configure` | Booking confirmation; Link completion; Reminders; Changes; Delivery failure; No mail loops; Connection alerts; Booking host recipients; Single-host mail preferences; Reply recipient routing; Event and locale message templates; Invitation replacement link; Direct calendar change links; Reply-To and sender identity; Send through the host mailbox | NOTIFY-001, NOTIFY-002, NOTIFY-003, NOTIFY-004, NOTIFY-005, NOTIFY-006, NOTIFY-007, NOTIFY-008, NOTIFY-011, NOTIFY-012, NOTIFY-009, NOTIFY-013, NOTIFY-014, NOTIFY-010, NOTIFY-015 | standard or external | not implemented |
| `dial.data.transfer_or_erase` | Archive contents and exclusions; Restore without live authority; Hosted archive capture; Email-wide personal erasure; Erasure fences across restore; Operator and invitee identity overlap; Saved-file review and import; Imported booking provenance; Conflict-preserving import undo; Incremental catch-up; Source differences and release; Switch-over readiness; Full-scope portability and erasure; Target record kinds in the archive; Target personal rows in erasure; Processor deletion requests; CRM deletion requests | DATA-001, DATA-009, DATA-010, DATA-002, DATA-011, DATA-012, DATA-003, DATA-013, DATA-014, DATA-015, DATA-016, DATA-017, DATA-004, DATA-005, DATA-006, DATA-007, DATA-008 | standard or destructive (+ sensitive) (+ security) | not implemented |
| `dial.custom.annotate` | Operator annotations; Annotation privacy and portability | CUSTOM-001, CUSTOM-002 | standard (+ sensitive) | not implemented |
| `dial.team.configure` | Hosts as independent schedulers; Teams and team pages; Round-robin events; Fairness reporting and rebalancing; Collective events; Managed event templates; Reassignment, absence and delegation | TEAM-001, TEAM-002, TEAM-003, TEAM-004, TEAM-005, TEAM-006, TEAM-007 | standard or access (+ external) (+ live) | not implemented |
| `dial.admin.administer` | Single sign-on and provisioning; Admin audit log | ADMIN-001, ADMIN-002 | access or security | not implemented |
| `dial.link.offer` | Single-use links and one-off meetings; Host-offered specific times; Prefilled and tracked links | LINK-001, LINK-002, LINK-003 | standard or external | not implemented |
| `dial.poll.manage` | Meeting polls | POLL-001 | standard or external (+ destructive) | not implemented |
| `dial.brand.configure` | Branding and custom domain | BRAND-001 | live (+ accounts) (+ gated) | not implemented |
| `dial.locale.configure` | Languages and time formats | LOCALE-001 | standard or live | not implemented |
| `dial.route.route` | Routing forms; Routing rules and outcomes; CRM-owner routing and lookup; Routing from existing website forms; Routing outcomes and follow-up | ROUTE-001, ROUTE-002, ROUTE-003, ROUTE-004, ROUTE-005 | standard or external (+ live) | not implemented |
| `dial.meet.provision` | Zoom meetings; Microsoft Teams meetings; Other conferencing and readiness; Attendance facts from conferencing | MEET-001, MEET-002, MEET-003, MEET-004 | external (+ accounts) (+ gated) | not implemented |
| `dial.pay.manage` | Stripe connection; Paid booking confirmation; PayPal and Venmo; Deposits, refunds and cancellation or no-show fees; Packages, coupons and gift certificates; Sales tax, receipts and invoices; Payment reconciliation and accounting export; Priced and saved-card-fee approval | PAY-001, PAY-008, PAY-002, PAY-003, PAY-004, PAY-005, PAY-006, PAY-007 | money (+ external) (+ commitment) (+ gated) | not implemented |
| `dial.flow.configure` | Workflow builder; SMS reminders and confirmations; Post-meeting follow-ups; No-show handling; Host notifications in Slack and Microsoft Teams; Managed transactional SMS; Managed SMS allowance and exhaustion; Move to a workspace sender | FLOW-001, FLOW-002, FLOW-003, FLOW-004, FLOW-005, FLOW-006, FLOW-007, FLOW-008 | standard or live (+ external) (+ accounts) (+ gated) | not implemented |
| `dial.client.manage` | Client records | CLIENT-001 | standard (+ sensitive) (+ destructive) | not implemented |
| `dial.report.read_or_export` | Scheduling analytics; Host calendar view and booking workspace; Exports and scheduled reports | REPORT-001, REPORT-002, REPORT-003 | standard or external (+ sensitive) | not implemented |
| `dial.api.manage_credentials` | Public REST API; Webhooks; Machine-credential booking; Machine credential lifecycle; Machine action scope; Machine API resource doors; Machine command retries and limits; Scoped webhook subscriptions; Machine actor history and erasure; Machine metadata without restored authority | API-001, API-002, API-003, API-004, API-005, API-006, API-007, API-008, API-009, API-010 | standard or access (+ security) (+ external) | not implemented |
| `dial.agent.run_specialist` | Scoped scheduling agents; Exception negotiator; Unanswered-thread follow-up; Calendar drift reconciler; Meeting happened check; No-show recovery; Meeting follow-through; Pre-meeting brief; Scheduling assistant in email threads; Flexible holds and availability tuning; Voice booking through a contracted provider | AGENT-001, AGENT-002, AGENT-003, AGENT-004, AGENT-005, AGENT-006, AGENT-007, AGENT-008, AGENT-009, AGENT-010, AGENT-011 | standard or external (+ money) (+ commitment) (+ accounts) (+ gated) (+ access) (+ security) (+ destructive) (+ sensitive) (+ live) | not implemented |

**Resources.** `dial://hosts/{id}`, `dial://event-types/{id}`, `dial://schedules/{id}`, `dial://bookings/{id}`, `dial://occurrences/{id}`, `dial://requests/{id}`, `dial://polls/{id}`, `dial://clients/{id}`, `dial://deliveries/{id}`, `dial://payments/{id}`.

**Events.** `booking.created`, `booking.rescheduled`, `booking.cancelled`, `attendance.changed`, `request.changed`, `poll.changed`, `payment.changed`, `calendar.connection-health-changed.v1`, and Base policy/approval/review events.

**Prompts.** Scheduling week → SURFACE-013; negotiate alternatives → AGENT-002; reconcile calendars → AGENT-004; recover a no-show → AGENT-006; follow through → AGENT-007; prepare a brief → AGENT-008.

**Not tools, and why.** HOME-001, HOME-002, HOME-003: A person’s public presentation screen and an installation fact. DOCS-001: A person’s documentation and navigation screen. EMBED-001, EMBED-002, EMBED-003, EMBED-004: Device/browser installation and connector work. MOBILE-001, MOBILE-002: Device-only native and mobile-client work. INTEG-001, INTEG-002, INTEG-003, INTEG-004, INTEG-005, INTEG-006, INTEG-007, INTEG-008: Connector and marketplace integration work. MIGRATE-001, MIGRATE-006, MIGRATE-007, MIGRATE-002, MIGRATE-003, MIGRATE-004, MIGRATE-005: The import door and source-provider connectors.

**Limits.** Dial’s documented request rate, body, byte and per-record capacity bounds protect the installation. Business thresholds and provider spend caps are the company’s policy.

**Handoffs.** Listens for authorized lead, client and conversation records from Orbit, Handset and connected CRM systems; emits booking and request resource events to those specialists and to the company’s event router. The router belongs to Business.


#### SURFACE-001 — Registry of scheduling jobs

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-013

**Requirement.** The MCP registry maps every Core clause to the tool or non-tool reason listed below, with the same scheduling operation as the person’s door.

**Acceptance.**
1. The MCP registry maps every Core clause to the tool or non-tool reason listed below, with the same scheduling operation as the person’s door.
2. The Base conformance harness exercises this registry on Dial hosts, event types, bookings, requests, calendars and payment fixtures.

#### SURFACE-002 — Scheduling class computation

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006

**Requirement.** An internal draft, note, attendance edit, offered-time hold or reversible request update computes standard with the affected item count.

**Acceptance.**
1. An internal draft, note, attendance edit, offered-time hold or reversible request update computes standard with the affected item count.
2. A calendar write, invitation, email, SMS, voice call, CRM write or outside-visible offer computes external with recipient count and internal, known, new or public exposure from trusted recipient and event records.
3. Publishing availability, changing active routing or workflow rules, and changing the live booking surface computes live with the affected service.
4. A booking creation with no outside effect and the same creation with an invitation compute their respective classes from the current event, regardless of text in the request.

#### SURFACE-003 — Payment and sign-off classes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006

**Requirement.** A price, deposit, balance, refund, fee, paid package or invoice action computes money with amount, USD currency and processor counterparty from saved booking and payment terms.

**Acceptance.**
1. A price, deposit, balance, refund, fee, paid package or invoice action computes money with amount, USD currency and processor counterparty from saved booking and payment terms.
2. A switch-over sign-off or binding business commitment computes commitment with its value and counterparty; an internal scheduling draft without a binding decision does not.
3. Priced approval combines the applicable booking, money and outside-contact classes from the exact saved price and consent version, including a full-price change with an unchanged fixed deposit.

#### SURFACE-004 — People and credentials classes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-005, BASE-AGENT-006

**Requirement.** Inviting, removing, delegating or changing a person or an app/agent grant computes access with people and whether the change widens or narrows authority.

**Acceptance.**
1. Inviting, removing, delegating or changing a person or an app/agent grant computes access with people and whether the change widens or narrows authority.
2. Changing calendar, mail or webhook credentials or protective settings computes security with the setting and provider.
3. A credential rotation that also changes authority carries both security and access; self-escalation remains governed by Base.

#### SURFACE-005 — Provider setup classes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006, BASE-AGENT-008

**Requirement.** Creating an outside messaging, conferencing or paid-provider resource computes accounts with the provider.

**Acceptance.**
1. Creating an outside messaging, conferencing or paid-provider resource computes accounts with the provider.
2. A provider-held OAuth consent, hosted card entry, registration, identity verification or terms acceptance computes gated with the provider and step; an available provider API route follows company policy for its classes.
3. A response that changes the provider step to one it keeps for a person adds gated before that step runs, without treating an agent-supplied consent flag as provider evidence.

#### SURFACE-006 — Irreversible and sensitive scheduling data

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006

**Requirement.** Cancellation without Undo, personal erasure, irreversible external cleanup and replacing a populated installation compute destructive with the affected items.

**Acceptance.**
1. Cancellation without Undo, personal erasure, irreversible external cleanup and replacing a populated installation compute destructive with the affected items.
2. A read or write touching a regulated intake answer or bank/card/payroll identity computes sensitive with record count and data kind from the trusted field schema; a plain scheduling answer is not classified from untrusted text.
3. Erasing regulated intake carries destructive and sensitive together; reversibly closing a draft carries standard.

#### SURFACE-007 — Scheduling record resources

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-003

**Requirement.** Resource templates expose host, event type, availability schedule, booking and occurrence, alternative request, poll, client, delivery and payment reference records at the URI templates below.

**Acceptance.**
1. Resource templates expose host, event type, availability schedule, booking and occurrence, alternative request, poll, client, delivery and payment reference records at the URI templates below.
2. A booking write returns its booking resource; its read-back shows the chosen duration, zones, host and the current occurrence without the private manage token.
3. Resources for imported bookings distinguish source creation time, effective snapshot time and later native action time.

#### SURFACE-008 — Scheduling events and handoffs

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-010

**Requirement.** Booking, reschedule, cancellation, attendance, request, poll, payment and connection-health changes emit the typed event families below.

**Acceptance.**
1. Booking, reschedule, cancellation, attendance, request, poll, payment and connection-health changes emit the typed event families below.
2. Calendar-health events retain the transition state, reason and time required by CAL-006; agents and webhook consumers see the same event identity.
3. A lead or client handoff to Orbit, Handset or a connected CRM carries the scheduling record resource and only the subscriber’s permitted fields.

#### SURFACE-009 — Specialist prompts and agent jobs

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-013

**Requirement.** Prompts offer the seeded scheduling week, alternative-time negotiation, drift repair, no-show recovery, meeting follow-through and pre-meeting brief, referencing the corresponding Core and AGENT clauses.

**Acceptance.**
1. Prompts offer the seeded scheduling week, alternative-time negotiation, drift repair, no-show recovery, meeting follow-through and pre-meeting brief, referencing the corresponding Core and AGENT clauses.
2. A stranger given only the seed URL can discover the specialist jobs and their record inputs without repository instructions.

#### SURFACE-010 — Scheduling capacity and spend

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-011

**Requirement.** Capacity limits are the documented request rate, body, byte and per-record sizes; booking-volume targets remain OPER-007’s seeded capacity scenario.

**Acceptance.**
1. Capacity limits are the documented request rate, body, byte and per-record sizes; booking-volume targets remain OPER-007’s seeded capacity scenario.
2. SMS, mail, voice and model provider estimates feed the company’s spend policy, with no implied daily business-volume allowance.
3. The specialist usage view relates provider spend and class decisions to the scheduling jobs and affected records.

#### SURFACE-011 — Policy-dependent scheduling decisions

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-007, BASE-AGENT-013

**Requirement.** The fixture week runs under an all-autonomous company policy and a held company policy, with the decision and exact saved scheduling facts visible in each result.

**Acceptance.**
1. The fixture week runs under an all-autonomous company policy and a held company policy, with the decision and exact saved scheduling facts visible in each result.
2. In the held run, a changed offer, amount, recipient or consent version is evaluated again before execution, and a declined or expired decision leaves the booking unchanged.
3. The all-autonomous run completes the supported calls without a policy hold or policy refusal.

#### SURFACE-012 — Retry-safe specialist work

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-012

**Requirement.** A lost response during booking, reschedule, cancellation or provider dispatch is retried through MCP with the original business identity and produces one effect.

**Acceptance.**
1. A lost response during booking, reschedule, cancellation or provider dispatch is retried through MCP with the original business identity and produces one effect.
2. A stale booking occurrence or reschedule request reports a conflict and preserves the current booking; long import or report work exposes an access-scoped job resource.

#### SURFACE-013 — A stranger agent runs a scheduling week

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-013 · *Register:* R-42

**Requirement.** Starting from only the seed URL, the specialist reads a seeded host week, prepares and publishes an event, offers feasible alternatives, books one, reschedules another and cancels one through MCP, then reads the resulting calendar and delivery states.

**Acceptance.**
1. Starting from only the seed URL, the specialist reads a seeded host week, prepares and publishes an event, offers feasible alternatives, books one, reschedules another and cancels one through MCP, then reads the resulting calendar and delivery states.
2. The same week includes a deposit, paid approval, refund, intake erasure, revoked connection and a named-role refusal, with successful and unsafe paths read back.
3. Run the week under all-autonomous and held company policies; decisions match each policy and the held run’s signed-in person follows only the returned decision URLs.
4. Close the week by opening the scheduling report and archive and reconciling its bookings, amounts, anonymous audit, delivery results and provider references.

## Push further

### Push further: agents on the scheduling job

#### AGENT-001 — Scoped scheduling agents

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** A host or admin grants a named agent a scope of hosts, event types, invitees and scheduling actions, with quiet hours and an expiry; contacts per person and per day are company-policy facts for external calls.

**Acceptance.**
1. A host or admin grants a named agent a scope of hosts, event types, invitees and scheduling actions, with quiet hours and an expiry; contacts per person and per day are company-policy facts for external calls.
2. Scheduling drafts and reversible internal updates carry standard; sending messages or offered times carries external with recipient count and known or new counterparty; charges and refunds carry money with amount and currency; an irreversible cancellation carries destructive.
3. The company's policy decides each class; proposals and actions retain their evidence, rule and any person who acted, and the host can inspect the pending work and its outcome.
4. A missing or expired grant permits no out-of-scope effect; a person can edit or reject a pending proposal and Pause agents.

#### AGENT-002 — Exception negotiator

*Tier:* Core · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** For an alternative request, reply or urgent routing submission outside published availability, the agent reads working hours, all connected calendars, explicitly movable holds, travel buffers, booking caps and invitee windows, and prepares up to three feasible times with each trade-off.

**Acceptance.**
1. For an alternative request, reply or urgent routing submission outside published availability, the agent reads working hours, all connected calendars, explicitly movable holds, travel buffers, booking caps and invitee windows, and prepares up to three feasible times with each trade-off.
2. Offering those times through LINK-002 carries external; holding and booking them through BOOK-012 carry standard, adding money when a charge is involved, and the company's policy decides those calls.
3. Under the held company policy, the host accepts two proposed times and rejects another; only those two reach the invitee, accepting one books it and releases the other.

#### AGENT-003 — Unanswered-thread follow-up

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** For offered times, alternative requests, polls and approval requests that are still open, the agent sends at most the granted number of follow-ups at the granted spacing, adapts to replies (a new window, a decline, a delegate's address), closes the thread when the person books or declines, and tells the host when it stops and why. It reads only Dial's own records and replies sent to the agent's thread address under the host's grant; that address is separate from the product sender of `NOTIFY-006`, which Dial still never reads.

**Acceptance.**
1. For offered times, alternative requests, polls and approval requests that are still open, the agent sends at most the granted number of follow-ups at the granted spacing, adapts to replies (a new window, a decline, a delegate's address), closes the thread when the person books or declines, and tells the host when it stops and why. It reads only Dial's own records and replies sent to the agent's thread address under the host's grant; that address is separate from the product sender of `NOTIFY-006`, which Dial still never reads.
2. Follow-ups carry external with recipients and contact counts; adapting a draft or closing an internal thread carries standard, and the company's policy decides each call.
3. Under a company policy allowing two contacts, an unanswered offer receives one after two days and a final one after five; an intervening booking cancels the remainder, a decline closes it with a host note, and the policy contact limit is respected.

#### AGENT-004 — Calendar drift reconciler

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** The agent continuously compares each booking's canonical time, host, attendees and conference with every calendar copy and conference provider: events moved or deleted outside Dial, duplicate events after a provider outage, missing conferences, stale attendee lists after reassignment, revoked tokens and lapsed subscriptions.

**Acceptance.**
1. The agent continuously compares each booking's canonical time, host, attendees and conference with every calendar copy and conference provider: events moved or deleted outside Dial, duplicate events after a provider outage, missing conferences, stale attendee lists after reassignment, revoked tokens and lapsed subscriptions.
2. Repairs to a calendar or conference carry external, adding destructive when removing an unrecoverable copy; adopting a new booking time carries standard and external, and the company's policy decides whether a proposed repair runs or is held.
3. The result is read back from the provider: a duplicate caused by a lost response is removed, a missing Zoom meeting is recreated with one link-ready email, and under the held company policy an external time edit is adopted after the named person acts, with one change notice.

#### AGENT-005 — Meeting happened check

*Tier:* Core · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** After a meeting the agent assembles conferencing attendance from MEET-004, calendar response, cancellation or late reschedule and host notes; it records its evidence and uncertainty for attended, no-show, late or rescheduled-in-meeting, and missing evidence is unknown.

**Acceptance.**
1. After a meeting the agent assembles conferencing attendance from MEET-004, calendar response, cancellation or late reschedule and host notes; it records its evidence and uncertainty for attended, no-show, late or rescheduled-in-meeting, and missing evidence is unknown.
2. Writing BOOK-011 attendance carries standard, adding commitment if the mark is a sign-off others rely on; the company's policy decides whether the result is filed or held for a person.
3. Under the held company policy, a Zoom attendance fixture and an empty report produce the corresponding proposals and only the signed-in host decision writes the mark.

#### AGENT-006 — No-show recovery

*Tier:* Core · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** For a confirmed no-show, the agent prepares a recovery message from the stated purpose and answers, offers real open times, and applies the host’s next-booking deposit and no-show policy.

**Acceptance.**
1. For a confirmed no-show, the agent prepares a recovery message from the stated purpose and answers, offers real open times, and applies the host’s next-booking deposit and no-show policy.
2. A recovery send carries external and a fee carries money with the shown amount; the company's policy decides each call, and under the held company policy the host confirms the message and fee.
3. Rebooking, decline, opt-out or the company contact limit stops recovery, and scheduling consent never becomes marketing consent.

#### AGENT-007 — Meeting follow-through

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** With every participant’s consent recorded, the agent reads the transcript or recap from connected Zoom, Teams, Meet or a recording service and prepares decisions and action items, each cited to a transcript span; an uncited item is refused.

**Acceptance.**
1. With every participant’s consent recorded, the agent reads the transcript or recap from connected Zoom, Teams, Meet or a recording service and prepares decisions and action items, each cited to a transcript span; an uncited item is refused.
2. Follow-through includes the recap email, offered times at the agreed cadence, owner input reminders and CRM update.
3. Internal drafts carry standard, sending or updating an outside CRM carries external, and a binding sign-off carries commitment; the company's policy decides each call.
4. Under the held company policy, the host edits the recap before the policy permits its send, and the next meeting is offered as times the invitee books.

#### AGENT-008 — Pre-meeting brief

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** The host’s granted invitee answers, earlier Dial meetings and follow-through, routing outcome and matched Orbit, HubSpot or Salesforce record form a brief with a source link for each fact; excluded sources are absent.

**Acceptance.**
1. The host’s granted invitee answers, earlier Dial meetings and follow-through, routing outcome and matched Orbit, HubSpot or Salesforce record form a brief with a source link for each fact; excluded sources are absent.
2. Missing intake answers are flagged, and a request through the manage link carries external under the company's policy; in the held company policy a person approves one such request.

#### AGENT-009 — Scheduling assistant in email threads

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007 · *Register:* R-38

**Requirement.** A host copies the dedicated assistant inbound address, separate from NOTIFY-006’s unread sender, on a thread; the assistant reads only that thread and uses real availability in its language and zone, handles replies and counter-proposals, and books an agreed time with one invitation and thread update.

**Acceptance.**
1. A host copies the dedicated assistant inbound address, separate from NOTIFY-006’s unread sender, on a thread; the assistant reads only that thread and uses real availability in its language and zone, handles replies and counter-proposals, and books an agreed time with one invitation and thread update.
2. The thread message carries external and the booking carries standard, adding money for a charge; the company's policy decides each call, including the first message.
3. Under the held company policy a host approves three offered times, an in-availability counter-proposal books after its policy decision, and an unknown sender outside the thread grant is ignored.

#### AGENT-010 — Flexible holds and availability tuning

*Tier:* Core · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** For a high-priority event, an agent moves only a Dial-created focus, admin or travel-prep block the host marked flexible, within its allowed range, and re-places it after opening the requested time; a non-flexible event is unchanged.

**Acceptance.**
1. For a high-priority event, an agent moves only a Dial-created focus, admin or travel-prep block the host marked flexible, within its allowed range, and re-places it after opening the requested time; a non-flexible event is unchanged.
2. Monthly evidence can suggest availability, buffer and limit changes, including widening afternoons that fill first or buffers after long meetings.
3. Calendar changes carry external and availability-setting changes carry live; the company's policy decides each call, and under the held company policy a proposed setting changes only after the host accepts it.

#### AGENT-011 — Voice booking through a contracted provider

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-MAIL-001, BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** Hosts may connect a voice provider (Twilio Programmable Voice with an AI voice service the host contracts) so callers can book, reschedule or cancel by phone and receive reminder calls. Dial supplies availability, booking and manage actions through `API-001`; the call identifies itself as automated, follows the host's grant and TCPA rules for outbound calls, and every booking it makes is an ordinary booking with an SMS or email confirmation. Dial is not a phone system: numbers, IVR and recording live with the provider.

**Acceptance.**
1. Hosts may connect a voice provider (Twilio Programmable Voice with an AI voice service the host contracts) so callers can book, reschedule or cancel by phone and receive reminder calls. Dial supplies availability, booking and manage actions through `API-001`; the call identifies itself as automated, follows the host's grant and TCPA rules for outbound calls, and every booking it makes is an ordinary booking with an SMS or email confirmation. Dial is not a phone system: numbers, IVR and recording live with the provider.
2. A call or notice carries external, creating a provider account carries accounts, a provider registration or consent it keeps for a person carries gated, and booking or cancellation takes the corresponding scheduling classes; the company's policy decides the calls.
3. A synthetic provider transcript requesting Tuesday at 3 p.m. books one valid slot, an unavailable time returns alternatives, and an outbound reminder without the required consent is refused.

## Field proof register

| ID | Proof | Clauses | State | Date | Receipt |
| --- | --- | --- | --- | --- | --- |
| R-1 | Real Zoom and Teams accounts provision a unique meeting per booking. | EVENT-004 | not run | | |
| R-2 | Published Chrome Web Store and Microsoft Edge Add-ons listings install and authenticate. | EMBED-002 | not run | | |
| R-3 | The published AppSource add-in installs in a real Microsoft 365 tenant and inserts held times. | EMBED-003 | not run | | |
| R-4 | The published Marketplace add-on installs in a real Google Workspace domain and inserts held times. | EMBED-004 | not run | | |
| R-5 | TestFlight and Play internal-track builds pass on physical devices. | MOBILE-002 | not run | | |
| R-6 | A real busy event in a selected conflict calendar removes the overlapping slot and refuses its confirmation. | BOOK-001 | not run | | |
| R-7 | A real Google Calendar and Zoom account show the managed event and meeting moved in place, not recreated, after the invitee picks. | BOOK-014, BOOK-016, BOOK-017 | not run | | |
| R-8 | The owner's own Google project consents and returns a refresh token; the dedicated test calendar checks healthy with Meet capability. | CAL-001 | not run | | |
| R-9 | The event appears in the real destination calendar within 60 seconds and Google invites the invitee with a real Meet link. | CAL-003 | not run | | |
| R-10 | Revoking Dial's access makes the deployed connection unhealthy within one scheduled pass. | CAL-006 | not run | | |
| R-11 | Google opens a push channel to the deployed callback and the scheduled pass renews it. | CAL-007 | not run | | |
| R-12 | Deleting Dial's event in Google Calendar cancels the booking once with one notice each. | CAL-008 | not run | | |
| R-13 | Live Graph acceptance needs the held Entra app, a licensed mailbox and an Entra-console redirect URI in a later local round; no live work or personal mailbox read is claimed. | CAL-010 | not run | | |
| R-14 | A real iCloud account with an app-specific password shows busy time and receives the event. | CAL-011 | not run | | |
| R-15 | A real Zoom account receives one meeting per booking and its deletion on cancel. | MEET-001 | not run | | |
| R-16 | A real Microsoft 365 tenant creates the Teams meeting. | MEET-002 | not run | | |
| R-17 | A Stripe Connect platform completes a real OAuth grant and its webhook delivers to a deployed Dial; an ACH Direct Debit payment completes end to end. | PAY-001, PAY-008 | not run | | |
| R-18 | The real inbox receives the confirmation with both MIME parts and the `.ics` attachment. | NOTIFY-001 | not run | | |
| R-19 | The invitee receives the real Meet link exactly once. | NOTIFY-002 | not run | | |
| R-20 | The deployed Cron Trigger delivers the 1-hour reminder within 5 minutes. | NOTIFY-003 | not run | | |
| R-21 | A real bounce arrives through SendGrid's signed Event Webhook and marks the delivery failed. | NOTIFY-005 | not run | | |
| R-22 | Revoking access produces one alert and reconnecting one recovery email in the real inbox. | NOTIFY-007 | not run | | |
| R-23 | In a two-host deployment the real inboxes show host B received nothing for host A's booking. | NOTIFY-008, NOTIFY-011, NOTIFY-012 | not run | | |
| R-24 | A real Google and Microsoft 365 calendar show the templated title and description. | NOTIFY-009, NOTIFY-013, NOTIFY-014 | not run | | |
| R-25 | In a real Gmail and Outlook.com inbox the confirmation shows the host's name as sender and Reply addresses the host; an invitee's reply arrives in the host's own mailbox; a mailbox-sent confirmation appears in the host's Gmail Sent folder. | NOTIFY-010, NOTIFY-015 | not run | | |
| R-26 | A registered 10DLC test number delivers a reminder to a real handset and honors STOP. | FLOW-002 | not run | | |
| R-27 | A real Slack workspace and Teams tenant receive the notices. | FLOW-005 | not run | | |
| R-28 | A real handset receives a managed-sender reminder from a fresh workspace, and STOP is honored. | FLOW-006, FLOW-007, FLOW-008 | not run | | |
| R-29 | A real receiver (Handset staging) verifies one signed delivery and one replay, and one real agent run creates, reschedules and cancels a booking with a scoped credential. | API-003, API-004, API-005, API-006, API-007, API-008, API-009, API-010 | not run | | |
| R-30 | Published Zapier and Make apps pass their platform review. | INTEG-001 | not run | | |
| R-31 | The recorded evidence entries show each verification or listing approved with matching scopes. | INTEG-005 | not run | | |
| R-32 | A real Intercom workspace shows the booking note on the conversation. | INTEG-007 | not run | | |
| R-33 | A real Dynamics 365 Sales environment shows the appointment on the contact. | INTEG-008 | not run | | |
| R-34 | A real owner-supplied Calendly export previews and imports. | DATA-003, DATA-013, DATA-014, DATA-015, DATA-016, DATA-017 | not run | | |
| R-35 | A real Calendly organization export previews and imports. | MIGRATE-001, MIGRATE-006, MIGRATE-007 | not run | | |
| R-36 | A real Acuity account previews and imports. | MIGRATE-002 | not run | | |
| R-37 | A real Microsoft 365 tenant with a Bookings business imports. | MIGRATE-003 | not run | | |
| R-38 | A real inbox thread receives the proposal and the booked invitation. | AGENT-009 | not run | | |
| R-39 | A dated human screen-reader pass on the operator and public journeys. | MOBILE-001, DOCS-001 | not run | | |
| R-40 | A dated VPAT for the shipped operator and public surfaces. | MOBILE-001, DOCS-001 | not run | | |
| R-41 | A real vendor tenant proves SAML, OIDC and SCIM interoperability; run-auth remains the gating standards fixture. | ADMIN-001 | not run | | |
| R-42 | Claude, ChatGPT, Codex and Copilot clients each complete the scheduling-specialist MCP journey. | SURFACE-013 | not run | | |

| R-43 | Real outgoing mail uses the configured provider: an installer supplies its credentials and verified sender, checks connection readiness, and proves delivery by receiving the native sign-in link and booking or request mail in the intended real mailbox. | OPER-005 | not run | | |

## Boundaries

What Dial does not do, and how a buyer gets it:

- **Calendar and conferencing providers.** Dial is not a calendar or video service and cannot guarantee another provider's uptime. It uses Google Calendar, Microsoft Graph, CalDAV, Zoom, Webex and GoTo APIs under the host's own accounts, shows connection health, and fails closed rather than offering unverified time.
- **Phone system, SMS network and meeting recording.** Dial is not a carrier, phone system, IVR or notetaker. SMS goes through RER Managed SMS or the workspace's own Twilio account and registered campaign (`FLOW-006`, `FLOW-002`); voice booking through a voice provider the host contracts (`AGENT-011`); transcripts and recordings come from Zoom, Teams, Meet or a recording service the host connects (`AGENT-007`). Business phone systems are not a Dial product.
- **Payment processing.** Dial never touches card numbers or holds funds. Payments, refunds, payouts, disputes and US sales-tax calculation run in the host's own Stripe or PayPal account; Dial reconciles their events and exports to QuickBooks Online, Xero or Pantry. Sales-tax filing and remittance stay with the host's accountant or tax service.
- **CRM and marketing.** Client records are a scheduling history. Deals, pipelines and sales activity live in Orbit, HubSpot, Salesforce or Pipedrive; newsletters, campaigns and marketing SMS live in Mango or the buyer's marketing tool. Dial's own messages are transactional or follow-ups the invitee was told about.
- **Clinical and regulated scheduling.** Dial does not claim HIPAA compliance or sign business associate agreements by default and is not an EHR. Clinics use Balm; other regulated buyers keep sensitive intake in their contracted system and use data-minimizing questions in Dial.
- **Studios, restaurants, shifts and field service.** Memberships and class operations (Strap), table reservations (Placemat), hourly shift scheduling (Lanyard) and technician dispatch (Glove) are separate products. Dial's group events, packages and round-robin serve general appointments and meetings.
- **Marketplace discovery.** Dial publishes the host's own pages; it runs no consumer marketplace, ratings or invitee-submitted reviews.
- **Automatic adoption of external edits.** Dial never silently adopts an arbitrary external calendar edit to a booking's time or location; the drift reconciler proposes and a person decides (`CAL-008`, `AGENT-004`).
- **Ranking without a model.** Slot recommendations stay deterministic (`AVAIL-007`); agents propose to people and never re-rank public slots.
- **US first.** Prices and payments are USD; SMS follows US TCPA, CTIA and A2P 10DLC rules; holidays are US federal holidays; invitee-facing languages are the seven of `LOCALE-001`, and the operator app is English. Other currencies, tax regimes and messaging rules come after.

## Homepage claims

| # | Claim | Clauses |
| --- | --- | --- |
| 1 | A booking page that checks your live calendar, speaks every timezone and never asks invitees to sign up. | AVAIL-004, AVAIL-005, PUBLIC-002 |
| 2 | 100% free, open source alternative to Calendly, Acuity Scheduling and SavvyCal. | HOME-002, OPER-005 |
| 3 | Free and open source, MIT licensed. | HOME-002 |
| 4 | Invitees pick a day, see up to five suggested times, each with the reason it was picked, and book in their own timezone without an account. | PUBLIC-001, AVAIL-007, AVAIL-005, PUBLIC-002 |
| 5 | The private link in their confirmation lets them reschedule or cancel. | BOOK-006, BOOK-007, BOOK-008 |
| 6 | Dial reads your calendar again and books the time only if it is still free; each time can be booked only once. | BOOK-001, BOOK-002 |
| 7 | If your calendar can’t be read, Dial offers no times rather than guess. | AVAIL-004 |
| 8 | Weekly windows, date overrides, buffers, minimum notice, a daily limit and daylight saving are all handled. | AVAIL-001, AVAIL-002, AVAIL-003, AVAIL-006 |
| 9 | Google Calendar and Meet: busy times block availability and each booking lands on your calendar with a Meet link when selected. | CAL-001, CAL-003, AVAIL-004 |
| 10 | Every confirmation offers an .ics file so invitees on any calendar can add the booking. | CAL-009 |
| 11 | Confirmations and changes say what happened; a pending meeting link is disclosed and arrives in one later email. | NOTIFY-001, NOTIFY-002, NOTIFY-004 |
| 12 | Invitees and your team hear from Dial a day before and an hour before. | NOTIFY-003, NOTIFY-008, NOTIFY-011 |
| 13 | Invitees send dates and windows that suit them; nothing is reserved until you book one and they hear back by email. | REQUEST-001, REQUEST-002, REQUEST-003, REQUEST-005 |
| 14 | You hold the data, the look and the code, and nothing phones home. | HOME-002, DATA-001 |
| 15 | One Worker with its database, file storage and queues. | OPER-005 |
| 16 | Every booking, answer and setting in a local install goes into one private archive. | DATA-001 |
| 17 | Restore into a fresh empty install, with new sign-ins and nothing replayed. | DATA-009 |
| 18 | Read the code and change anything, from the wording to the booking flow. | HOME-002, EDITOR-001 |
| 19 | Open source, built for real calendars, and yours to run. | HOME-002, CAL-001, OPER-005 |

## Status

Judged from the code and tests at commit `5b1566c093dd06610c98d534c685f9390aba9ff1` (27 October 2026).

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 7 | 84 | 0 | 91 |
| Target and push further | 2 | 46 | 84 | 132 |
| All | 9 | 130 | 84 | 223 |

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `AUTH-001` | Public authority | published | partial | `tests/operator-auth-boundary.test.mjs`, `tests/operator-management.test.mjs`, `tests/booking-http.test.mjs`, `tests/request-json-boundary.test.mjs` ("copy-report input validation rejects malformed JSON and wrong shapes without writes, then accepts the native report"), `tests/portability-status.test.mjs` | Missing a private-door journey covering host/team ownership and scoped API credentials alongside every new public capability; the cited journeys exercise native-session and invitation/manage boundaries. |
| `AUTH-002` | Booking nonce | published | partial | `tests/booking-http.test.mjs` | Missing the alternative-request acknowledgement-delivery read after nonce expiry; the cited booking journey checks selected-slot binding, reload, expiry and confirmation replay. |
| `AUTH-003` | Booking access | published | partial | `tests/embed-document-authorization.test.mjs` | Missing a journey attempting guessed booking IDs and invitee emails for both read and mutation and reconciling unchanged booking state; the cited embed journeys exercise embed and manage projections. |
| `AUTH-004` | Calendar authorization callback | published | partial | `tests/providers-runtime.test.mjs` | Missing a successful session-bound callback with all missing, mismatched, replayed and expired state cases and credential-state read-back; the cited runtime journey attempts a forged callback only. |
| `AUTH-005` | Provider callbacks | published | partial | `tests/providers-runtime.test.mjs`, `tests/mail-connection.test.mjs` | Missing the complete authenticated calendar callback and refusal/no-change pair in the cited evidence; forged callback refusal and mail-provider authentication are exercised. |
| `AUTH-006` | First-owner admission | published | done | `tests/managed-admission.test.mjs` — "signed admission verifies before authority writes, commits one native owner, and stays consumed after restart and retirement" |  |
| `OPER-001` | Roles and permissions | published | partial | `tests/operator-management.test.mjs`, `tests/local-setup-journey.test.mjs`, `src/core/features/operators/service.ts` | The cited paths cover part of the clause; the rest is still to build. |
| `OPER-008` | Role-scoped booking mail | published | partial | `tests/operator-management.test.mjs`, `tests/local-setup-journey.test.mjs`, `src/core/features/operators/service.ts` | The cited paths cover part of the clause; the rest is still to build. |
| `OPER-009` | Role-scoped reporting | published | partial | `tests/operator-management.test.mjs`, `tests/local-setup-journey.test.mjs`, `src/core/features/operators/service.ts` | The cited paths cover part of the clause; the rest is still to build. |
| `OPER-002` | Operator invitations and roles | published | partial | `tests/operator-management.test.mjs`, `tests/operator-removal-mail.test.mjs`, `tests/operator-access-migration.test.mjs` | Missing owner/admin/team-manager/member/viewer invitation and role-change journeys; the cited native journeys cover equal-owner invitation and removal only. |
| `OPER-010` | Destructive operator removal | published | done | `tests/operator-management.test.mjs` — "native destructive management preserves authorship and protects self and setup owner" |  |
| `OPER-003` | Booking workspace | published | partial | `tests/bookings-filters.test.mjs`, `tests/bookings-search-upgrade.test.mjs` | Single-host 100,000-booking fixture; capacity fixture missing. |
| `OPER-004` | Booking record | published | done | `tests/booking-axe/acceptance-records.mjs` — "bookingRecordDeliveryJourney" |  |
| `EDITOR-001` | Owner editor | published | partial | `scripts/verify-managed-editor.mjs` | Missing one complete role-scoped editor journey with grant refusal, application restart, conflict and owner customization read-back; the cited managed-editor runner exercises its current owner path. |
| `OPER-005` | First-run checklist | published | partial | `tests/first-run.test.mjs`, `tests/host-setup-journey.test.mjs` | Missing one complete first-run journey spanning native hosted admission, all readiness variants, verified provider delivery and clipboard recovery; cited journeys cover request-only setup and local authoring. |
| `OPER-011` | Durable setup completion | published | partial | `tests/first-run.test.mjs`, `tests/host-setup-journey.test.mjs` | Missing a single completion lifecycle journey joining reinvitation, setup rerun, archive restore, post-completion edits and reset with the durable marker read back; native first-run gate and completion are exercised. |
| `PROFILE-001` | Host profile | published | partial | `src/core/features/host-profile/profile-writes.ts`, `scripts/verify-profile-authoring.mjs`, `tests/runtime.test.mjs` | Missing a complete host-profile journey covering every profile field and public visibility after edits without changing existing booking snapshots; cited native authoring covers the coherent single-host identity. |
| `PROFILE-002` | Public profile | published | partial | `tests/booking-http.test.mjs`, `src/core/features/host-profile/public.ts` | Missing a populated public-profile journey comparing listed and unlisted events and private-field absence; the cited booking journey reads a selected event DTO. |
| `PROFILE-003` | Avatar asset | published | done | `tests/avatar.test.mjs` — "native Worker avatar admission, replacement, public inline serving, removal and original-byte restore" |  |
| `EVENT-001` | Event type lifecycle | published | partial | `tests/runtime.test.mjs`, `tests/event-status-trigger.test.mjs`, `tests/booking-wire/duration-journey.mjs`, `tests/booking-wire/location-journey.mjs`, `src/core/features/event-types/duplicate.ts` | Missing capacity, reusable team-template and workflow-attachment duplication through the event lifecycle; native duration, slug and single-host draft duplication are exercised. |
| `EVENT-002` | Scheduling constraints | published | partial | `scripts/verify-availability-diagnostics.mjs`, `tests/availability-diagnostics.test.mjs`, `migrations/core/0052_booking_horizons.sql`; browser: `evidence/contract/2026-10-17/EVENT-002/` | Missing one complete constraints journey covering every configured start increment, notice and horizon variant through offered slots and final confirmation; diagnostics cover representative constraint cases. |
| `EVENT-003` | Invitee questions | published | partial | `scripts/verify-question-defaults.mjs`, `tests/availability-diagnostics.test.mjs`, `migrations/core/0051_phone_dropdown_questions.sql`; browser: `evidence/contract/2026-10-17/EVENT-003/` | Missing a complete ordered-question journey exercising every declared question type, options, limits and final stored answer; cited native defaults and phone/dropdown probes cover a subset. |
| `EVENT-004` | Locations | published | partial | `tests/booking-wire/location-journey.mjs`, `src/core/features/event-types/locations.ts`, `src/core/features/public-booking/ui/booking-location.tsx` | Missing the Zoom/Teams/Webex/GoTo and round-robin/collective location journey; the cited journey covers native one-on-one location choices and phone/Ask-invitee values. |
| `EVENT-005` | Removing an event type | published | partial | `tests/event-status-trigger.test.mjs` | Missing a populated booking’s snapshot, manage, calendar and history read-back after event deletion; the cited journey disables an event and checks unavailable pages and invalidated copy reports. |
| `EVENT-006` | Publication readiness | published | partial | `tests/availability-diagnostics.test.mjs`, `tests/host-setup-journey.test.mjs`, `tests/booking-axe/request-only.mjs` | Missing one publication/readiness journey covering every provider-generated conferencing option and post-publication failure; native single-host authoring and request-only guards are exercised. |
| `HOME-001` | Installed Lobby | published | partial | `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/public-site.mjs`, `tests/runtime.test.mjs` | Missing the installed Lobby’s complete setup-state transition with saved-profile-only and no-storage assertions in one cited journey; public-site and runtime checks cover the initial public projections. |
| `HOME-002` | Product run site | published | partial | `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/public-site.mjs`, `tests/runtime.test.mjs` | Missing one complete run-site journey checking every stated hero, metadata, navigation, no-installation-data and reduced-motion outcome; cited public-site checks cover representative rendering and navigation. |
| `HOME-003` | Installed public chrome | published | partial | `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/public-site.mjs`, `tests/runtime.test.mjs` | Missing installed-docs public chrome under both configured-owner and footer-credit settings; the cited public-site journey exercises the run-site variant. |
| `DOCS-001` | Public documentation | published | partial | `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `src/core/features/public-site/docs/build/manifest.ts` | Missing a complete published-docs journey covering every manifest page, recovery response, build-only Markdown boundary and navigation outcome; cited browser and manifest code cover parts. |
| `PUBLIC-001` | Event presentation | published | partial | `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/day-picker.mjs` | Missing a full event-presentation journey that reads the enforced change-window text alongside the day/slot projection; day-picker journeys reconcile suggestions and the native slots. |
| `PUBLIC-002` | Invitee-first flow | published | partial | `tests/embed-document-authorization.test.mjs` | Missing account-free booking with a read-back of the configured privacy notice and named answer recipients; cited embed journeys compare public projections and capabilities. |
| `PUBLIC-003` | Progress and recovery | published | partial | `tests/host-setup-journey.test.mjs`, `tests/ux-simplification.test.mjs` | Missing a complete reload/back and unknown, expired and rotated capability recovery journey with private-data absence checked in each resulting page; cited SSR and setup journeys cover subsets. |
| `PUBLIC-004` | Embed | published | partial | `tests/embed-document-authorization.test.mjs`, `src/core/features/embeds/snippet.ts` | Missing an actual standalone-versus-inline-versus-modal booking lifecycle with the shipped asynchronous snippet and measured compressed size; cited journeys cover authorized embed documents and manage actions. |
| `PUBLIC-005` | Unavailable pages | published | partial | `tests/embed-document-authorization.test.mjs` | Missing every unavailable-page state with page content and no private or sample data checked; cited embed journeys cover unpublished and unknown embedded events. |
| `PUBLIC-006` | Abuse | published | partial | `tests/public-blocking.test.mjs`, `tests/public-admission.test.mjs` | Missing the multi-role block-list refusal and audit journey; native blocking/admission journeys cover owner blocks, races and replay. |
| `AVAIL-001` | Schedule and overrides | published | partial | `tests/availability-diagnostics.test.mjs`, `src/core/features/event-types/recurring-writes.ts`, `src/core/features/event-types/override-writes.ts` | Missing a complete public-slots journey reading all weekly and date-override combinations after operator editing; diagnostics cover representative rule exclusions. |
| `AVAIL-002` | Valid slots | published | partial | `tests/dst-native.test.mjs`, `tests/booking-wire.test.mjs`, `tests/providers-d1.test.mjs` | Missing one whole validity journey combining every calendar, conflict, host-day, duration and horizon rule at the public final-confirmation door; native DST, calendar cache and booking journeys cover subsets. |
| `AVAIL-003` | Buffers | published | partial | `tests/availability-diagnostics.test.mjs`, `src/core/features/availability/engine.ts` | Missing the full before/after-buffer journey across the host’s event types with offered-time and final-confirmation read-back; cited diagnostics exercise representative buffer exclusion. |
| `AVAIL-004` | Freshness and failure | published | partial | `tests/lifecycle-journey.test.mjs`, `tests/host-setup-journey.test.mjs` | Missing the complete freshness/failure journey joining all stale, slow, failed and recovered provider states with both availability and final booking results; lifecycle and setup journeys cover native outage and recovery. |
| `AVAIL-005` | Timezones | published | partial | `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/timezone.mjs` | Missing the full timezone journey through details, receipt, manage, calendar and mail at both browser widths; the cited timezone helper exercises picker choice, navigation and reload at 390. |
| `AVAIL-006` | Daylight saving time | published | partial | `tests/dst-native.test.mjs`, `src/core/features/availability/timezone.ts` | Missing a complete public spring-forward and fall-back journey with each promised display and valid-slot behavior read back; the cited native DST helper checks containment and fold booking. |
| `AVAIL-007` | Recommendations and filters | published | done | `tests/booking-axe/day-picker.mjs` — "dayPickerJourney" |  |
| `AVAIL-008` | Response time | published | partial | `tests/booking-axe/acceptance-capacity.mjs` | Single event type; team kinds at capacity missing. |
| `AVAIL-009` | Operator diagnostics | published | partial | `tests/availability-diagnostics.test.mjs` | Missing one diagnostics journey reading every declared exclusion and the corresponding corrected public result; the cited native diagnostics cover representative reasons. |
| `BOOK-001` | Final validation | published | partial | `tests/lifecycle-journey.test.mjs`, `tests/availability-diagnostics.test.mjs` | Missing the complete final-validation journey covering every configured rule and failed-provider state with no booking or queued effect; native selection-refresh and lifecycle journeys cover representative conflicts. |
| `BOOK-002` | Atomic claim | published | done | `tests/booking-lifecycle.test.mjs` — "one of fifty real Worker/D1 callers claims an overlap and records its calendar command atomically" |  |
| `BOOK-003` | Idempotent confirmation | published | partial | `tests/lifecycle-journey.test.mjs` | Missing the entire canonical-identical replay and changed-payload refusal through one cited lifecycle with stored booking and delivery outcomes reconciled; the native lifecycle exercises replay scenarios. |
| `BOOK-004` | States and occurrences | published | partial | `tests/occurrence-mail-duration.test.mjs` ("occurrence-specific mail facts survive an actual 30-to-60-minute reschedule on migrated native D1"), `tests/booking-wire.test.mjs` | Missing the complete occurrence lifecycle journey reconciling all historical and current states after create, reschedule and cancel; cited duration and wire journeys cover current-occurrence mail and calendar behavior. |
| `BOOK-005` | Confirmation receipt | published | partial | `tests/booking-wire.test.mjs`, `tests/booking-axe/booking.mjs`, `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile") | Missing a complete receipt journey reading every required time, location, state, private link and delayed-link outcome; cited wire/browser journeys exercise representative confirmation views. |
| `BOOK-006` | Manage link | published | partial | `tests/embed-document-authorization.test.mjs`, `src/core/features/bookings/manage-capability.ts` | Missing all private-manage capability generation, rotation, expiry and invalid-access outcomes reconciled against unchanged booking state in the cited journey set; embedded manage actions are exercised. |
| `BOOK-007` | Invitee rescheduling | published | partial | `tests/lifecycle-journey.test.mjs`, `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile") | Missing one complete invitee reschedule journey that reads atomic preservation of the old booking on every unsafe condition and reconciles the new occurrence and all notices; lifecycle and browser journeys cover ordinary move and conflict. |
| `BOOK-008` | Invitee cancellation | published | partial | `tests/lifecycle-journey.test.mjs`, `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile") | Missing the full cancellation journey reading irreversible state, prompt slot/buffer release and unchanged state on unsafe authority; lifecycle/browser journeys cover ordinary cancellation and replay. |
| `BOOK-009` | Operator changes | published | partial | `tests/operator-change.test.mjs`, `tests/move-in-booking-actions.test.mjs` | Missing multi-role operator-change refusals and their audit records alongside override reasons read back; native owner reschedule and imported-booking actions are exercised. |
| `BOOK-010` | History | published | partial | `tests/booking-wire.test.mjs`, `src/core/features/bookings/service.ts` | Missing one user-door history read after every stated booking action, including actor, previous/new values and reasons; wire lifecycle and service implementation cover native action recording. |
| `BOOK-011` | Attendance | published | partial | `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/keyboard-bookings.mjs`, `tests/move-in-runtime.test.mjs`, `tests/person-erasure.test.mjs` | Missing the complete attendance journey, including role-scoped mark changes and reason/history read-back; cited browser, import and erasure journeys cover native marks and retention. |
| `BOOK-012` | Operator-created booking | published | partial | `tests/operator-creation-recovery.test.mjs`, `tests/operator-temporal.test.mjs` | Missing the complete role-scoped operator creation journey with every override reason and request-derived identity read back; cited native retry/recovery and temporal journeys cover owner creation. |
| `CAL-001` | Calendar connections | published | partial | `src/core/features/calendar-connection/service.ts`, `src/core/platform/calendar/google.ts`, `tests/lifecycle-journey.test.mjs`, `tests/providers-d1.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `CAL-002` | Busy privacy | published | partial | `tests/providers-d1.test.mjs`, `src/core/features/calendar-connection/busy-reader.ts` | Missing a public result read proving private calendar details absent from a nonempty busy-period fixture throughout the availability flow; provider-cache journeys exercise busy time reads. |
| `CAL-003` | Managed event | published | partial | `tests/booking-wire.test.mjs`, `tests/providers-d1.test.mjs`, `tests/lifecycle-journey.test.mjs`, `evidence/contract/2026-10-17/CAL-003/` | Missing one complete managed-event journey across all promised provider and template variants with the final provider payload reconciled; native Google event/Meet and retry journeys cover a subset. |
| `CAL-004` | Idempotent side effects | published | partial | `tests/booking-wire.test.mjs` | Missing a complete calendar/mail side-effect journey interrupting every dangerous provider-write boundary and reconciling resumed results; native wire journeys exercise selected lost-response reconciliation. |
| `CAL-005` | Provider failure | published | partial | `tests/booking-wire.test.mjs` | Missing every promised exhausted/uncertain provider failure outcome read through the booking record followed by explicit safe retry; wire journeys exercise native failure recovery. |
| `CAL-006` | Connection health | published | partial | `tests/lifecycle-journey.test.mjs`, `tests/export-restored-behavior.test.mjs` | Missing one complete connection-health lifecycle that reads every promised alert, transition reason, restored state and public availability result; cited scheduled and restore journeys exercise representative transitions. |
| `CAL-007` | Provider callbacks | published | partial | `tests/deletion-ordering.test.mjs`, `tests/coordination.test.mjs` | Missing the complete authenticated push-channel identity, duplicate, reordering and cursor journey with no-change refusal; cited deletion-ordering and coordination journeys cover ordering/failure cases. |
| `CAL-008` | External deletion and edits | published | partial | `tests/lifecycle-journey.test.mjs`, `tests/booking-wire.test.mjs` | Missing one external edit/deletion journey reading the canonical-versus-provider conflict and every operator resolution result; native lifecycle journeys exercise external deletion and reconciliation. |
| `CAL-009` | Calendar file | published | partial | `tests/calendar-file.test.mjs`, `src/core/features/bookings/calendar-file.ts` | Missing a complete calendar-file journey reading every stated field and cancellation/reschedule update after malformed-capability refusal; cited local capability download and attachment journey exercises representative occurrences. |
| `REQUEST-001` | Compose | published | partial | `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing"), `src/core/features/availability-requests/service.ts` | Missing a complete composition journey reading multiple selected windows, validation limits and review choices; cited request journey submits one representative window. |
| `REQUEST-002` | Submit | published | partial | `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing") | Missing the complete submit/acknowledgement lifecycle and disclosure checks after validation refusal; the cited journey checks one creation, stored private record and nonce replay. |
| `REQUEST-003` | Operator workflow | published | partial | `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing"), `tests/operator-creation-recovery.test.mjs` | Missing role-scoped request handling and full request-to-booking history read-back; cited owner request journey checks handling, close and erasure. |
| `REQUEST-004` | Routing | published | partial | `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing"), `src/core/features/availability-requests/repository.ts`, `src/core/features/event-types/ui/request-routing-fields.tsx` | Missing the two-host/team and lost-access recipient journey; cited request routing covers all/subset/suppressed equal-owner recipients with invalid configuration refusal. |
| `REQUEST-005` | Invitee updates | published | partial | `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing") | Missing a journey reading each invitee update’s content and exact delivery count for handling and closure; cited request journey reads private states but not each completed mail outcome. |
| `NOTIFY-001` | Booking confirmation | published | partial | `tests/booking-wire/correspondence-journey.mjs`, `tests/booking-wire.test.mjs`, `tests/booking-axe/confirmation-settings.mjs`, `tests/mail-preferences.test.mjs` ("per-operator booking mail respects saved delivery preferences and recipient scope across restart"), `tests/lifecycle-journey.test.mjs` | Missing a complete confirmation journey combining all recipient roles, template modes and calendar-success suppression with delivered payload reconciliation; cited journeys cover native single-host mail and preferences. |
| `NOTIFY-002` | Link completion | published | partial | `tests/booking-wire.test.mjs`, `tests/providers-d1.test.mjs` | Missing a complete immediate-versus-delayed link journey reading every recipient’s final message and delivery state; native wire/provider polling exercises one-time link-ready dispatch. |
| `NOTIFY-003` | Reminders | published | partial | `tests/lifecycle-journey.test.mjs`, `tests/coordination.test.mjs`, `src/core/features/bookings/reminder-commands.ts` | Missing the complete host/team reminder-recipient and changed-time lifecycle; cited scheduled lifecycle covers native single-host reminders and cancellation. |
| `NOTIFY-004` | Changes | published | partial | `tests/lifecycle-journey.test.mjs`, `tests/move-in-catch-up.test.mjs` | Missing all role-scoped recipient and changed-time content outcomes read back after cancellation, reschedule and source-release exceptions; cited lifecycle/catch-up journeys cover native notices. |
| `NOTIFY-005` | Delivery failure | published | partial | `tests/managed-mail.test.mjs`, `tests/lifecycle-journey.test.mjs`, `tests/booking-wire.test.mjs` | Missing a complete durable mail failure journey covering every promised permanent, bounce, throttled and uncertain state through the operator’s retry door; cited mail/lifecycle journeys cover selected provider failures. |
| `NOTIFY-006` | No mail loops | published | partial | `tests/deploy-adoption.test.mjs`, `tests/mail-readiness-workerd.test.mjs` | Verified sending and ignored inbound mail ship; ordinary invitee mail lacks the assigned-host Reply-To, per-event No-reply choice and required replies-not-received notice. |
| `NOTIFY-007` | Connection alerts | published | partial | `tests/lifecycle-journey.test.mjs`, `scripts/lifecycle/connection-alert-timing.mjs` | Missing all host-scoped connection-alert and recovery recipient outcomes in one scheduled journey; cited native lifecycle checks single-host timing. |
| `DATA-001` | Archive contents and exclusions | published | partial | `tests/export-base-adoption.test.mjs`, `tests/export-redaction.test.mjs`, `tests/export-restored-behavior.test.mjs`, `tests/local-setup-journey.test.mjs` | Missing the complete archive contents/exclusions journey through native transfer, including every promised current record carrier and invalid-archive refusal; cited archive journeys cover a populated census and selected redaction cases. |
| `DATA-009` | Restore without live authority | published | partial | `tests/export-base-adoption.test.mjs`, `tests/export-redaction.test.mjs`, `tests/export-restored-behavior.test.mjs`, `tests/local-setup-journey.test.mjs` | Missing one complete restored-install journey that repeats ordinary booking and every retained-identity, revoked-authority, calendar/mail and rollback outcome; cited archives cover equivalent bytes and selected restored behavior. |
| `DATA-010` | Hosted archive capture | published | partial | `tests/export-base-adoption.test.mjs`, `tests/export-redaction.test.mjs`, `tests/export-restored-behavior.test.mjs`, `tests/local-setup-journey.test.mjs` | Missing the complete hosted capture journey with every active writer, pending-erasure and expired-maintenance refusal and exact files reconciled; cited local setup/export journeys cover native transfer. |
| `DATA-002` | Email-wide personal erasure | published | partial | `tests/person-erasure.test.mjs`, `tests/import-custody-erasure.test.mjs`, `ERASURE.md` | Owner case; role scope missing. |
| `DATA-011` | Erasure fences across restore | published | partial | `tests/person-erasure.test.mjs`, `tests/import-custody-erasure.test.mjs`, `ERASURE.md` | Owner case; role scope missing. |
| `DATA-012` | Operator and invitee identity overlap | published | partial | `tests/person-erasure.test.mjs`, `tests/import-custody-erasure.test.mjs`, `ERASURE.md` | Owner case; role scope missing. |
| `DATA-003` | Saved-file review and import | published | partial | `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs`, `tests/move-in-browser.test.mjs`, `tests/move-in-portability.test.mjs`, `tests/move-in-download.test.mjs` | Missing all role-scoped review/apply/resume refusals and no-change results; native import journeys cover owner preview, immutable snapshot and reviewed application. |
| `DATA-013` | Imported booking provenance | published | partial | `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs`, `tests/move-in-browser.test.mjs`, `tests/move-in-portability.test.mjs`, `tests/move-in-download.test.mjs` | Missing one complete imported-booking provenance journey reading every source/snapshot/action time and subsequent native notice outcome; import journeys cover native occupancy and source data. |
| `DATA-014` | Conflict-preserving import undo | published | partial | `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs`, `tests/move-in-browser.test.mjs`, `tests/move-in-portability.test.mjs`, `tests/move-in-download.test.mjs` | Missing the complete undo journey joined with personal-erasure replay fencing at the same public import door; cited import/portability journeys exercise those behaviors separately. |
| `DATA-015` | Incremental catch-up | published | partial | `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs`, `tests/move-in-browser.test.mjs`, `tests/move-in-portability.test.mjs`, `tests/move-in-download.test.mjs` | Missing one complete incremental-catch-up journey joined with cold resume, retained-undo refusal and restored report authority; cited catch-up covers repeat exclusion and silent new records. |
| `DATA-016` | Source differences and release | published | partial | `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs`, `tests/move-in-browser.test.mjs`, `tests/move-in-portability.test.mjs`, `tests/move-in-download.test.mjs` | Missing a complete source-difference journey reading every difference state, saved decision actor/reason, release, erasure and restored report; cited catch-up exercises representative differences and release. |
| `DATA-017` | Switch-over readiness | published | partial | `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs`, `tests/move-in-browser.test.mjs`, `tests/move-in-portability.test.mjs`, `tests/move-in-download.test.mjs` | Missing one switch-over journey that reconciles every checklist item against the current provider state and latest capture; the cited catch-up journey checks representative checklist values. |
| `CUSTOM-001` | Operator annotations | published | partial | `tests/custom-fields.test.mjs` | Missing role-scoped custom-definition refusals and their audit rows; cited native journeys exercise all field types, invalid values and capacity under the owner. |
| `CUSTOM-002` | Annotation privacy and portability | published | done | `tests/custom-fields.test.mjs` — "native session protects annotations; export restore preserves values and erasure cascades without leaking public data" |  |
| `AUTH-007` | Capabilities for new public surfaces | target | partial | `tests/booking-wire/booking-links-journey.mjs`, `tests/booking-wire/invitation-manage-journey.mjs`, `src/core/features/booking-links/`, `src/core/features/bookings/repository.ts` | Missing every new public surface’s capability boundary, including workflow unsubscribe and polls, in the old cited evidence; booking-link and invitation-link journeys cover their own scoped capabilities. |
| `AUTH-008` | API credentials and connected apps | target | missing |  | No implementing code yet. |
| `OPER-006` | Editing a member's availability and event types | target | missing |  | No implementing code yet. |
| `OPER-007` | Workspace capacity | target | missing |  | No implementing code yet. |
| `TEAM-001` | Hosts as independent schedulers | target | missing |  | No implementing code yet. |
| `TEAM-002` | Teams and team pages | target | missing |  | No implementing code yet. |
| `ADMIN-001` | Single sign-on and provisioning | target | missing |  | No implementing code yet. |
| `ADMIN-002` | Admin audit log | target | partial | `src/core/features/bookings/service.ts`, `tests/person-erasure.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `EVENT-007` | Group events and capacity | target | missing |  | No implementing code yet. |
| `EVENT-008` | Bookings that need host approval | target | partial | `tests/booking-wire/approval-journey.mjs` (approvalJourney), `tests/export-base-adoption.test.mjs`, `scripts/verify-approval-screens.mjs`, `migrations/core/0073_booking_approval_requests.sql`, `ERASURE.md` | A free event without saved-card fees can hold a request for a configurable window (default 24 hours), blocking public and operator booking doors. An authenticated owner approves or declines; only approval creates the booking, calendar event and reminders, once. Decline and expiry release the slot and send one decision notice to the invitee and host recipients only. Pending request status, host decisions, archive history, populated upgrade defaults and person erasure are asserted; screens run at 1440 and 390. Priced and saved-card-fee approval belongs to `PAY-007` (ct, 22 October 2026): the adopted refusal is withdrawn for upfront and deposit prices without saved-card fees, and for free saved-card-fee types, whose authorization/capture-or-void/detach cycles are asserted. Combining a price or deposit with saved-card fees now uses the asserted manual authorization, SetupIntent consent and capture-or-void/detach cycle. Optional tentative destination-calendar display, direct decisions from mail and native mobile approval remain unbuilt and unproved; approval-specific Google Meet conference timing is not yet asserted. Mail links to authenticated Bookings for the decision. Native move-in import uses the shared live approval hold guard; import overlapping a pending approval is not specifically asserted. |
| `EVENT-009` | Invitee guests | target | partial | `tests/booking-wire/guest-journey.mjs` (guestJourney, registered in `tests/booking-wire.test.mjs`), `tests/export-base-adoption.test.mjs`, `scripts/verify-guest-screens.mjs`, `migrations/core/0072_invitee_guests.sql`, `ERASURE.md` | Missing the complete guest lifecycle including provider/team variants and every recipient result after guest erasure; cited native one-on-one and archive/screen journeys cover current guest behavior. |
| `EVENT-010` | Recurring bookings | target | missing |  | No implementing code yet. |
| `EVENT-011` | Invitee-selectable durations | target | partial | `tests/booking-wire/duration-journey.mjs`, `tests/booking-wire/occurrence-duration-journey.mjs`, `tests/move-in-runtime.test.mjs`; `evidence/contract/2026-10-17/EVENT-011/` | Missing the full duration journey across team assignment, provider conferencing, webhooks and reporting; cited native duration and occurrence journeys cover one-on-one selection and persisted duration. |
| `LINK-001` | Single-use links and one-off meetings | target | done | `tests/booking-wire/booking-links-journey.mjs` — "bookingLinksJourney" |  |
| `LINK-002` | Host-offered specific times | target | partial | `tests/offered-times.test.mjs`, `tests/booking-wire/offered-times-journey.mjs`, `src/core/features/booking-links/holds.ts` | Missing the complete offered-times journey across all promised holding, expiry, competing booking and revoke outcomes; native and browser offered-time journeys cover accepted offers and release. |
| `LINK-003` | Prefilled and tracked links | target | partial | `tests/booking-wire/link-context-journey.mjs`, `src/core/features/public-booking/ui/link-context.ts`; `evidence/contract/2026-10-17/LINK-003/` | Missing one link-context journey reading every permitted prefill, length, tracking and preserved-context result across the complete lifecycle; the cited helper covers native link context. |
| `POLL-001` | Meeting polls | target | partial | `src/core/features/polls/`, `tests/booking-wire/poll-journey.mjs`, `tests/booking-axe/polls.mjs`, `tests/polls/native.mjs`, `tests/archive/poll-upgrade.mjs` | Owner-created polls take up to 50 participants and 2–12 live times for unpriced, unapproved published event types. Private expiring hash-stored capabilities rotate atomically on each complete vote; four browser contexts prove voting, changing a vote, private host-selected counts, held-slot exclusion and immediate release on close. Invitations queue once per participant. Open: winning-time booking with EVENT-009 guests and one booking invitation each, timed reminders, deletion, replacement-link recovery, in-flight invitation fencing and PUBLIC-003 known-expiry/used-state pages. Default: tally hidden; priced, deposit, saved-card fee and approval types refused. |
| `BRAND-001` | Branding and custom domain | target | partial | `src/core/features/host-profile/profile-writes.ts`, `src/core/features/event-types/details-writes.ts`, `tests/avatar-upload.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `LOCALE-001` | Languages and time formats | target | missing |  | No implementing code yet. |
| `TEAM-003` | Round-robin events | target | missing |  | No implementing code yet. |
| `TEAM-004` | Fairness reporting and rebalancing | target | missing |  | No implementing code yet. |
| `TEAM-005` | Collective events | target | missing |  | No implementing code yet. |
| `TEAM-006` | Managed event templates | target | missing |  | No implementing code yet. |
| `TEAM-007` | Reassignment, absence and delegation | target | missing |  | No implementing code yet. |
| `ROUTE-001` | Routing forms | target | missing |  | No implementing code yet. |
| `ROUTE-002` | Routing rules and outcomes | target | missing |  | No implementing code yet. |
| `ROUTE-003` | CRM-owner routing and lookup | target | missing |  | No implementing code yet. |
| `ROUTE-004` | Routing from existing website forms | target | missing |  | No implementing code yet. |
| `ROUTE-005` | Routing outcomes and follow-up | target | missing |  | No implementing code yet. |
| `EMBED-001` | Website embeds and builder plugins | target | partial | `src/core/features/embeds/snippet.ts`, `src/core/features/embeds/service.ts`, `tests/embed-document-authorization.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `EMBED-002` | Browser extension | target | missing |  | No implementing code yet. |
| `EMBED-003` | Outlook add-in | target | missing |  | No implementing code yet. |
| `EMBED-004` | Gmail add-on | target | missing |  | No implementing code yet. |
| `MOBILE-001` | Mobile web booking and operation | target | partial | `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `src/core/features/public-booking/ui/event-page.tsx` | Booking, request and operator interfaces ship with responsive 390-pixel journeys; routing and poll pages and their mobile paths remain absent, and the complete 320-to-430-pixel and touch-target guarantee is not established. |
| `MOBILE-002` | Native iOS and Android apps | target | missing |  | No implementing code yet. |
| `AVAIL-010` | Booking frequency and meeting-time limits | target | partial | `scripts/availability-controls-journey.mjs`, `tests/availability-diagnostics.test.mjs`, `src/core/features/availability/booking-limits.ts`; `evidence/contract/2026-10-17/AVAIL-010/` | Missing every host-wide daily/weekly/monthly frequency and duration cap at the actual final booking door; cited controls/diagnostics cover representative native limits. |
| `AVAIL-011` | Named schedules and holidays | target | partial | `scripts/availability-controls-journey.mjs`, `tests/availability-diagnostics.test.mjs`, `src/core/features/availability/named-schedules.ts`; `evidence/contract/2026-10-17/AVAIL-011/` | Missing a full named-schedule/holiday/copy journey joined to real final bookings for all declared options; cited controls and native diagnostics exercise schedule authoring and offers. |
| `AVAIL-012` | Locked timezone | target | partial | `tests/booking-wire/booking-policy-journey.mjs`, `tests/export-base-adoption.test.mjs`, `tests/archive-prior-release.test.mjs`, `migrations/core/0067_request_browser_timezone.sql`; `evidence/contract/2026-10-17/AVAIL-012/`, `evidence/contract/2026-10-21/AVAIL-012/` | Missing the complete locked-zone journey across all promised workflow/SMS and imported/archived observation carriers; native policy journey checks receipt, mail, ICS, requests and current booking record. |
| `BOOK-013` | Redirect after booking | target | partial | `tests/booking-wire/link-context-journey.mjs`, `src/core/features/bookings/link-context.ts`, `src/core/features/embeds/embed-bootstrap.ts`, `tests/embed-document-authorization.test.mjs`; `evidence/contract/2026-10-17/BOOK-013/` | Missing all standalone and embed redirect safety and failure-recovery paths with the final parent navigation read back; cited native link context and embed bootstrap exercise representative redirects. |
| `BOOK-014` | Request a new booking time | target | partial | `tests/booking-wire/reschedule-request-journey.mjs`, `src/core/features/bookings/reschedule-requests.ts` | Native single-host held/released requests, message, one optional reminder, chosen expiry, unchanged booking/manage/UID, Google event and Meet update, request history/filter and invitee cut-off/cap bypass. Roles/delegation, pool reassignment, Zoom, guests, payment/approval, timed workflows, webhooks and assigned-host Reply-To await OPER-001, TEAM-003/007, MEET-001, EVENT-008/009, PAY-001, FLOW-001, API-002 and upstream NOTIFY-010 support. |
| `BOOK-016` | Complete or expire a reschedule request | target | partial | `tests/booking-wire/reschedule-request-journey.mjs`, `src/core/features/bookings/reschedule-requests.ts` | Native single-host held/released requests, message, one optional reminder, chosen expiry, unchanged booking/manage/UID, Google event and Meet update, request history/filter and invitee cut-off/cap bypass. Roles/delegation, pool reassignment, Zoom, guests, payment/approval, timed workflows, webhooks and assigned-host Reply-To await OPER-001, TEAM-003/007, MEET-001, EVENT-008/009, PAY-001, FLOW-001, API-002 and upstream NOTIFY-010 support. |
| `BOOK-017` | Reschedule-request visibility | target | partial | `tests/booking-wire/reschedule-request-journey.mjs`, `src/core/features/bookings/reschedule-requests.ts` | Native single-host held/released requests, message, one optional reminder, chosen expiry, unchanged booking/manage/UID, Google event and Meet update, request history/filter and invitee cut-off/cap bypass. Roles/delegation, pool reassignment, Zoom, guests, payment/approval, timed workflows, webhooks and assigned-host Reply-To await OPER-001, TEAM-003/007, MEET-001, EVENT-008/009, PAY-001, FLOW-001, API-002 and upstream NOTIFY-010 support. |
| `BOOK-015` | Per-event-type invitee change cut-off | target | partial | `tests/booking-wire/booking-policy-journey.mjs`, `tests/booking-wire/reschedule-request-journey.mjs` | Native separate cut-offs, reschedule cap, atomic typed refusals, terms and direct contact with invitee Reply-To; operators and active host requests bypass. Paid-event money-window compatibility awaits PAY-003. RER Managed Mail cannot send Reply-To, so hosted contact explicitly refuses with no queued mail; direct providers are proven at the wire. |
| `CAL-010` | Microsoft 365 and Outlook calendars | target | partial | `tests/booking-wire.test.mjs` ("Native Google and Microsoft calendar lifecycles and Base SendGrid outbox preserve request-only scheduling"), `tests/booking-wire/microsoft-journey.mjs` (work and personal OAuth and calendar list; work-primary getSchedule and secondary calendarView busy privacy and fail-closed final checks; physical-event saved templates, attendee, manage link, lost-response retry, same-event reschedule and cancellation; pre-expiry subscription replacement and authenticated notifications; refused refresh and OAuth recovery; guarded provider switching), `tests/operator-access-migration.test.mjs` ("OPER-002 migration preserves prior operator identity, session and authored data until explicit removal": populated Google upgrade and Microsoft archive redaction), `migrations/core/0084_microsoft_calendar.sql` | "event create with a Teams meeting" remains unimplemented; only physical-location managed events are proven. Outlook.com personal busy reads remain unproven: the default-calendar getSchedule path supports work mailboxes only. "delta sync of an external deletion" and full external edit convergence remain unproven; missing-only Graph reads retain an unresolved deletion probe. "a tenant administrator's organization-wide consent lets a second user of that tenant connect without a consent prompt, and withdrawing it marks every connection in that tenant unhealthy" is unimplemented. Connections remain a deployment-selected singleton, with different-provider switching refused while calendar obligations remain. Graph retains its provider-assigned UID; equality with Dial's saved invitation UID and Microsoft-specific alert delivery are unproven. The Microsoft connect control is held in src/core/features/operators/ui/settings-page.tsx:94 in the active uip Settings round. Canonical setup does not yet declare Graph or CALENDAR_PROVIDER and Microsoft OAuth configuration. MEET-002 still owns a Teams link for a Google destination and EVENT-004 location gating; neither is built here. |
| `CAL-011` | iCloud and CalDAV calendars | target | missing |  | No implementing code yet. This provider owns CAL-003’s managed event guarantees: one event per booking with saved title/description templates, zoned times, stable UID, location and invitee, updated on reschedule and canceled with the booking; invitation links and wider template scope follow NOTIFY-009. |
| `CAL-012` | Busy-time copies across calendars | target | missing |  | No implementing code yet. |
| `MEET-001` | Zoom meetings | target | missing |  | No implementing code yet. |
| `MEET-002` | Microsoft Teams meetings | target | missing |  | No implementing code yet. |
| `MEET-003` | Other conferencing and readiness | target | missing |  | No implementing code yet. |
| `MEET-004` | Attendance facts from conferencing | target | missing |  | No implementing code yet. |
| `PAY-001` | Stripe connection | target | partial | `tests/payments-wire.test.mjs`, `tests/booking-wire/payment-journey.mjs`, `tests/export-base-adoption.test.mjs`, `src/core/features/payments/`, `migrations/core/0068_stripe_payments.sql`, `evidence/contract/2026-10-21/PAY-001/` | Missing the full Stripe connect/disconnect, ACH and health/refusal journey in the cited evidence; native payment journey covers single-host OAuth and card Checkout at the synthetic edge. |
| `PAY-008` | Paid booking confirmation | target | partial | `tests/payments-wire.test.mjs`, `tests/booking-wire/payment-journey.mjs`, `tests/export-base-adoption.test.mjs`, `src/core/features/payments/`, `migrations/core/0068_stripe_payments.sql`, `evidence/contract/2026-10-21/PAY-001/` | Missing every declared payment method and embedded Payment Element at the booking door; cited native payment journey covers card Checkout, signed confirmation and held-slot replay. |
| `PAY-002` | PayPal and Venmo | target | missing |  | No implementing code yet. |
| `PAY-003` | Deposits, refunds and cancellation or no-show fees | target | partial | `tests/payments-wire.test.mjs` ("PAY-003 deposits, refunds and cancellation or no-show fees move money once, only as shown", `tests/booking-wire/payment-terms-journey.mjs`), `tests/scheduling-report.test.mjs`, `tests/export-base-adoption.test.mjs`, `src/core/features/payments/`, `migrations/core/0069_deposits_refunds_fees.sql`, `scripts/verify-money-screens.mjs` | Missing the provider sandbox refund/off-session-fee/invoice-void journey carried from the old acceptance table; synthetic HTTP-edge terms and cancellation probes exercise money paths but are not that sandbox receipt. |
| `PAY-004` | Packages, coupons and gift certificates | target | partial | `tests/payments-wire.test.mjs` ("PAY-001 a paid booking confirms only after Stripe's signed event"), `tests/booking-wire/payment-entitlements-journey.mjs` (idempotent signed package purchase; code and email redemption; three sessions and named zero balance; atomic last-session race; eligible cancellation credit; expired USD gift; monthly subscription mode, controlled renewal, failed renewal and paid recovery; purchaser erasure), `tests/export-base-adoption.test.mjs` ("the actual Base cancellation ledger survives the full populated census and unknown future schema remains refused"), `tests/person-erasure.test.mjs` ("native email preview is inert; one confirmation erases personal rows, private mail and capabilities while preserving a control person"), `migrations/core/0083_payment_entitlements.sql` | "Hosts sell appointment packages (for example 5 coaching sessions valid for 6 months) and recurring appointment memberships through Stripe, and issue coupons and gift certificates in USD.": packages, monthly memberships and full-cover USD gifts have native operator and public HTTP commands; coupons remain unimplemented. "Invitees redeem them at booking with a code or the email they bought with" is proven at the confirmation HTTP door; the public details entry and purchase controls are not built. "Balances, expiry and redemption history appear to the host and, through the manage link, to the invitee" is available in authenticated host and manage-capability responses, but neither screen displays it and host configuration has no UI. Credit combined with saved-card fees, tax or approval is explicitly refused with credit_payment_terms_unsupported. Archives refuse any populated credit catalog or ledger with archive-payment-entitlements-not-portable; portable credit restoration remains unbuilt. Purchaser erasure cancels subscriptions, expires unpaid Checkout, removes booked and unbooked credit identities and preserves named immutable-Checkout cleanup requests. |
| `PAY-005` | Sales tax, receipts and invoices | target | partial | `tests/payments-wire.test.mjs` ("PAY-005 Stripe Tax shows and charges tax by address, and receipts and invoices carry matching amounts", `tests/booking-wire/payment-tax-journey.mjs`), `tests/export-base-adoption.test.mjs`, `src/core/features/payments/`, `migrations/core/0070_sales_tax_receipts_invoices.sql`, `scripts/verify-money-screens.mjs` | Missing the Stripe Tax provider-sandbox Checkout and hosted-invoice journey carried from the old acceptance table; native synthetic tax/receipt/invoice paths are exercised. |
| `PAY-006` | Payment reconciliation and accounting export | target | partial | `tests/payments-wire.test.mjs` ("PAY-003/PAY-006 deposits, refunds, fees and reconciled accounting exports move or record money once, only as shown"), `tests/booking-wire/reconciliation-probes.mjs` (dashboard refund, dispute close, OAuth refusals, idempotent QuickBooks receipts and the sandbox API base; "PAY-006 erasure keeps reconciliation and export references only in anonymous audit"), `tests/export-base-adoption.test.mjs`, `scripts/verify-money-screens.mjs`, `evidence/contract/2026-10-26/PAY-006/qbo-sandbox.json` (sandbox export refused: custom transaction numbers disabled) | Default ADOPTED: CSV and anonymous QuickBooks Online receipts against a host-mapped income account; exports require a USD company and custom transaction numbers. Setting QBO_ENVIRONMENT to sandbox sends accounting calls to Intuit's sandbox base, which development keys require; this is asserted at the synthetic edge only, and no sandbox export has run. Tax-bearing receipts fail closed until accounting tax mapping is built. Xero is unbuilt. Pantry has no documented sales-receipt receiving door and stays link-only. No real provider call or consent was used; live captures, accounting exports and deployed webhook delivery are unobserved. |
| `PAY-007` | Priced and saved-card-fee approval | target | partial | `tests/approval-screens.test.mjs` (single and combined approval screens share one existing browser at 1440 and 390), `tests/booking-wire.test.mjs` (EVENT-008/PAY-007 approval requests authorize shown terms and confirm only after host approval and signed capture; single and combined upfront/deposit labels 1–9), `tests/booking-wire/paid-approval-journey.mjs`, `tests/booking-wire/paid-approval-combined.mjs`, `tests/booking-wire/paid-approval-combined-window.mjs`, `tests/booking-wire/paid-approval-movements.mjs`, `tests/export-base-adoption.test.mjs`, `tests/booking-wire/paid-approval-screens.mjs` (shared Verify browser, 1440/390), `migrations/core/0075_paid_approval.sql`, `ERASURE.md` | Missing the full paid-approval journey with every claimed payment method and all provider failures joined to the final movement audit; cited single/combined native journeys exercise cards/Link and repeated capture/void/detach. |
| `NOTIFY-008` | Booking host recipients | target | partial | `src/core/features/delivery/booking-mails.ts`, `tests/mail-preferences.test.mjs` ("per-operator booking mail respects saved delivery preferences and recipient scope across restart"), `tests/booking-wire.test.mjs` | Missing the team, manager, viewer and delegated-assistant booking-mail journey; cited mail preferences cover the equal-owner single-host recipient set. |
| `NOTIFY-011` | Single-host mail preferences | target | partial | `src/core/features/delivery/booking-mails.ts`, `tests/mail-preferences.test.mjs` ("per-operator booking mail respects saved delivery preferences and recipient scope across restart"), `tests/booking-wire.test.mjs` | Missing single-host preference coverage joined with every alternative-request routing mode after restart; cited preferences and wire tests exercise booking mail mute and native requests. |
| `NOTIFY-012` | Reply recipient routing | target | partial | `src/core/features/delivery/booking-mails.ts`, `tests/mail-preferences.test.mjs` ("per-operator booking mail respects saved delivery preferences and recipient scope across restart"), `tests/booking-wire.test.mjs` | Missing native Reply-To routing after reassignment and for collective organizers and invitee replies; the cited single-host mail preference journey does not implement NOTIFY-010’s reply routing. |
| `NOTIFY-009` | Event and locale message templates | target | partial | `tests/booking-wire/correspondence-journey.mjs`, `tests/booking-wire/invitation-manage-journey.mjs`, `tests/booking-axe/invitation-manage.mjs`, `tests/booking-wire/reschedule-request-journey.mjs`, `src/core/features/event-types/ui/correspondence-editor.tsx` | Native per-event calendar and invitee confirmation/change/cancellation/reminder/request/request-reminder templates, escaped previews, named unknown/private-variable refusal, duplication and deleted-offer retention. Default-on invitation manage capabilities with a per-event toggle now email a replacement link only to the stored invitee, refuse earlier manage links and audit rotation; both email and sessionless page disclose that earlier links no longer work. Unknown/forged links return 404 and expired/canceled links return 410 without booking details. Managed team/locale templates, direct Reschedule/Cancel links, workflow confirmation suppression and From/Reply-To preview await their foundations. This clause owns CAL-003’s direct Reschedule/Cancel links and template scope beyond native Google, including other providers and managed team/locale templates. |
| `NOTIFY-013` | Invitation replacement link | target | partial | `tests/booking-wire/correspondence-journey.mjs`, `tests/booking-wire/invitation-manage-journey.mjs`, `tests/booking-axe/invitation-manage.mjs`, `tests/booking-wire/reschedule-request-journey.mjs`, `src/core/features/event-types/ui/correspondence-editor.tsx` | Native per-event calendar and invitee confirmation/change/cancellation/reminder/request/request-reminder templates, escaped previews, named unknown/private-variable refusal, duplication and deleted-offer retention. Default-on invitation manage capabilities with a per-event toggle now email a replacement link only to the stored invitee, refuse earlier manage links and audit rotation; both email and sessionless page disclose that earlier links no longer work. Unknown/forged links return 404 and expired/canceled links return 410 without booking details. Managed team/locale templates, direct Reschedule/Cancel links, workflow confirmation suppression and From/Reply-To preview await their foundations. This clause owns CAL-003’s direct Reschedule/Cancel links and template scope beyond native Google, including other providers and managed team/locale templates. |
| `NOTIFY-014` | Direct calendar change links | target | partial | `tests/booking-wire/correspondence-journey.mjs`, `tests/booking-wire/invitation-manage-journey.mjs`, `tests/booking-axe/invitation-manage.mjs`, `tests/booking-wire/reschedule-request-journey.mjs`, `src/core/features/event-types/ui/correspondence-editor.tsx` | Native per-event calendar and invitee confirmation/change/cancellation/reminder/request/request-reminder templates, escaped previews, named unknown/private-variable refusal, duplication and deleted-offer retention. Default-on invitation manage capabilities with a per-event toggle now email a replacement link only to the stored invitee, refuse earlier manage links and audit rotation; both email and sessionless page disclose that earlier links no longer work. Unknown/forged links return 404 and expired/canceled links return 410 without booking details. Managed team/locale templates, direct Reschedule/Cancel links, workflow confirmation suppression and From/Reply-To preview await their foundations. This clause owns CAL-003’s direct Reschedule/Cancel links and template scope beyond native Google, including other providers and managed team/locale templates. |
| `NOTIFY-010` | Reply-To and sender identity | target | missing |  | No implementing code yet. |
| `NOTIFY-015` | Send through the host mailbox | target | missing |  | No implementing code yet. |
| `FLOW-001` | Workflow builder | target | partial | `src/core/features/bookings/reminder-commands.ts`, `src/core/features/delivery/booking-mails.ts`, `tests/coordination.test.mjs`, `tests/lifecycle-journey.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `FLOW-002` | SMS reminders and confirmations | target | missing |  | No implementing code yet. |
| `FLOW-003` | Post-meeting follow-ups | target | missing |  | No implementing code yet. |
| `FLOW-004` | No-show handling | target | missing |  | No implementing code yet. |
| `FLOW-005` | Host notifications in Slack and Microsoft Teams | target | partial | `tests/booking-wire.test.mjs` ("NOTIFY-001/NOTIFY-009/AUTH-007: production Google lifecycle and Base SendGrid outbox run on native D1; request-only needs no Google connection", `tests/booking-wire/notice-journey.mjs`), `tests/booking-record.test.mjs` (OPER-004 booking record journey), `scripts/verify-booking-record.mjs`, `tests/booking-axe/notice-settings.mjs`, `tests/export-base-adoption.test.mjs` | Default ADOPTED: owner-configured workspace notices; Teams uses a sealed Workflows URL. Routed-unbooked notices wait for ROUTE-001 and team scope waits for TEAM-002. Ambiguous remote sends are recorded outcome unknown and never automatically replayed. Teams Workflows supplies no deletion authority or downstream message receipt; person erasure reports pending manual cleanup. No real provider call or consent was used; live Slack/Teams posts and deployed webhook delivery are unobserved. |
| `FLOW-006` | Managed transactional SMS | target | missing |  | No implementing code yet. |
| `FLOW-007` | Managed SMS allowance and exhaustion | target | missing |  | No implementing code yet. |
| `FLOW-008` | Move to a workspace sender | target | missing |  | No implementing code yet. |
| `CLIENT-001` | Client records | target | partial | `tests/person-erasure.test.mjs` ("native email preview is inert; one confirmation erases personal rows, private mail and capabilities while preserving a control person"), `tests/booking-axe/client-records.mjs`, `tests/booking-axe/remembered-client.mjs`, `tests/erasure/remembered-details.mjs`, `src/core/features/clients/` | The Bookings Clients workspace groups folded primary-invitee emails, shows viewer-zone history, answers, attendance, read-only payments and booking fields, and opens the exact OPER-004 record. Operator merges preserve booking rows, retain aliases, notes and client text fields, and record the actor; erasure removes the full alias scope. A stored-address-only mailed capability fills saved name, email, phone and answers for one published event after explicit use, once within 15 minutes; requests acknowledge uniformly with a one-minute mail guard. Unbuilt: guest-only, pending-approval and alternative-request histories; shared typed client-field definitions and editing; across-host history (`TEAM-001`), packages (`PAY-004`), SMS consent (`FLOW-002`) and role scope (`OPER-001`). |
| `REPORT-001` | Scheduling analytics | target | partial | `tests/scheduling-report.test.mjs`, `tests/review/report-month.ts`, `src/core/features/reports/`, `src/core/features/bookings/ui/scheduling-report.tsx`, `scripts/verify-report-screens.mjs` | Built for today's single-host install and proved on a seeded month: bookings created, rescheduled and canceled with reasons, no-show and attendance rates, lead time, popular days and hours in the host's zone across a daylight-saving change, bookings by the UTM and source values of `LINK-003` and by chosen duration (`EVENT-011`), and revenue, fees and refunds, each figure stating its definition and drilling through to exactly the bookings it counts; imported move-in bookings count by their source creation time and start and are shown separately. Open: choosing a host or a team (one host and no teams until `TEAM-001` and `TEAM-002`); routing-form submissions and conversion by route and UTM source (`ROUTE-001`); round-robin distribution (`TEAM-004`); a member seeing only their own figures (every operator is an owner until `OPER-001`, so that step is not claimed). Revenue, fees, refunds and net read `PAY-001` payments and `PAY-003` money movements. |
| `REPORT-002` | Host calendar view and booking workspace | target | partial | `src/core/features/bookings/ui/calendar-workspace.tsx`, `src/core/features/bookings/ui/calendar-grid.tsx`, `tests/bookings-filters.test.mjs`, `tests/booking-axe/calendar.mjs` | Day, week and month share the list query, filters and paginated identity set in the viewer profile zone. Attendance filters are applied before count and pagination; the real single host is shown. Native and browser journeys cover the March spring-forward and February/March/April edges, imported placement, keyboard record opening and a real reschedule moving the calendar entry; month is an agenda at mobile width. Open: payment-state filtering, repeated-hour display proof, team filters, member columns and multi-host role scope. The complete mixed-subject acceptance sentence remains intact under ct’s conditional verbatim-carve form. |
| `REPORT-003` | Exports and scheduled reports | target | missing |  | Filtered reporting CSVs and scheduled member reports are absent; the owner archive is DATA-001, not this reporting flow. |
| `API-001` | Public REST API | target | missing |  | No versioned credential-authorized public API, cursor pagination, per-credential limits or OpenAPI document ships; existing page-internal and invitee-capability JSON routes are not this API. |
| `API-002` | Webhooks | target | missing |  | Owns subscriber and webhook dispatch of CAL-006’s natively recorded `calendar.connection-health-changed.v1` transition facts, including their event IDs, states, reasons and times. Delivery is not implemented. |
| `API-003` | Machine-credential booking | target | missing |  | No machine credential, scoped bearer door, per-event-type or per-calendar scope, rotation, machine actor in history, notices or audit, scoped webhook subscription or replay, or archive handling of credentials ships; AUTH-008, API-001 and API-002 are themselves unbuilt, so this clause builds on them and proves its door only once those exist. |
| `API-004` | Machine credential lifecycle | target | missing |  | No machine credential, scoped bearer door, per-event-type or per-calendar scope, rotation, machine actor in history, notices or audit, scoped webhook subscription or replay, or archive handling of credentials ships; AUTH-008, API-001 and API-002 are themselves unbuilt, so this clause builds on them and proves its door only once those exist. |
| `API-005` | Machine action scope | target | missing |  | No machine credential, scoped bearer door, per-event-type or per-calendar scope, rotation, machine actor in history, notices or audit, scoped webhook subscription or replay, or archive handling of credentials ships; AUTH-008, API-001 and API-002 are themselves unbuilt, so this clause builds on them and proves its door only once those exist. |
| `API-006` | Machine API resource doors | target | missing |  | No machine credential, scoped bearer door, per-event-type or per-calendar scope, rotation, machine actor in history, notices or audit, scoped webhook subscription or replay, or archive handling of credentials ships; AUTH-008, API-001 and API-002 are themselves unbuilt, so this clause builds on them and proves its door only once those exist. |
| `API-007` | Machine command retries and limits | target | missing |  | No machine credential, scoped bearer door, per-event-type or per-calendar scope, rotation, machine actor in history, notices or audit, scoped webhook subscription or replay, or archive handling of credentials ships; AUTH-008, API-001 and API-002 are themselves unbuilt, so this clause builds on them and proves its door only once those exist. |
| `API-008` | Scoped webhook subscriptions | target | missing |  | No machine credential, scoped bearer door, per-event-type or per-calendar scope, rotation, machine actor in history, notices or audit, scoped webhook subscription or replay, or archive handling of credentials ships; AUTH-008, API-001 and API-002 are themselves unbuilt, so this clause builds on them and proves its door only once those exist. |
| `API-009` | Machine actor history and erasure | target | missing |  | No machine credential, scoped bearer door, per-event-type or per-calendar scope, rotation, machine actor in history, notices or audit, scoped webhook subscription or replay, or archive handling of credentials ships; AUTH-008, API-001 and API-002 are themselves unbuilt, so this clause builds on them and proves its door only once those exist. |
| `API-010` | Machine metadata without restored authority | target | missing |  | No machine credential, scoped bearer door, per-event-type or per-calendar scope, rotation, machine actor in history, notices or audit, scoped webhook subscription or replay, or archive handling of credentials ships; AUTH-008, API-001 and API-002 are themselves unbuilt, so this clause builds on them and proves its door only once those exist. |
| `INTEG-001` | Zapier, Make and Crank | target | missing |  | No implementing code yet. |
| `INTEG-002` | HubSpot | target | missing |  | No implementing code yet. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`). |
| `INTEG-003` | Salesforce | target | missing |  | No implementing code yet. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`). |
| `INTEG-004` | Orbit and Pipedrive | target | missing |  | No implementing code yet. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`). |
| `INTEG-005` | Calendar and conferencing marketplace presence | target | missing |  | No implementing code yet. |
| `INTEG-006` | Analytics and conversion tracking | target | missing |  | No implementing code yet. |
| `INTEG-007` | Intercom | target | missing |  | No implementing code yet. |
| `INTEG-008` | Microsoft Dynamics 365 Sales | target | missing |  | No implementing code yet. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`). |
| `DATA-004` | Full-scope portability and erasure | target | partial | `tests/export-base-adoption.test.mjs`, `tests/person-erasure.test.mjs`, `ERASURE.md`; Verify 39673090704 and Run site 39673090829 success on f553bfdc224bc544d74f68a5aaa7eca63ed3b322 | Missing one whole target-record census journey combining archive/restore and erasure for the future record types; cited census/classification and person-erasure journeys cover current record kinds. |
| `DATA-005` | Target record kinds in the archive | target | partial | `tests/export-base-adoption.test.mjs`, `tests/archive/client-upgrade.mjs`, `tests/archive/poll-upgrade.mjs`, `tests/archive/payment-erasure-upgrade.mjs` | Host profiles, schedules, guests, payment references and both phone carriers round-trip. The client landing adds profiles, aliases, notes and text fields; this poll landing adds polls, candidates, participants and votes. Saved-details and poll capabilities and hashes are excluded, mail links scrubbed, and restored polls are closed with no live hold or participation authority. The c12 port adds processor facts and accounting export receipts, workspace notice destinations, delivery outcomes and anonymous erasure requests. Accounting and notice credentials/OAuth states are excluded, destinations require reconnect and restored commands cannot execute. Seats, recurring series and other target kinds await their feature clauses. |
| `DATA-006` | Target personal rows in erasure | target | partial | `tests/person-erasure.test.mjs` ("native email preview is inert; one confirmation erases personal rows, private mail and capabilities while preserving a control person"), `tests/erasure/remembered-details.mjs`, `tests/export-base-adoption.test.mjs` | The combined native journey removes guest rows, phone answers and invitee-phone locations, merged client records, every alias, notes, text fields and saved-details links, while control booking, guest and client histories stay unchanged and identity-free merge audit remains. The same journey now removes the person’s poll votes, participant and token rows and private invitation mail; a changed vote invalidates an older erasure preview, and the control participant remains byte-identical. Phone, client and poll carriers round-trip. Open: SMS consent rows (`FLOW-002`) are unbuilt. |
| `DATA-007` | Processor deletion requests | target | done | `tests/booking-wire/payment-erasure-probes.mjs` — "paymentErasureProbes" |  |
| `DATA-008` | CRM deletion requests | target | missing |  | No CRM integration exists. |
| `MIGRATE-001` | Calendly connected move-in | target | partial | `src/core/features/move-in/service.ts`, `src/core/features/move-in/map-events.ts`, `scripts/move-in/download-calendly.mjs`, `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `MIGRATE-006` | Calendly schedule bindings | target | partial | `src/core/features/move-in/service.ts`, `src/core/features/move-in/map-events.ts`, `scripts/move-in/download-calendly.mjs`, `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `MIGRATE-007` | Calendly manual steps and capacity | target | partial | `src/core/features/move-in/service.ts`, `src/core/features/move-in/map-events.ts`, `scripts/move-in/download-calendly.mjs`, `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `MIGRATE-002` | Acuity Scheduling move-in | target | missing |  | No implementing code yet. |
| `MIGRATE-003` | Microsoft Bookings move-in | target | missing |  | No implementing code yet. |
| `MIGRATE-004` | Cal.com, SavvyCal, Doodle and generic move-in | target | missing |  | No implementing code yet. |
| `MIGRATE-005` | Cutover and old links | target | partial | `src/core/features/move-in/switch-over.ts`, `tests/move-in-catch-up.test.mjs`, `tests/move-in-browser.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `AGENT-001` | Scoped scheduling agents | push-further | missing |  | No implementing code yet. |
| `AGENT-002` | Exception negotiator | push-further | missing |  | No agent constraint solver, exception proposals or company-policy decision and offered-times flow ships; alternative requests are handled manually. |
| `AGENT-003` | Unanswered-thread follow-up | push-further | missing |  | No implementing code yet. |
| `AGENT-004` | Calendar drift reconciler | push-further | partial | `src/core/features/bookings/calendar-reconciliation.ts`, `src/core/features/calendar-connection/external-sync.ts`, `tests/booking-wire.test.mjs` | The cited paths cover part of the clause; the rest is still to build. |
| `AGENT-005` | Meeting happened check | push-further | missing |  | No agent evidence assembly, attendance proposals or company-policy attendance-decision flow ships; BOOK-011 supports manual attendance marks only. |
| `AGENT-006` | No-show recovery | push-further | missing |  | No implementing code yet. |
| `AGENT-007` | Meeting follow-through | push-further | missing |  | No implementing code yet. |
| `AGENT-008` | Pre-meeting brief | push-further | missing |  | No implementing code yet. |
| `AGENT-009` | Scheduling assistant in email threads | push-further | missing |  | No implementing code yet. |
| `AGENT-010` | Flexible holds and availability tuning | push-further | missing |  | No implementing code yet. |
| `AGENT-011` | Voice booking through a contracted provider | push-further | missing |  | No implementing code yet. |
| `SURFACE-001` | Registry of scheduling jobs | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-002` | Scheduling class computation | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-003` | Payment and sign-off classes | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-004` | People and credentials classes | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-005` | Provider setup classes | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-006` | Irreversible and sensitive scheduling data | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-007` | Scheduling record resources | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-008` | Scheduling events and handoffs | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-009` | Specialist prompts and agent jobs | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-010` | Scheduling capacity and spend | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-011` | Policy-dependent scheduling decisions | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-012` | Retry-safe specialist work | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
| `SURFACE-013` | A stranger agent runs a scheduling week | target | missing |  | No MCP scheduling registry or specialist conformance journey is implemented. |
