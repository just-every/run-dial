<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Implemented contract claims

The contract census is 88 done / 30 partial / 58 missing (176 clauses).

Read each claim with its full requirement and acceptance in [CONTRACT.md](../CONTRACT.md). A partial or missing claim keeps its remaining work explicit.

AUTH-001 is done: Public authority.

Evidence: `tests/operator-auth-boundary.test.mjs`, `tests/operator-management.test.mjs`, `tests/booking-http.test.mjs`, `tests/request-json-boundary.test.mjs` ("copy-report input validation rejects malformed JSON and wrong shapes without writes, then accepts the native report"), `tests/portability-status.test.mjs`

Gap: None.

AUTH-002 is done: Booking nonce.

Evidence: `tests/booking-http.test.mjs`

Gap: None.

AUTH-003 is done: Booking access.

Evidence: `tests/embed-document-authorization.test.mjs`

Gap: None.

AUTH-004 is done: Calendar authorization callback.

Evidence: `tests/providers-runtime.test.mjs`

Gap: None.

AUTH-005 is done: Provider callbacks.

Evidence: `tests/providers-runtime.test.mjs`, `tests/mail-connection.test.mjs`

Gap: None.

AUTH-006 is done: First-owner admission.

Evidence: `tests/owner-signin.test.mjs`, `tests/managed-admission.test.mjs`

Gap: None.

AUTH-007 is done: Capabilities for new public surfaces.

Evidence: `tests/booking-wire/booking-links-journey.mjs`, `tests/booking-wire/invitation-manage-journey.mjs`, `src/core/features/booking-links/`, `src/core/features/bookings/repository.ts`

Gap: Routing, poll, payment-return and workflow-unsubscribe capabilities are carried by `ROUTE-001`, `POLL-001`, `PAY-001` and `FLOW-001`, which each name this clause.

AUTH-008 is missing: API credentials and connected apps.

Evidence: None.

Gap: No implementing code yet.

OPER-001 is partial: Roles and permissions.

Evidence: `tests/operator-management.test.mjs`, `tests/local-setup-journey.test.mjs`, `src/core/features/operators/service.ts`

Gap: The cited paths cover part of the clause; the rest is still to build.

OPER-002 is done: Operator management.

Evidence: `tests/operator-management.test.mjs`, `tests/operator-removal-mail.test.mjs`, `tests/operator-access-migration.test.mjs`

Gap: Role refusals carried by `OPER-001`.

OPER-003 is partial: Booking workspace.

Evidence: `tests/bookings-filters.test.mjs`, `tests/bookings-search-upgrade.test.mjs`

Gap: Single-host 100,000-booking fixture; capacity fixture missing.

OPER-004 is done: Booking record.

Evidence: `tests/booking-axe/acceptance-records.mjs`, `tests/booking-record.test.mjs`, `scripts/verify-booking-record.mjs`

Gap: Native records show answers, annotations, both zones, history, calendar/meeting states and each email's recipient, subject, queue/send/failure state and recorded reason. At 1440 and 390 the UI retries a failed email, shows its separate sent retry and retains the original failure; Sent means provider acceptance.

EDITOR-001 is done: Owner editor.

Evidence: `scripts/verify-managed-editor.mjs`

Gap: Role refusals carried by `OPER-001`.

OPER-005 is done: Durable first run.

Evidence: `tests/first-run.test.mjs`, `tests/host-setup-journey.test.mjs`

Gap: None.

OPER-006 is missing: Editing a member's availability and event types.

Evidence: None.

Gap: No implementing code yet.

OPER-007 is missing: Workspace capacity.

Evidence: None.

Gap: No implementing code yet.

TEAM-001 is missing: Hosts as independent schedulers.

Evidence: None.

Gap: No implementing code yet.

TEAM-002 is missing: Teams and team pages.

Evidence: None.

Gap: No implementing code yet.

ADMIN-001 is missing: Single sign-on and provisioning.

Evidence: None.

Gap: No implementing code yet.

ADMIN-002 is partial: Admin audit log.

Evidence: `src/core/features/bookings/service.ts`, `tests/person-erasure.test.mjs`

Gap: The cited paths cover part of the clause; the rest is still to build.

PROFILE-001 is done: Host profile.

Evidence: `src/core/features/host-profile/profile-writes.ts`, `scripts/verify-profile-authoring.mjs`, `tests/runtime.test.mjs`

Gap: The two-host journey and a team event's host zone are carried by `TEAM-001`, `TEAM-003` and `TEAM-005`, which each name this clause.

PROFILE-002 is done: Public profile.

Evidence: `tests/booking-http.test.mjs`, `src/core/features/host-profile/public.ts`

Gap: None.

PROFILE-003 is done: Avatar asset.

Evidence: `tests/avatar-upload.test.mjs`, `tests/avatar.test.mjs`

Gap: None.

EVENT-001 is done: Event type lifecycle.

Evidence: `tests/runtime.test.mjs`, `tests/event-status-trigger.test.mjs`, `tests/booking-wire/duration-journey.mjs`, `tests/booking-wire/location-journey.mjs`, `src/core/features/event-types/duplicate.ts`

Gap: Workspace/host capacity, reusable team templates and workflow attachments are carried by `OPER-007`, `TEAM-006` and `FLOW-001`, which each name this clause.

EVENT-002 is done: Scheduling constraints.

Evidence: `scripts/verify-availability-diagnostics.mjs`, `tests/availability-diagnostics.test.mjs`, `migrations/core/0052_booking_horizons.sql`; browser: `evidence/contract/2026-10-17/EVENT-002/`

Gap: None.

EVENT-003 is done: Invitee questions.

Evidence: `scripts/verify-question-defaults.mjs`, `tests/availability-diagnostics.test.mjs`, `migrations/core/0051_phone_dropdown_questions.sql`; browser: `evidence/contract/2026-10-17/EVENT-003/`

Gap: None.

EVENT-004 is done: Locations.

Evidence: `tests/booking-wire/location-journey.mjs`, `src/core/features/event-types/locations.ts`, `src/core/features/public-booking/ui/booking-location.tsx`

Gap: Provider conferencing and round-robin/collective host isolation are carried by `MEET-001`, `MEET-002`, `MEET-003`, `TEAM-003`, `TEAM-005` and `NOTIFY-008`, which each name this clause.

EVENT-005 is done: Removing an event type.

Evidence: `tests/event-status-trigger.test.mjs`

Gap: None.

EVENT-006 is done: Publication readiness.

Evidence: `tests/availability-diagnostics.test.mjs`, `tests/host-setup-journey.test.mjs`, `tests/booking-axe/request-only.mjs`

Gap: None.

EVENT-007 is missing: Group events and capacity.

Evidence: None.

Gap: No implementing code yet.

EVENT-008 is partial: Bookings that need host approval.

Evidence: `tests/booking-wire/approval-journey.mjs` (approvalJourney), `tests/export-base-adoption.test.mjs`, `scripts/verify-approval-screens.mjs`, `migrations/core/0073_booking_approval_requests.sql`, `ERASURE.md`

