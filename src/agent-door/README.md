# Dial native door preparation

This directory is source preparation, not a shipped agent door. The production
Worker does not import it. There is no `agent-surface.json`, applied agent-door
migration, production Business receiver, queued-consent handoff or MCP claim.
The 116 tool declarations and ten resource readers are not production registries.
No contract clause is marked complete by these adapters.

The copied Base runtime is recorded at
`e1b4265eb0d839a67dae3c36a04f83fa48c9d480`. MCP supports `2026-07-28` and
`2025-11-25`. Initializing `2025-03-26` correctly returns HTTP 400 and JSON-RPC
`UnsupportedProtocolVersion` (`-32022`); March's batched transport and legacy
result schema are not supported. The copied transport remains unchanged.

`tools.ts` collects adapters for the real profile, event, availability, calendar,
booking, alternative-request, delivery, report, client, poll, booking-link,
custom-field, branding, Stripe, accounting, entitlement and notice services.
The intended specialist is a scheduling coordinator acting for a current native
owner. `native-tool.ts` parses arguments, checks current native owner authority,
and supplies server classifications and summaries. Monetary policy measures
use integer USD cents; approval summaries display dollars. Adapter calls remain
unverified until the production integration and complete journey run.

`resources.ts` prepares ten native resource templates. Readers require current
owner authority and `dial:read`; missing and restricted reads both return null.
They use real native IDs, explicit projections and untrusted-text markers.
Delivery payloads, mail bodies, payment capabilities and provider credentials
are excluded. History-only clients without a native profile ID are not invented
as records; payment resources use the native `booking_payments.id`.

The prepared `people.ts` and `business.ts` adapters bind signed Business owner
IDs through the native setup-owner record. They remain unmounted. Business team
rows report conflicts: the applied native schema permits only equal-owner
operators, and cannot provision admin/member accounts. Preserve admission: owners can use the
operator APIs, admins have a move-in exception, and members have no operator
product access. Business identity must never select authority by token email or
create equal-owner accounts for a team admin/member.

Additive migrations `0090_business_settings.sql` and `0091_business_people.sql`
prepare the signed settings store and durable Business IDs. The native setup-owner
record remains authoritative. Unknown subjects, inactive or allow-list-excluded
owners cannot sponsor calls. Business settings, native bindings and invitation
authority stay installation-local during archive transfer; the destination must
pair again. Override and logo storage are also local while the receiver is
unmounted; portable branding requires its own native custody integration.

Mounting mutations also requires Base to support several native continuation
items under one originating admission. Dial creates both 24-hour and one-hour
reminders for each recipient in one booking transaction. The current continuation
claim is keyed by operation, tool and original public key; distinct items sent
through one dispatch tool collide with `idempotency_conflict`. Do not remove the
originating operation ID, merge future reminders into an early dispatch, or skip
the final consent check to evade that limitation.

The existing narrowing-only calendar disconnect declaration is retained. Its full
conformance journey must prepare a real native OAuth connection for every pass;
a provider-edge response alone cannot restore native connection authority after
disconnect. Stripe disconnect also needs a native read-only grant witness before
its narrowing coverage can be declared.

The integration must preserve booking Durable Object serialization, carry
originating consent, sponsor, scopes, client and agent attribution atomically
with native outbox work, and reenter the public door at final dispatch. A direct
service call alone does not provide that custody or native activity attribution.
Mount one copied `createAgentDoor` before application redirects, retain browser
Origin/session/CSRF checks, then declare the complete registry and real provider
edge fixtures in the conformance journey. No transport, auth or policy stand-in
belongs in production.

Known unfinished boundaries are explicit: provider OAuth, device, installation
and import work retain their existing doors; Teams setup retains its secret URL
at the connector door; link creation needs a secure person handoff for its
one-time capability; destructive erasure needs the real native-session proof;
operator invitations need their native request/coordination boundary. Taxed
invoice classification needs a native quote before approval, and money recovery
must account for all effects it would dispatch. The pin now provides record-only
security effects and per-surface escalation declarations; native adapters and
their full journey still need integration. Do not fabricate an escalation,
discard a required native verb or claim these paths are finished. No provider
`cost` or spend enforcement is registered.

The ct source remains read-only at
`bab78f7386586562c389505b2e8cb367efb0ddf7`: 27 aggregate tool rows, ten resources,
and clauses ending at `AGENT-011`. Its branch is not merged, and the missing
clause identifiers are not invented. There is no specialist journey or native
conformance evidence yet.
