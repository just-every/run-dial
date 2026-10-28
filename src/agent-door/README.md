# Dial native door preparation

This directory is source preparation, not a shipped agent door. The production
Worker does not import it. There is no `agent-surface.json`, applied agent-door
migration, signed Business-person binding, queued-consent handoff or MCP claim.
No contract clause is marked complete by these adapters.

The copied Base runtime is recorded at
`7ce44fa5b70b68b21d270ba54760dae28b4a37a7`. That combined head still rejects
MCP `2025-03-26` with HTTP 400 and JSON-RPC `-32022`; its `wire.ts` advertises
only `2026-07-28` and `2025-11-25`. The brief requires the older protocol, and
copied Base transport is not patched here. Base must supply a descendant with
the promised G3 support before native mounting and conformance can proceed.

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

Before mounting, connect signed settings to the native setup-owner ID and
existing native team IDs. Preserve Dial's current admission: owners can use the
operator APIs, admins have a move-in exception, and members have no operator
product access. Business identity must never select authority by token email or
create equal-owner accounts for a team admin/member.

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
must account for all effects it would dispatch. Security settings without an
authority subject need Base's G14 contract. Do not fabricate an escalation,
discard a required native verb or claim these paths are finished. No provider
`cost` or spend enforcement is registered.

The ct source remains read-only at
`bab78f7386586562c389505b2e8cb367efb0ddf7`: 27 aggregate tool rows, ten resources,
and clauses ending at `AGENT-011`. Its branch is not merged, and the missing
clause identifiers are not invented. There is no specialist journey or native
conformance evidence yet.