Gap: A free event without saved-card fees can hold a request for a configurable window (default 24 hours), blocking public and operator booking doors. An authenticated owner approves or declines; only approval creates the booking, calendar event and reminders, once. Decline and expiry release the slot and send one decision notice to the invitee and host recipients only. Pending request status, host decisions, archive history, populated upgrade defaults and person erasure are asserted; screens run at 1440 and 390. Priced and saved-card-fee approval belongs to `PAY-007` (ct, 22 October 2026): the adopted refusal is withdrawn for upfront and deposit prices without saved-card fees, and for free saved-card-fee types, whose authorization/capture-or-void/detach cycles are asserted. Combining a price or deposit with saved-card fees now uses the asserted manual authorization, SetupIntent consent and capture-or-void/detach cycle. Optional tentative destination-calendar display, direct decisions from mail and native mobile approval remain unbuilt and unproved; approval-specific Google Meet conference timing is not yet asserted. Mail links to authenticated Bookings for the decision. Native move-in import uses the shared live approval hold guard; import overlapping a pending approval is not specifically asserted.

EVENT-009 is done: Invitee guests.

Evidence: `tests/booking-wire/guest-journey.mjs` (guestJourney, registered in `tests/booking-wire.test.mjs`), `tests/export-base-adoption.test.mjs`, `scripts/verify-guest-screens.mjs`, `migrations/core/0072_invitee_guests.sql`, `ERASURE.md`

Gap: Guest access defaults off; the host configures a maximum. The invitee adds two guests, each gets the destination calendar invitation and one capability-free Dial confirmation, removing a guest sends one cancellation and patches attendees once on replay, and an email address grants no manage access. Guest erasure removes guest rows and notices while preserving the invitee booking and controls. Calendar descriptions stay capability-free even after the last guest is removed. Current archives and populated prior-schema upgrades include the new record kind; settings, booking and manage screens pass at 1440 and 390. Providers are synthetic at the HTTP edge.

EVENT-010 is missing: Recurring bookings.

Evidence: None.

Gap: No implementing code yet.

EVENT-011 is done: Invitee-selectable durations.

Evidence: `tests/booking-wire/duration-journey.mjs`, `tests/booking-wire/occurrence-duration-journey.mjs`, `tests/move-in-runtime.test.mjs`; `evidence/contract/2026-10-17/EVENT-011/`

Gap: Duration-specific pricing, team assignment, webhook payloads and reports are carried by `PAY-001`, `TEAM-003`, `TEAM-005`, `API-002` and `REPORT-001`, which each name this clause.

LINK-001 is done: Single-use links and one-off meetings.

Evidence: `tests/booking-wire/booking-links-journey.mjs`, `src/core/features/booking-links/`

Gap: None.

LINK-002 is done: Host-offered specific times.

Evidence: `tests/offered-times.test.mjs`, `tests/booking-wire/offered-times-journey.mjs`, `src/core/features/booking-links/holds.ts`

Gap: Native live-time selection, copyable link/email, configurable or absent holds, exact private offers, atomic release on booking, expiry/revocation and fresh final validation.

LINK-003 is done: Prefilled and tracked links.

Evidence: `tests/booking-wire/link-context-journey.mjs`, `src/core/features/public-booking/ui/link-context.ts`; `evidence/contract/2026-10-17/LINK-003/`

Gap: Webhook payloads, CRM handoff and reports are carried by `API-002`, `INTEG-002`, `INTEG-003`, `INTEG-004`, `INTEG-008` and `REPORT-001`, which each name this clause.

POLL-001 is partial: Meeting polls.

Evidence: `src/core/features/polls/`, `tests/booking-wire/poll-journey.mjs`, `tests/booking-axe/polls.mjs`, `tests/polls/native.mjs`, `tests/archive/poll-upgrade.mjs`

Gap: Owner-created polls take up to 50 participants and 2–12 live times for unpriced, unapproved published event types. Private expiring hash-stored capabilities rotate atomically on each complete vote; four browser contexts prove voting, changing a vote, private host-selected counts, held-slot exclusion and immediate release on close. Invitations queue once per participant. Open: winning-time booking with EVENT-009 guests and one booking invitation each, timed reminders, deletion, replacement-link recovery, in-flight invitation fencing and PUBLIC-003 known-expiry/used-state pages. Default: tally hidden; priced, deposit, saved-card fee and approval types refused.

BRAND-001 is partial: Branding and custom domain.

Evidence: `src/core/features/host-profile/profile-writes.ts`, `src/core/features/event-types/details-writes.ts`, `tests/avatar-upload.test.mjs`

Gap: The cited paths cover part of the clause; the rest is still to build.

LOCALE-001 is missing: Languages and time formats.

Evidence: None.

Gap: No implementing code yet.

TEAM-003 is missing: Round-robin events.

Evidence: None.

Gap: No implementing code yet. Includes the specific-host routing outcome and preview inherited from `ROUTE-002`.

TEAM-004 is missing: Fairness reporting and rebalancing.

Evidence: None.

Gap: No implementing code yet.

TEAM-005 is missing: Collective events.

Evidence: None.

Gap: No implementing code yet.

TEAM-006 is missing: Managed event templates.

Evidence: None.

Gap: No implementing code yet.

TEAM-007 is missing: Reassignment, absence and delegation.

Evidence: None.

Gap: No implementing code yet.

ROUTE-001 is partial: Routing forms.

Evidence: `tests/booking-wire/routing-journey.mjs` routingJourney; `tests/booking-axe/routing.mjs` routingScreens; `tests/export-base-adoption.test.mjs` archive roundtrip

Gap: Required-field refusal, single recorded submission on replay, booking answer handoff, capability refusals, conversion drilldown and browser proof are implemented; passing native and browser journeys on the candidate remain pending.

ROUTE-002 is partial: Routing rules and outcomes.

Evidence: `tests/booking-wire/routing-journey.mjs` routingJourney; `tests/booking-axe/routing.mjs` routingScreens

Gap: Ordered preview and public outcomes, matched-rule records and per-route safe redirects are implemented; passing native and browser journeys on the candidate remain pending. Specific-host pool routing is inherited by `TEAM-003`, which names the duty.

ROUTE-003 is missing: CRM-owner routing and lookup.

Evidence: None.

Gap: No implementing code yet.

ROUTE-004 is missing: Routing from existing website forms.

Evidence: None.

Gap: No implementing code yet.

ROUTE-005 is missing: Routing outcomes and follow-up.

Evidence: None.

Gap: No implementing code yet.

HOME-001 is done: Product landing.

Evidence: `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/public-site.mjs`, `tests/runtime.test.mjs`

Gap: None.

DOCS-001 is done: Public documentation.

