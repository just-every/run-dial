# Operator notification removal

Pending notifications and their invocation/removal order.
It adds migrations 0014 and 0015; all thirteen prior migrations and management policy remain unchanged.

## Recipient paths

| Producer | Recipient authority | Delivery behavior |
| --- | --- | --- |
| Booking confirmation, reschedule and cancellation (`bookings/service.ts`, `write-commands.ts`) | Existing explicit `recipientRole` | Operator copies require active access; invitee copies retain their own authority. |
| Booking reminders (`bookings/reminder-commands.ts`) | Existing explicit role, current future occurrence | Same access check; booking-mail mute remains a separate operator preference. |
| Connection alerts (`delivery/repository.ts`) | New explicit operator role; historical `connection:…:operator:…` key | Access is checked at consumption, including existing roleless and frozen rows. |
| Alternative requests (`availability-requests/repository.ts`) | New explicit roles; historical request/operator/submitted key | Operator routing is revoked; public acknowledgements and handled/closed notices remain eligible. |
| Meeting-link-ready mail (`delivery/repository.ts`) | Booking invitee only | Never inferred to be an operator notice from its email address. |
| Sign-in and invitation (`operators/service.ts`) | Active native allow-list and single-use link | Direct mail, outside the durable notification outbox; existing access/session/link revocation remains unchanged. |

Every durable mail effect passes through `ProviderDeliveryService.execute`.
The shared operator-mail predicate checks the command's role or its historical
server-generated key. The actual recipient comes from frozen `wireMail.to` when
present. The same predicate is used by the removal transaction and the send-time
check; an email address alone never classifies a message as operator mail.
Historical key recognition uses equality/substrings rather than GLOB: the native
D1 test exposed its pattern-complexity limit on this query. No historical payload
is rewritten into the new schema merely to make classification work.

## Recipient admissions

Every producer selects operator ID and `access_generation` with the recipient
email in the same query and retains that snapshot as `operatorAccess` in its
command. Confirmation/change/cancellation mail, both reminders, alternative
requests and connection alerts carry it. Migration 0015 increments the generation
on removal, independently of later reinvitation. Its insert trigger persists a
stale selected recipient as a visible failed with reason `operator_removed` command even when
insertion happens after both removal and reinvitation scans. Consumption validates
the same identity/generation and the actual frozen recipient. Historical commands
without a snapshot belong only to generation zero; they can never borrow authority
from a later reinvitation. Identities already removed before the upgrade start at
a retired generation. The migration does not rewrite prior payloads.

## Durable policy

Removal atomically revokes sessions/unused links and annotates all of the
operator's notification commands with `operatorAccessRevoked`. Pending and
processing commands become visible failures with `operator_removed`. Already
failed or completed commands retain their state, error, provider receipt,
succeeded timestamp and complete attempt history. No record is deleted.

The annotation is delivery authority metadata. It leaves original message
fields, `wireMail`, attachments and both idempotency keys intact. Explicit retry
refuses revoked commands, including a formerly successful command that receives
a late bounce. Retries already created before removal are revoked too.

The send path and repository removal both enter the same named Durable Object
(`operator-notifications`) in the existing BookingCoordinator namespace. Its
`blockConcurrencyWhile` gate encloses the durable authority read, invocation
admission, synchronous `MailSender.send` call and returned outcome. Removal's
transaction runs in that same gate. Delaying an authorization SELECT response
cannot allow removal to finish and a stale sender to invoke afterward. If removal
runs first, the queued invocation reads the revoked row and fails. If sending runs
first, removal waits for the adapter call to finish (the production adapter bounds
its request/response-body wait at ten seconds). Other booking/request coordinators
retain their own lifecycle gates while awaiting notification dispatch. The
notification gate does not call back into those coordinators; unlinked alerts use
the same notification gate. Independent invitee mail remains outside it.

Migration 0014 adds `operator_mail_invocations`, keyed by outbox ID and attempt.
Admission is persisted before invoking the adapter. A returned receipt is persisted
and can recover command completion without invoking the provider again. A returned
error records the actual error code and leaves the existing bounded, same-key retry
policy intact; a returned timeout is not proof that the provider rejected mail.
An interrupted call leaves `invoking` in the journal: this means the outcome is
unknown, including interruption between admission and the actual call. Recovery
never treats age as proof of no effect. Automatic processing and explicit retry
cannot send again under that provider identity; the visible failure is
`operator_mail_outcome_unknown`. There is deliberately no automatic reset or
provider-result invention. Removal can still proceed after the old invocation has
ended or its Worker has terminated. Reinvitation admits new commands, without
altering the unknown history. Journal rows follow outbox erasure by foreign key.

The journal records invocation outcomes, not delivery/read receipts or recall.
All returned errors and unresolved admissions remain inspectable even when
removal separately retires future notification authority.

Reinvitation keeps the existing operator identity and permits newly created
notifications. It never resumes former work: access to future notifications is
a new admission, not consent to replay old messages. Reinvitation first retires
unprocessed commands for an already-removed identity in the same transaction,
covering removals performed by the earlier candidate before this repair. Repeated
invitation of an already-active identity does not revoke its current work.
Existing failed work stays inspectable instead of being silently acknowledged as
successful suppression. Booking-mail muting keeps its prior distinct semantics.

A provider request already invoked before removal cannot be recalled. Its actual
acceptance or ambiguity stays in the delivery attempts; this local check makes
no live-provider cancellation or recall claim.

## Local regression

`node --test tests/operator-removal-mail.test.mjs` uses actual local workerd,
D1, native public booking/request APIs, native authenticated removal/reinvitation,
and actual process restart. Providers are isolated test sinks; their recorded
calls and effects are inspected, not inferred from command completion. Seven proof
groups plus the enclosing test cover:

- Queue before removal: legacy and new connection/request notices, booking
  confirmations, reminders, a frozen automatic retry and an explicit child retry.
- Public invitee confirmations, reminders and alternative-request lifecycle mail
  at the removed operator's email continue to send.
- Reinvitation/restart retain revocation, failure visibility and retry identities.
- Active operator retries keep identical provider bytes/key, and the sink records
  one effect despite two invocations after ambiguous acceptance.
- Completed historical mail keeps its receipt; a later failure cannot be resent
  after reinvitation.
- Earlier-candidate removal with historical unprocessed/frozen alerts is safe at
  send time and before reactivation.
- The real compiler-generated private Start function denies missing, forged and
  revoked sessions, while an active native session can read the private shell.

## Ordering regression

`node --test tests/operator-mail-order.test.mjs` executes the real delivery service,
removal repository, Durable Object and D1. Test-only D1 wrappers delay actual SELECT
responses without replacing results, and an isolated mail adapter records invocation
before returning. Eleven nested proofs cover removal committing during the outer read,
removal waiting during the final gate read, returned ambiguous provider failure,
actual Worker interruption/restart retaining unknown authority, receipt recovery
without a second invocation, interruption between admission and invocation,
independent invitee/invitation delivery, and delayed real producer SELECT responses
crossing removal/reinvitation for alerts, confirmations/reminders, cancellation and
alternative requests.
`tests/operator-mail-invocation-migration.test.mjs` applies 0014 and 0015 to data created under
all thirteen prior migrations and checks preserved records, erasure cascade and
stale, legacy and fresh recipient admission at insertion.
Original tests/fixtures, dependency files, public-booking source and runner deadlines
are not changed by this ordering repair. No real provider effect is exercised.
