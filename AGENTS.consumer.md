# Working on this edition

This repository contains the editable source of the owner's product. Dial's public source is [just-every/run-dial](https://github.com/just-every/run-dial). Read `CONTRACT.md`, `BASELINE.md`, `seed.json`, `HANDOVER.md`, actual package
scripts and existing customisations before changing behaviour. Use `README.md`
where present; distinguish product requirements from implemented scope and
verification coverage.
Read `.seed/intent.md` where present and treat its recorded owner requirements as
binding until the owner changes them.

## About this product

The following describes the product requirements; consult its handover for implemented scope.

Dial is an invitee-first scheduler for one business or independent host. Operators publish a host profile and event types, connect the host's calendars, and define availability; invitees book a genuinely free time without an account, receive calendar and email follow-through, and can reschedule, cancel, or request another window.

This seed intentionally does not include team routing, pooled availability, campaigns, or a marketplace. Paid bookings go through the host's own Stripe account (PAY-001), with deposits, refunds and cancellation or no-show fees (PAY-003) and Stripe Tax sales tax, receipts and invoices (PAY-005); reconciliation is not included. Its core promise is a reliable one-to-one booking lifecycle whose calendar, meeting, and mail failures remain visible and recoverable.

## Run the product

Follow this edition's README and actual package scripts for installation, local
startup, verification, provisioning and deployment. Check required accounts,
credentials, bindings and migrations before running a command. Use the configured
health endpoint and real application journeys to establish what works.

Do not infer provisioning from a command named `setup`, deployment from a push,
or previews from a pull request. Those behaviours require actual scripts or
workflows. Missing configuration must remain visible. Never invent working
providers, sample data, mock services or fallback application behaviour.

## Make it fit

The owner may edit all source, including base code, family domain, modules,
schema, application UI, framework, infrastructure, configuration and tests for
new owner requirements. This is a
complete repository; authoring repositories are not runtime services it needs.
Choose the coherent change that minimises total work, cost, elapsed time and
owner attention, including future verification and updates.

Use existing configuration or extension APIs where they help. Core changes are
fully legitimate. Adding or removing capabilities requires handling their data,
dependencies and integrated journeys explicitly. Keep files small, remove dead
code, and preserve server-side authorisation and secret boundaries. Access data
through the product's repository layer and validate inputs at trust boundaries.
Declare new externals and isolate their integration. Preserve applied migration
history while changing core schema through tested forward migrations and recovery.

Record intentional departures in the edition’s existing requirements, divergence
or intent documents (`.seed/intent.md` is optional), with tests for the required behavior. Do not silently weaken a guarantee
or edit its upstream test to hide a regression. Use the edition's implemented
contract override mechanism with appropriate replacement verification. Record
owner-authorized changes to requirements, including any changed security
guarantees; existing authorization is sufficient. If tooling is missing, record the gap and
verify the intended behaviour directly without pretending an override passed.

Preserve owner-local paths such as `src/ext/`, `.seed/`, `migrations/ext/` and
`tests/local/` during updates, alongside customisations elsewhere. These are
conventions, not a general automatic-update guarantee or a limit on source edits.

## Verify and update

Run the edition's documented verification and exercise the affected journeys on
the real local app or a preview. Report uncovered or failing guarantees plainly.
A clean build or passing upstream tests alone does not prove owner intent survived.
No production mocks, hidden failures or semantic fallbacks.

Read the release changes, provenance and recorded intent before updating. Prepare
a candidate away from the live installation. Use update tooling only when the
edition supplies it; choose merge, rebase, reapplication or rewriting as appropriate.
Never regenerate over the owner's fork or discard conflicting work wholesale.
Verify applicable product guarantees, declared overrides and local intent tests
before adoption. Record what changed, what passed and any remaining limitation.

The owner may keep and change the MIT source independently of management services.
Use documented, verified export and restore procedures for data portability;
do not promise a command or recovery capability that has not been implemented.

Roll useful edition mechanisms and regression tests into maintained shared source
when they save work elsewhere. Verify adoption against each edition’s requirements;
a deep local variant can still adopt or adapt later upstream improvements.