Evidence: `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `src/core/features/public-site/docs/build/manifest.ts`

Gap: None.

PUBLIC-001 is done: Event presentation.

Evidence: `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/day-picker.mjs`

Gap: None.

PUBLIC-002 is done: Invitee-first flow.

Evidence: `tests/embed-document-authorization.test.mjs`

Gap: None.

PUBLIC-003 is done: Progress and recovery.

Evidence: `tests/host-setup-journey.test.mjs`, `tests/ux-simplification.test.mjs`

Gap: None.

PUBLIC-004 is done: Embed.

Evidence: `tests/embed-document-authorization.test.mjs`, `src/core/features/embeds/snippet.ts`

Gap: None.

PUBLIC-005 is done: Unavailable pages.

Evidence: `tests/embed-document-authorization.test.mjs`

Gap: None.

PUBLIC-006 is done: Abuse.

Evidence: `tests/public-blocking.test.mjs`, `tests/public-admission.test.mjs`

Gap: Role refusals carried by `OPER-001`.

EMBED-001 is partial: Website embeds and builder plugins.

Evidence: `src/core/features/embeds/snippet.ts`, `src/core/features/embeds/service.ts`, `tests/embed-document-authorization.test.mjs`

Gap: The cited paths cover part of the clause; the rest is still to build.

EMBED-002 is missing: Browser extension.

Evidence: None.

Gap: No implementing code yet.

EMBED-003 is missing: Outlook add-in.

Evidence: None.

Gap: No implementing code yet.

EMBED-004 is missing: Gmail add-on.

Evidence: None.

Gap: No implementing code yet.

MOBILE-001 is partial: Mobile web booking and operation.

Evidence: `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `src/core/features/public-booking/ui/event-page.tsx`

Gap: Booking, request and operator interfaces ship with responsive 390-pixel journeys; routing and poll pages and their mobile paths remain absent, and the complete 320-to-430-pixel and touch-target guarantee is not established.

MOBILE-002 is missing: Native iOS and Android apps.

Evidence: None.

Gap: No implementing code yet.

AVAIL-001 is done: Schedule and overrides.

Evidence: `tests/availability-diagnostics.test.mjs`, `src/core/features/event-types/recurring-writes.ts`, `src/core/features/event-types/override-writes.ts`

Gap: None.

AVAIL-002 is done: Valid slots.

Evidence: `tests/dst-native.test.mjs`, `tests/booking-wire.test.mjs`, `tests/providers-d1.test.mjs`

Gap: None.

AVAIL-003 is done: Buffers.

Evidence: `tests/availability-diagnostics.test.mjs`, `src/core/features/availability/engine.ts`

Gap: None.

AVAIL-004 is done: Freshness and failure.

Evidence: `tests/lifecycle-journey.test.mjs`, `tests/host-setup-journey.test.mjs`

Gap: None.

AVAIL-005 is done: Timezones.

Evidence: `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/timezone.mjs`

Gap: None.

AVAIL-006 is done: Daylight saving time.

Evidence: `tests/dst-native.test.mjs`, `src/core/features/availability/timezone.ts`

Gap: None.

AVAIL-007 is done: Recommendations and filters.

Evidence: `tests/booking-axe/day-picker.mjs`

Gap: None.

AVAIL-008 is partial: Response time.

Evidence: `tests/booking-axe/acceptance-capacity.mjs`

Gap: Single event type; team kinds at capacity missing.

AVAIL-009 is done: Operator diagnostics.

Evidence: `tests/availability-diagnostics.test.mjs`

Gap: None.

AVAIL-010 is done: Booking frequency and meeting-time limits.

Evidence: `scripts/availability-controls-journey.mjs`, `tests/availability-diagnostics.test.mjs`, `src/core/features/availability/booking-limits.ts`; `evidence/contract/2026-10-17/AVAIL-010/`

Gap: Independent-host ownership and role scope are carried by `TEAM-001`, `OPER-001` and `OPER-006`.

AVAIL-011 is done: Named schedules and holidays.

Evidence: `scripts/availability-controls-journey.mjs`, `tests/availability-diagnostics.test.mjs`, `src/core/features/availability/named-schedules.ts`; `evidence/contract/2026-10-17/AVAIL-011/`

Gap: Cross-member editing, role checks and actor audit are carried by `OPER-006`, `OPER-001` (`role_forbidden`) and `ADMIN-002`; `TEAM-001` carries per-host separation.

AVAIL-012 is done: Locked timezone.

Evidence: `tests/booking-wire/booking-policy-journey.mjs`, `tests/export-base-adoption.test.mjs`, `tests/archive-prior-release.test.mjs`, `migrations/core/0067_request_browser_timezone.sql`; `evidence/contract/2026-10-17/AVAIL-012/`, `evidence/contract/2026-10-21/AVAIL-012/`

Gap: Native public picker/details/receipt/manage, stored lock/browser zones, booking mail/reminders and ICS carry the locked zone. Invitee actions store the browser zone separately from the locked request-window zone; a booking created from that request preserves both through export and restore. Direct operator-created bookings explicitly show “Zone not provided by invitee.” SMS and workflow variables are carried by `FLOW-002` and `FLOW-001`, which name this clause.

BOOK-001 is done: Final validation.

Evidence: `tests/lifecycle-journey.test.mjs`, `tests/availability-diagnostics.test.mjs`

Gap: None.

BOOK-002 is done: Atomic claim.

Evidence: `tests/booking-lifecycle.test.mjs`

Gap: None.

BOOK-003 is done: Idempotent confirmation.

Evidence: `tests/lifecycle-journey.test.mjs`

Gap: None.

BOOK-004 is done: States and occurrences.

Evidence: `tests/occurrence-mail-duration.test.mjs` ("occurrence-specific mail facts survive an actual 30-to-60-minute reschedule on migrated native D1"), `tests/booking-wire.test.mjs`

Gap: None.

BOOK-005 is done: Confirmation receipt.

Evidence: `tests/booking-wire.test.mjs`, `tests/booking-axe/booking.mjs`, `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile")

Gap: Receipt contents, disabled pending join control and replacement by the stored provisioned joining link are exercised at 1440 and 390.

BOOK-006 is done: Manage link.

Evidence: `tests/embed-document-authorization.test.mjs`, `src/core/features/bookings/manage-capability.ts`

Gap: None.

BOOK-007 is done: Invitee rescheduling.

Evidence: `tests/lifecycle-journey.test.mjs`, `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile")

Gap: None.

BOOK-008 is done: Invitee cancellation.

Evidence: `tests/lifecycle-journey.test.mjs`, `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile")

Gap: None.

BOOK-009 is done: Operator changes.

Evidence: `tests/operator-change.test.mjs`, `tests/move-in-booking-actions.test.mjs`

Gap: Role refusals carried by `OPER-001`.

BOOK-010 is done: History.

Evidence: `tests/booking-wire.test.mjs`, `src/core/features/bookings/service.ts`

Gap: None.

BOOK-011 is done: Attendance.

Evidence: `tests/booking-axe.test.mjs` ("public booking, operator and public-site accessibility sweep at desktop and mobile"), `tests/booking-axe/keyboard-bookings.mjs`, `tests/move-in-runtime.test.mjs`, `tests/person-erasure.test.mjs`

Gap: Role refusals carried by `OPER-001`.

BOOK-012 is done: Operator-created booking.

Evidence: `tests/operator-creation-recovery.test.mjs`, `tests/operator-temporal.test.mjs`

Gap: Role refusals carried by `OPER-001`.

BOOK-013 is done: Redirect after booking.

Evidence: `tests/booking-wire/link-context-journey.mjs`, `src/core/features/bookings/link-context.ts`, `src/core/features/embeds/embed-bootstrap.ts`, `tests/embed-document-authorization.test.mjs`; `evidence/contract/2026-10-17/BOOK-013/`

Gap: Per-routing-route configuration and the popup widget are carried by `ROUTE-002` and `EMBED-001`, which each name this clause.

BOOK-014 is partial: Ask the invitee to pick a new time.

Evidence: `tests/booking-wire/reschedule-request-journey.mjs`, `src/core/features/bookings/reschedule-requests.ts`

Gap: Native single-host held/released requests, message, one optional reminder, chosen expiry, unchanged booking/manage/UID, Google event and Meet update, request history/filter and invitee cut-off/cap bypass. Roles/delegation, pool reassignment, Zoom, guests, payment/approval, timed workflows, webhooks and assigned-host Reply-To await OPER-001, TEAM-003/007, MEET-001, EVENT-008/009, PAY-001, FLOW-001, API-002 and upstream NOTIFY-010 support.

BOOK-015 is partial: Per-event-type invitee change cut-off.

Evidence: `tests/booking-wire/booking-policy-journey.mjs`, `tests/booking-wire/reschedule-request-journey.mjs`

Gap: Native separate cut-offs, reschedule cap, atomic typed refusals, terms and direct contact with invitee Reply-To; operators and active host requests bypass. Paid-event money-window compatibility awaits PAY-003. RER Managed Mail cannot send Reply-To, so hosted contact explicitly refuses with no queued mail; direct providers are proven at the wire.

CAL-001 is partial: Calendar connections.

Evidence: `src/core/features/calendar-connection/service.ts`, `src/core/platform/calendar/google.ts`, `tests/lifecycle-journey.test.mjs`, `tests/providers-d1.test.mjs`

Gap: The cited paths cover part of the clause; the rest is still to build.

CAL-002 is done: Busy privacy.

Evidence: `tests/providers-d1.test.mjs`, `src/core/features/calendar-connection/busy-reader.ts`

Gap: None.

CAL-003 is done: Managed event.

Evidence: `tests/booking-wire.test.mjs`, `tests/providers-d1.test.mjs`, `tests/lifecycle-journey.test.mjs`, `evidence/contract/2026-10-17/CAL-003/`

Gap: None.

CAL-004 is done: Idempotent side effects.

Evidence: `tests/booking-wire.test.mjs`

Gap: None.

CAL-005 is done: Provider failure.

Evidence: `tests/booking-wire.test.mjs`

Gap: None.

CAL-006 is done: Connection health.

Evidence: `tests/lifecycle-journey.test.mjs`, `tests/export-restored-behavior.test.mjs`

Gap: None.

CAL-007 is done: Provider callbacks.

Evidence: `tests/deletion-ordering.test.mjs`, `tests/coordination.test.mjs`

Gap: None.

CAL-008 is done: External deletion and edits.

Evidence: `tests/lifecycle-journey.test.mjs`, `tests/booking-wire.test.mjs`

Gap: None.

CAL-009 is done: Calendar file.

Evidence: `tests/calendar-file.test.mjs`, `src/core/features/bookings/calendar-file.ts`

Gap: None.

CAL-010 is partial: Microsoft 365 and Outlook calendars.

Evidence: `tests/booking-wire.test.mjs` ("Native Google and Microsoft calendar lifecycles and Base SendGrid outbox preserve request-only scheduling"), `tests/booking-wire/microsoft-journey.mjs` (work and personal OAuth and calendar list; work-primary getSchedule and secondary calendarView busy privacy and fail-closed final checks; physical-event saved templates, attendee, manage link, lost-response retry, same-event reschedule and cancellation; pre-expiry subscription replacement and authenticated notifications; refused refresh and OAuth recovery; guarded provider switching), `tests/operator-access-migration.test.mjs` ("OPER-002 migration preserves prior operator identity, session and authored data until explicit removal": populated Google upgrade and Microsoft archive redaction), `migrations/core/0084_microsoft_calendar.sql`

Gap: "event create with a Teams meeting" remains unimplemented; only physical-location managed events are proven. Outlook.com personal busy reads remain unproven: the default-calendar getSchedule path supports work mailboxes only. "delta sync of an external deletion" and full external edit convergence remain unproven; missing-only Graph reads retain an unresolved deletion probe. "a tenant administrator's organization-wide consent lets a second user of that tenant connect without a consent prompt, and withdrawing it marks every connection in that tenant unhealthy" is unimplemented. Connections remain a deployment-selected singleton, with different-provider switching refused while calendar obligations remain. Graph retains its provider-assigned UID; equality with Dial's saved invitation UID and Microsoft-specific alert delivery are unproven. The Microsoft connect control is held in src/core/features/operators/ui/settings-page.tsx:94 in the active uip Settings round. Canonical setup does not yet declare Graph or CALENDAR_PROVIDER and Microsoft OAuth configuration. MEET-002 still owns a Teams link for a Google destination and EVENT-004 location gating; neither is built here.

CAL-011 is missing: iCloud and CalDAV calendars.

Evidence: None.

Gap: No implementing code yet. This provider owns CAL-003’s managed event guarantees: one event per booking with saved title/description templates, zoned times, stable UID, location and invitee, updated on reschedule and canceled with the booking; invitation links and wider template scope follow NOTIFY-009.

CAL-012 is missing: Busy-time copies across calendars.

Evidence: None.

Gap: No implementing code yet.

MEET-001 is missing: Zoom meetings.

Evidence: None.

Gap: No implementing code yet.

MEET-002 is missing: Microsoft Teams meetings.

Evidence: None.

Gap: No implementing code yet.

MEET-003 is missing: Other conferencing and readiness.

Evidence: None.

Gap: No implementing code yet.

MEET-004 is missing: Attendance facts from conferencing.

Evidence: None.

Gap: No implementing code yet.

PAY-001 is done: Paid bookings with Stripe.

Evidence: `tests/payments-wire.test.mjs`, `tests/booking-wire/payment-journey.mjs`, `tests/export-base-adoption.test.mjs`, `src/core/features/payments/`, `migrations/core/0068_stripe_payments.sql`, `evidence/contract/2026-10-21/PAY-001/`

Gap: A real Connect OAuth grant is not claimed: the fleet holds no Connect client ID (the test account has no Connect platform enabled, so the test-mode proof used the platform account through the Stripe-Account header) and Stripe-to-Dial webhook delivery to a deployed Worker is not observed; live ACH is unobserved. Refunds, deposits and fees now follow `PAY-003`, and tax, receipts and invoices `PAY-005`; packages and coupons, and reconciliation and disputes are carried by `PAY-004` and `PAY-006`, which each name this clause.

PAY-002 is missing: PayPal and Venmo.

Evidence: None.

Gap: No implementing code yet.

PAY-003 is done: Deposits, refunds and cancellation or no-show fees.

Evidence: `tests/payments-wire.test.mjs` ("PAY-003 deposits, refunds and cancellation or no-show fees move money once, only as shown", `tests/booking-wire/payment-terms-journey.mjs`), `tests/scheduling-report.test.mjs`, `tests/export-base-adoption.test.mjs`, `src/core/features/payments/`, `migrations/core/0069_deposits_refunds_fees.sql`, `scripts/verify-money-screens.mjs`

Gap: Built and proved with Stripe synthetic at the HTTP edge: event-type deposits (fixed or a percentage of each duration's price) with the balance paid through a 256-bit balance link (`AUTH-007`), a stated cancellation policy and late-cancellation and no-show fees shown before booking and on the manage page, an unchecked card consent recorded with its wording version, time and amounts, a card saved through Stripe Checkout (a SetupIntent when nothing is due at booking), automatic free-window refunds and late fees once, host full or partial refunds with a reason and no-show fees from the booking record, every movement with actor, amount, reason, time, Stripe reference and idempotency key, and fail-closed refusals when Stripe is not connected. A host-side cancellation (an operator from the booking record, the host's Google Calendar deletion or an expired host reschedule request) refunds everything captured in full once with no fee and voids the open balance Checkout or Stripe invoice; an operator refunds less or nothing only with a reason, which the invitee's cancellation mail states with the amount; a balance or invoice Stripe captured after the cancellation is recorded and refunded in full once. No real Stripe account or key was used: live refunds, off-session charges, invoice voids and Stripe's delivery of balance and invoice events to a deployed Dial are unobserved. A booking with no cancellation policy has no automatic refund or fee when the invitee cancels. The payment-terms journey also refuses consent after a fee edit, keeps pending refunds out of refunded totals, accepts a matching signed refund failure, recovers transient refund calls with their original key, and voids or refunds an invoice after a lost finalization response. A refused stale consent refreshes the displayed fees and clears its checkbox at 1440 and 390. Cancellation mail distinguishes a refund request from a completed refund; paid-invoice cancellations use the ledger-aware refund-choice form (`scripts/verify-money-screens.mjs`).

PAY-004 is partial: Packages, coupons and gift certificates.

Evidence: `tests/payments-wire.test.mjs` ("PAY-001 a paid booking confirms only after Stripe's signed event"), `tests/booking-wire/payment-entitlements-journey.mjs` (idempotent signed package purchase; code and email redemption; three sessions and named zero balance; atomic last-session race; eligible cancellation credit; expired USD gift; monthly subscription mode, controlled renewal, failed renewal and paid recovery; purchaser erasure), `tests/export-base-adoption.test.mjs` ("the actual Base cancellation ledger survives the full populated census and unknown future schema remains refused"), `tests/person-erasure.test.mjs` ("native email preview is inert; one confirmation erases personal rows, private mail and capabilities while preserving a control person"), `migrations/core/0083_payment_entitlements.sql`

Gap: "Hosts sell appointment packages (for example 5 coaching sessions valid for 6 months) and recurring appointment memberships through Stripe, and issue coupons and gift certificates in USD.": packages, monthly memberships and full-cover USD gifts have native operator and public HTTP commands; coupons remain unimplemented. "Invitees redeem them at booking with a code or the email they bought with" is proven at the confirmation HTTP door; the public details entry and purchase controls are not built. "Balances, expiry and redemption history appear to the host and, through the manage link, to the invitee" is available in authenticated host and manage-capability responses, but neither screen displays it and host configuration has no UI. Credit combined with saved-card fees, tax or approval is explicitly refused with credit_payment_terms_unsupported. Archives refuse any populated credit catalog or ledger with archive-payment-entitlements-not-portable; portable credit restoration remains unbuilt. Purchaser erasure cancels subscriptions, expires unpaid Checkout, removes booked and unbooked credit identities and preserves named immutable-Checkout cleanup requests.

PAY-005 is done: Sales tax, receipts and invoices.

Evidence: `tests/payments-wire.test.mjs` ("PAY-005 Stripe Tax shows and charges tax by address, and receipts and invoices carry matching amounts", `tests/booking-wire/payment-tax-journey.mjs`), `tests/export-base-adoption.test.mjs`, `src/core/features/payments/`, `migrations/core/0070_sales_tax_receipts_invoices.sql`, `scripts/verify-money-screens.mjs`

Gap: Built and proved with Stripe and Stripe Tax synthetic at the HTTP edge: a host turns on Stripe Tax and sets the business name in the payments settings; with tax on, the booking step takes a US billing address, shows Stripe Tax's sales tax before anything is held and refuses a confirmation whose tax differs from what was shown, and Checkout charges that tax as its own line (a deposit carries its share, the balance link the rest); a non-taxable address shows and charges none; every payment (upfront, deposit balance, invoice and saved-card fee) queues exactly one receipt with business name, amount, tax and Stripe reference to the invitee and the booking's host recipients only, with the receipt page and operator record showing the same figures; a host invoices an unpaid booking from its record on a Stripe-hosted invoice that only Stripe's signed `invoice.paid` marks paid, and issuing again returns the same invoice; refunds return tax in proportion; cancelling the booking voids its open invoice at Stripe, and an `invoice.paid` for a cancelled booking is recorded and refunded in full once (`tests/booking-wire/payment-terms-journey.mjs`). Dial stores tax amounts and the jurisdiction summary, never an address or card. No real Stripe account or key was used. Dial does not file Stripe Tax transactions, so the host's Stripe Tax reports do not list these charges; late-cancellation and no-show fees are charged as stated with no tax added. Invoices are issued from the record of an unpaid booking (operator-created or otherwise unpaid); a public priced event type cannot be booked as 'pay later by invoice'. Refusal of cancelled and upfront-paid bookings is asserted in `tests/booking-wire/payment-terms-journey.mjs`.

PAY-006 is partial: Payment reconciliation and accounting export.

Evidence: `tests/payments-wire.test.mjs` ("PAY-003/PAY-006 deposits, refunds, fees and reconciled accounting exports move or record money once, only as shown"), `tests/booking-wire/reconciliation-probes.mjs` (dashboard refund, dispute close, OAuth refusals, idempotent QuickBooks receipts and the sandbox API base; "PAY-006 erasure keeps reconciliation and export references only in anonymous audit"), `tests/export-base-adoption.test.mjs`, `scripts/verify-money-screens.mjs`, `evidence/contract/2026-10-26/PAY-006/qbo-sandbox.json` (sandbox export refused: custom transaction numbers disabled)

Gap: Default ADOPTED: CSV and anonymous QuickBooks Online receipts against a host-mapped income account; exports require a USD company and custom transaction numbers. Setting QBO_ENVIRONMENT to sandbox sends accounting calls to Intuit's sandbox base, which development keys require; this is asserted at the synthetic edge only, and no sandbox export has run. Tax-bearing receipts fail closed until accounting tax mapping is built. Xero is unbuilt. Pantry has no documented sales-receipt receiving door and stays link-only. No real provider call or consent was used; live captures, accounting exports and deployed webhook delivery are unobserved.

PAY-007 is done: Priced and saved-card-fee approval.

Evidence: `tests/approval-screens.test.mjs` (single and combined approval screens share one existing browser at 1440 and 390), `tests/booking-wire.test.mjs` (EVENT-008/PAY-007 approval requests authorize shown terms and confirm only after host approval and signed capture; single and combined upfront/deposit labels 1–9), `tests/booking-wire/paid-approval-journey.mjs`, `tests/booking-wire/paid-approval-combined.mjs`, `tests/booking-wire/paid-approval-combined-window.mjs`, `tests/booking-wire/paid-approval-movements.mjs`, `tests/export-base-adoption.test.mjs`, `tests/booking-wire/paid-approval-screens.mjs` (shared Verify browser, 1440/390), `migrations/core/0075_paid_approval.sql`, `ERASURE.md`

Gap: Upfront, deposit, free saved-card and combined priced/deposit-plus-fee requests have public-door assertions for all nine sentence labels. Combined requests manually authorize only the shown amount and complete a distinct SetupIntent on the consented Checkout card, bound to its frozen terms, before any host decision. An incomplete consent stage is unapprovable; lost responses reconcile with the original operation key, and an expired or refused setup cancels any pending challenge, voids the authorization and detaches the card before releasing the claim and sending one notice. Approval captures only the frozen total; only matching signed capture confirms once. Decline, expiry and host cancellation void and detach once; deposit balance links follow signed capture. Stale full prices, including an unchanged fixed deposit, and stale fee consent refuse before Stripe writes. Authorizations, captures, voids, detachments, fees and refunds retain actor, amount, reason and processor reference. Combined erasure lists void, detach and Customer anonymization in its receipt; historical archive commands remain inert. Stripe is synthetic at the HTTP edge; no real provider call or consent was used. Live captures, voids and deployed webhook delivery remain unobserved.

REQUEST-001 is done: Compose.

Evidence: `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing"), `src/core/features/availability-requests/service.ts`

Gap: None.

REQUEST-002 is done: Submit.

Evidence: `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing")

Gap: None.

REQUEST-003 is done: Operator workflow.

Evidence: `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing"), `tests/operator-creation-recovery.test.mjs`

Gap: Role refusals carried by `OPER-001`.

REQUEST-004 is done: Routing.

Evidence: `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing"), `src/core/features/availability-requests/repository.ts`, `src/core/features/event-types/ui/request-routing-fields.tsx`

Gap: None.

REQUEST-005 is done: Invitee updates.

Evidence: `tests/requests.test.mjs` ("reviewed alternative request flows through private handling and per-event mail routing")

Gap: None.

NOTIFY-001 is done: Booking confirmation.

Evidence: `tests/booking-wire/correspondence-journey.mjs`, `tests/booking-wire.test.mjs`, `tests/booking-axe/confirmation-settings.mjs`, `tests/mail-preferences.test.mjs` ("per-operator booking mail respects saved delivery preferences and recipient scope across restart"), `tests/lifecycle-journey.test.mjs`

Gap: Per-event templates and default-on invitee switch ship. Only a successful calendar invitation suppresses unsent Dial confirmation; absent/failed calendar delivery still sends it. Suppressed mail is labeled Not sent. Provider invitations now carry NOTIFY-009’s default-on invitation manage link; sessionless requests rotate and email the replacement only to the stored invitee and audit rotation, with the earlier-link notice in page and email.

NOTIFY-002 is done: Link completion.

Evidence: `tests/booking-wire.test.mjs`, `tests/providers-d1.test.mjs`

Gap: None.

NOTIFY-003 is done: Reminders.

Evidence: `tests/lifecycle-journey.test.mjs`, `tests/coordination.test.mjs`, `src/core/features/bookings/reminder-commands.ts`

Gap: Single-host recipients; two-host scoping is `NOTIFY-008`.

NOTIFY-004 is done: Changes.

Evidence: `tests/lifecycle-journey.test.mjs`, `tests/move-in-catch-up.test.mjs`

Gap: Single-host recipients; two-host scoping is `NOTIFY-008`.

NOTIFY-005 is done: Delivery failure.

Evidence: `tests/managed-mail.test.mjs`, `tests/lifecycle-journey.test.mjs`, `tests/booking-wire.test.mjs`

Gap: Retry-After is clamped to one hour from the first attempt; up to five retries are due by that deadline, with remaining retries immediately due at the deadline and late work final. Permanent failures and bounces retain typed reasons and safe resend.

NOTIFY-006 is partial: No mail loops.

Evidence: `tests/deploy-adoption.test.mjs`, `tests/mail-readiness-workerd.test.mjs`

Gap: Verified sending and ignored inbound mail ship; ordinary invitee mail lacks the assigned-host Reply-To, per-event No-reply choice and required replies-not-received notice.

NOTIFY-007 is done: Connection alerts.

Evidence: `tests/lifecycle-journey.test.mjs`, `scripts/lifecycle/connection-alert-timing.mjs`

Gap: Single-host: every operator is an owner.

NOTIFY-008 is done: Notification recipients.

Evidence: `src/core/features/delivery/booking-mails.ts`, `tests/mail-preferences.test.mjs` ("per-operator booking mail respects saved delivery preferences and recipient scope across restart"), `tests/booking-wire.test.mjs`

Gap: None.

NOTIFY-009 is partial: Invitation and message templates.

Evidence: `tests/booking-wire/correspondence-journey.mjs`, `tests/booking-wire/invitation-manage-journey.mjs`, `tests/booking-axe/invitation-manage.mjs`, `tests/booking-wire/reschedule-request-journey.mjs`, `src/core/features/event-types/ui/correspondence-editor.tsx`

Gap: Native per-event calendar and invitee confirmation/change/cancellation/reminder/request/request-reminder templates, escaped previews, named unknown/private-variable refusal, duplication and deleted-offer retention. Default-on invitation manage capabilities with a per-event toggle now email a replacement link only to the stored invitee, refuse earlier manage links and audit rotation; both email and sessionless page disclose that earlier links no longer work. Unknown/forged links return 404 and expired/canceled links return 410 without booking details. Managed team/locale templates, direct Reschedule/Cancel links, workflow confirmation suppression and From/Reply-To preview await their foundations. This clause owns CAL-003’s direct Reschedule/Cancel links and template scope beyond native Google, including other providers and managed team/locale templates.

NOTIFY-010 is missing: Reply-To and sender identity.

Evidence: None.

Gap: No implementing code yet.

FLOW-001 is partial: Workflow builder.

Evidence: `src/core/features/bookings/reminder-commands.ts`, `src/core/features/delivery/booking-mails.ts`, `tests/coordination.test.mjs`, `tests/lifecycle-journey.test.mjs`

Gap: The cited paths cover part of the clause; the rest is still to build.

FLOW-002 is missing: SMS reminders and confirmations.

Evidence: None.

Gap: No implementing code yet.

FLOW-003 is missing: Post-meeting follow-ups.

Evidence: None.

Gap: No implementing code yet.

FLOW-004 is missing: No-show handling.

Evidence: None.

Gap: No implementing code yet.

FLOW-005 is partial: Host notifications in Slack and Microsoft Teams.

Evidence: `tests/booking-wire.test.mjs` ("NOTIFY-001/NOTIFY-009/AUTH-007: production Google lifecycle and Base SendGrid outbox run on native D1; request-only needs no Google connection", `tests/booking-wire/notice-journey.mjs`), `tests/booking-record.test.mjs` (OPER-004 booking record journey), `scripts/verify-booking-record.mjs`, `tests/booking-axe/notice-settings.mjs`, `tests/export-base-adoption.test.mjs`

Gap: Default ADOPTED: owner-configured workspace notices; Teams uses a sealed Workflows URL. Routed-unbooked notices wait for ROUTE-001 and team scope waits for TEAM-002. Ambiguous remote sends are recorded outcome unknown and never automatically replayed. Teams Workflows supplies no deletion authority or downstream message receipt; person erasure reports pending manual cleanup. No real provider call or consent was used; live Slack/Teams posts and deployed webhook delivery are unobserved.

FLOW-006 is missing: RER Managed SMS.

Evidence: None.

Gap: No implementing code yet.

CLIENT-001 is partial: Client records.

Evidence: `tests/person-erasure.test.mjs` ("native email preview is inert; one confirmation erases personal rows, private mail and capabilities while preserving a control person"), `tests/booking-axe/client-records.mjs`, `tests/booking-axe/remembered-client.mjs`, `tests/erasure/remembered-details.mjs`, `src/core/features/clients/`

Gap: The Bookings Clients workspace groups folded primary-invitee emails, shows viewer-zone history, answers, attendance, read-only payments and booking fields, and opens the exact OPER-004 record. Operator merges preserve booking rows, retain aliases, notes and client text fields, and record the actor; erasure removes the full alias scope. A stored-address-only mailed capability fills saved name, email, phone and answers for one published event after explicit use, once within 15 minutes; requests acknowledge uniformly with a one-minute mail guard. Unbuilt: guest-only, pending-approval and alternative-request histories; shared typed client-field definitions and editing; across-host history (`TEAM-001`), packages (`PAY-004`), SMS consent (`FLOW-002`) and role scope (`OPER-001`).

REPORT-001 is partial: Scheduling analytics.

Evidence: `tests/scheduling-report.test.mjs`, `tests/review/report-month.ts`, `src/core/features/reports/`, `src/core/features/bookings/ui/scheduling-report.tsx`, `scripts/verify-report-screens.mjs`

Gap: Built for today's single-host install and proved on a seeded month: bookings created, rescheduled and canceled with reasons, no-show and attendance rates, lead time, popular days and hours in the host's zone across a daylight-saving change, bookings by the UTM and source values of `LINK-003` and by chosen duration (`EVENT-011`), and revenue, fees and refunds, each figure stating its definition and drilling through to exactly the bookings it counts; imported move-in bookings count by their source creation time and start and are shown separately. Open: choosing a host or a team (one host and no teams until `TEAM-001` and `TEAM-002`); routing-form submissions and conversion by route and UTM source (`ROUTE-001`); round-robin distribution (`TEAM-004`); a member seeing only their own figures (every operator is an owner until `OPER-001`, so that step is not claimed). Revenue, fees, refunds and net read `PAY-001` payments and `PAY-003` money movements.

REPORT-002 is partial: Host calendar view and booking workspace.

Evidence: `src/core/features/bookings/ui/calendar-workspace.tsx`, `src/core/features/bookings/ui/calendar-grid.tsx`, `tests/bookings-filters.test.mjs`, `tests/booking-axe/calendar.mjs`

Gap: Day, week and month share the list query, filters and paginated identity set in the viewer profile zone. Attendance filters are applied before count and pagination; the real single host is shown. Native and browser journeys cover the March spring-forward and February/March/April edges, imported placement, keyboard record opening and a real reschedule moving the calendar entry; month is an agenda at mobile width. Open: payment-state filtering, repeated-hour display proof, team filters, member columns and multi-host role scope. The complete mixed-subject acceptance sentence remains intact under ct’s conditional verbatim-carve form.

REPORT-003 is missing: Exports and scheduled reports.

Evidence: None.

Gap: Filtered reporting CSVs and scheduled member reports are absent; the owner archive is DATA-001, not this reporting flow.

API-001 is missing: Public REST API.

Evidence: None.

Gap: No versioned credential-authorized public API, cursor pagination, per-credential limits or OpenAPI document ships; existing page-internal and invitee-capability JSON routes are not this API.

API-002 is missing: Webhooks.

Evidence: None.

Gap: Owns subscriber and webhook dispatch of CAL-006’s natively recorded `calendar.connection-health-changed.v1` transition facts, including their event IDs, states, reasons and times. Delivery is not implemented.

API-003 is missing: Machine-credential booking API.

Evidence: None.

Gap: No machine credential, scoped bearer door, per-event-type or per-calendar scope, rotation, machine actor in history, notices or audit, scoped webhook subscription or replay, or archive handling of credentials ships; AUTH-008, API-001 and API-002 are themselves unbuilt, so this clause builds on them and proves its door only once those exist.

INTEG-001 is missing: Zapier, Make and Crank.

Evidence: None.

Gap: No implementing code yet.

INTEG-002 is missing: HubSpot.

Evidence: None.

Gap: No implementing code yet. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`).

INTEG-003 is missing: Salesforce.

Evidence: None.

Gap: No implementing code yet. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`).

INTEG-004 is missing: Orbit and Pipedrive.

Evidence: None.

Gap: No implementing code yet. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`).

INTEG-005 is missing: Calendar and conferencing marketplace presence.

Evidence: None.

Gap: No implementing code yet.

INTEG-006 is done: Analytics and conversion tracking.

Evidence: `tests/booking-wire.test.mjs` — "booking analytics emits configured events once and stays silent without tags at desktop and mobile", `tests/booking-axe/analytics.mjs` (GA4 events once, unconfigured silence, tag controls, privacy notice and sandboxed vendor context at 1440 and 390); `tests/booking-wire.test.mjs` — "configured booking analytics uploads click-only conversions once and honors revoked or erased authority", `tests/booking-wire/analytics-journey.mjs` (Google and LinkedIn click IDs without answers, retries and replay, disconnect and erasure); `tests/export-base-adoption.test.mjs` — "the actual Base cancellation ledger survives the full populated census and unknown future schema remains refused" (credentials require reconnect and restored conversions stay historical); `tests/archive-prior-release.test.mjs` — "a backup made by the listed release restores through rer import with every archived value and file, under either migration ledger"; `RULINGS.md` RL-1 records future routing-form inheritance.

Gap: None.

INTEG-007 is missing: Intercom.

Evidence: None.

Gap: No implementing code yet.

INTEG-008 is missing: Microsoft Dynamics 365 Sales.

Evidence: None.

Gap: No implementing code yet. The phone question's normalized E.164 value maps to the CRM phone field (`EVENT-003`).

DATA-001 is done: Export contents.

Evidence: `tests/export-base-adoption.test.mjs`, `tests/export-redaction.test.mjs`, `tests/export-restored-behavior.test.mjs`, `tests/local-setup-journey.test.mjs`

Gap: None.

DATA-002 is partial: Destructive personal erasure.

Evidence: `tests/person-erasure.test.mjs`, `tests/import-custody-erasure.test.mjs`, `ERASURE.md`

Gap: Owner case; role scope missing.

DATA-003 is done: Move-in import.

Evidence: `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs`, `tests/move-in-browser.test.mjs`, `tests/move-in-portability.test.mjs`, `tests/move-in-download.test.mjs`

Gap: None.

DATA-004 is done: Full-scope portability and erasure.

Evidence: `tests/export-base-adoption.test.mjs`, `tests/person-erasure.test.mjs`, `ERASURE.md`; Verify 39673090704 and Run site 39673090829 success on f553bfdc224bc544d74f68a5aaa7eca63ed3b322

Gap: Classification gate and current-kind round trip asserted. Target kinds carried by `DATA-005`–`DATA-008`.

DATA-005 is partial: Target record kinds in the archive.

Evidence: `tests/export-base-adoption.test.mjs`, `tests/archive/client-upgrade.mjs`, `tests/archive/poll-upgrade.mjs`, `tests/archive/payment-erasure-upgrade.mjs`

Gap: Host profiles, schedules, guests, payment references and both phone carriers round-trip. The client landing adds profiles, aliases, notes and text fields; this poll landing adds polls, candidates, participants and votes. Saved-details and poll capabilities and hashes are excluded, mail links scrubbed, and restored polls are closed with no live hold or participation authority. The c12 port adds processor facts and accounting export receipts, workspace notice destinations, delivery outcomes and anonymous erasure requests. Accounting and notice credentials/OAuth states are excluded, destinations require reconnect and restored commands cannot execute. Seats, recurring series and other target kinds await their feature clauses.

DATA-006 is partial: Target personal rows in erasure.

Evidence: `tests/person-erasure.test.mjs` ("native email preview is inert; one confirmation erases personal rows, private mail and capabilities while preserving a control person"), `tests/erasure/remembered-details.mjs`, `tests/export-base-adoption.test.mjs`

Gap: The combined native journey removes guest rows, phone answers and invitee-phone locations, merged client records, every alias, notes, text fields and saved-details links, while control booking, guest and client histories stay unchanged and identity-free merge audit remains. The same journey now removes the person’s poll votes, participant and token rows and private invitation mail; a changed vote invalidates an older erasure preview, and the control participant remains byte-identical. Phone, client and poll carriers round-trip. Open: SMS consent rows (`FLOW-002`) are unbuilt.

DATA-007 is done: Processor deletion requests.

Evidence: `tests/payments-wire.test.mjs` (PAY-003 deposits, refunds and cancellation or no-show fees move money once, only as shown; DATA-007 processor requests match Stripe and calendar outcomes), `tests/booking-wire/payment-erasure-probes.mjs`, `tests/person-erasure.test.mjs` (native email preview is inert), `tests/export-base-adoption.test.mjs` (the actual Base cancellation ledger survives the full populated census), `scripts/verify-payment-erasure-screens.mjs` (runPaymentErasureScreens, shared Verify browser), `migrations/core/0076_processor_erasure_requests.sql`, `ERASURE.md`

Gap: Today’s connected Stripe and calendar cleanup is listed per request, with processor reference and completed, pending or named failed result. Known Customers are anonymized, saved cards detached, and calendar events cancelled; native probes compare the receipt with the exact HTTP requests, preserve a control person, and assert refusal, retry, duplicate erasure and known-zero Customer creation. Preview and Settings completion lists run at 1440 and 390 with no serious axe finding or overflow. Default ADOPTED: anonymize Customers, retaining only anonymous cleanup lookup references after local erasure. Existing Checkout email cannot be edited or erased through the Session API and stays explicitly pending with no invented request; ambiguous historical Customer creation stays unobserved. PayPal and Venmo remain with `PAY-002`, which does not yet connect either processor. Providers are synthetic at the HTTP edge; no real provider call or consent was used. Live anonymizations and deployed webhook delivery remain unobserved.

DATA-008 is missing: CRM deletion requests.

Evidence: None.

Gap: No CRM integration exists.

MIGRATE-001 is partial: Calendly move-in, connected.

Evidence: `src/core/features/move-in/service.ts`, `src/core/features/move-in/map-events.ts`, `scripts/move-in/download-calendly.mjs`, `tests/move-in-runtime.test.mjs`, `tests/move-in-catch-up.test.mjs`

Gap: The cited paths cover part of the clause; the rest is still to build.

MIGRATE-002 is missing: Acuity Scheduling move-in.

Evidence: None.

Gap: No implementing code yet.

MIGRATE-003 is missing: Microsoft Bookings move-in.

Evidence: None.

Gap: No implementing code yet.

MIGRATE-004 is missing: Cal.com, SavvyCal, Doodle and generic move-in.

Evidence: None.

Gap: No implementing code yet.

MIGRATE-005 is partial: Cutover and old links.

Evidence: `src/core/features/move-in/switch-over.ts`, `tests/move-in-catch-up.test.mjs`, `tests/move-in-browser.test.mjs`

Gap: The cited paths cover part of the clause; the rest is still to build.

CUSTOM-001 is done: Operator annotations.

Evidence: `tests/custom-fields.test.mjs`

Gap: Role refusals carried by `OPER-001`.

CUSTOM-002 is done: Annotation privacy and portability.

Evidence: `tests/custom-fields.test.mjs`

Gap: None.

AGENT-001 is missing: Agent authority, limits and audit.

Evidence: None.

Gap: No implementing code yet.

AGENT-002 is missing: Exception negotiator.

Evidence: None.

Gap: No agent constraint solver, exception proposals or approval-to-offered-times flow ships; alternative requests are handled manually.

AGENT-003 is missing: Unanswered-thread follow-up.

Evidence: None.

Gap: No implementing code yet.

AGENT-004 is partial: Calendar drift reconciler.

Evidence: `src/core/features/bookings/calendar-reconciliation.ts`, `src/core/features/calendar-connection/external-sync.ts`, `tests/booking-wire.test.mjs`

Gap: The cited paths cover part of the clause; the rest is still to build.

AGENT-005 is missing: Meeting happened check.

Evidence: None.

Gap: No agent evidence assembly, attendance proposals or host-confirmation flow ships; BOOK-011 supports manual attendance marks only.

AGENT-006 is missing: No-show recovery.

Evidence: None.

Gap: No implementing code yet.

AGENT-007 is missing: Meeting follow-through.

Evidence: None.

Gap: No implementing code yet.

AGENT-008 is missing: Pre-meeting brief.

Evidence: None.

Gap: No implementing code yet.

AGENT-009 is missing: Scheduling assistant in email threads.

Evidence: None.

Gap: No implementing code yet.

AGENT-010 is missing: Flexible holds and availability tuning.

Evidence: None.

Gap: No implementing code yet.

AGENT-011 is missing: Voice booking through a contracted provider.

Evidence: None.

Gap: No implementing code yet.
