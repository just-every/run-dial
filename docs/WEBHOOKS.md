# Webhooks

Dial sends selected durable events to an HTTPS receiver you control. Configure subscriptions in **Settings → Webhooks** at `/app/settings`. The management APIs require the installation's native operator session; the current single-host installation has owners as its operators.

## Create a subscription

Enter a public HTTPS endpoint, choose events and a scope, then authorize sending the selected event data to that endpoint. Choose **Create webhook and send events**. Dial validates the endpoint again before each attempt. Private addresses, credentials in URLs and URL fragments are refused; redirects do not receive the signed event body.

The scope can be the workspace, the current real host, or an existing team. Host scope uses the actual host profile ID. Team scope uses an existing team ID and its event membership, rather than an arbitrary label. With no teams, Settings disables team scope and explains how to proceed. Calendar connection health events have no event-type membership and therefore do not match team scope. Routing submissions without a matching team or team event likewise do not match that team.

GET `/api/app/webhooks` returns `subscriptions`, the newest 100 `deliveries`, `eventTypes`, `hostId`, and `teams` containing each team's `id` and `name`. Use the returned event identifiers rather than inventing them. The current events cover booking creation, rescheduling, reschedule requests, cancellation, no-shows, attendance and payments; poll creation, voting and closing; routing submissions; and calendar connection health changes.

POST `/api/app/webhooks` creates the subscription and returns HTTP 201 with `id` and `secret`. This workspace example is a template: replace the synthetic endpoint with your real receiver before submitting. Every value prefixed with `synthetic-dial` in this guide is an illustrative placeholder, not a usable ID, capability or credential.

```json
{
  "endpoint": "https://synthetic-dial.example/webhooks",
  "events": ["booking.created.v1", "routing.submitted.v1"],
  "scope": "workspace",
  "scopeId": null
}
```

For host scope, send `scope` as `host` and `scopeId` as the `hostId` returned by GET. For team scope, send `scope` as `team` and `scopeId` as an ID from the returned `teams`. Workspace scope requires a null `scopeId`. Invalid event identifiers or nonexistent scopes are refused.

The creation response is the only opportunity to retrieve the signing secret. Settings displays it locally until **I stored the secret — dismiss** is selected. Store it securely at the receiver. Reloading or dismissing the display loses that opportunity; later status responses do not contain the secret. To replace a lost secret, delete the subscription and create a new one.

## Verify each request

Dial sends a JSON POST with `Content-Type: application/json`, `Dial-Event-Id`, and `Dial-Signature`. The signature header contains `t` as a Unix timestamp in seconds and `v1` as a lowercase hexadecimal HMAC-SHA256 signature.

At the receiver:

1. Preserve the exact raw request body before JSON parsing.
2. Read `t` and `v1` from `Dial-Signature` and reject a timestamp outside a five-minute window relative to the receiver's clock.
3. Compute HMAC-SHA256 with the subscription's signing secret over the UTF-8 bytes of `t + '.' + rawBody`. Compare the hexadecimal result with `v1` using a constant-time comparison.
4. After verification, deduplicate using the stable event ID in `Dial-Event-Id` and the payload's `id`. Store that ID with the receiver's durable processing result so concurrent or repeated deliveries cannot apply the same effect twice.

The JSON envelope contains `id`, `type`, `occurredAt` and event-specific `data`. Booking payloads include booking and event-type IDs, state, occurrence sequence, times, duration and attribution. Routing payloads include submission, form, matched rule and event-type IDs plus the submission state. Do not reconstruct the body with JSON serialization before checking its signature.

## Delivery outcomes and replay

Choose **Load deliveries** in Settings to inspect delivery status, HTTP response code, attempt count and event ID. **Refresh deliveries** fetches the latest status without automatically refreshing the screen. States are `pending`, `sending`, `delivered` and `failed`; a null response code means Dial recorded no HTTP response, not that the receiver did no work.

A successful HTTP 2xx response marks delivery as delivered. Other HTTP responses, transport failures and the ten-second request timeout are retried within a 24-hour window measured from the event. Retry delays start at one minute and grow exponentially, capped at one hour. Due work runs through the queue and scheduled background processing, so the next-attempt time is eligibility rather than a precise arrival promise. Delivery can ultimately fail; these are bounded, at-least-once attempts rather than a guarantee of successful receipt.

If the receiver commits work but its HTTP response is lost, Dial cannot know the outcome and sends the event again. Retries preserve the exact body and event ID while computing a fresh timestamp and signature. Receiver deduplication is required even when every previous request appeared to fail.

For a delivered or failed event, choose **Redeliver event**, or POST `/api/app/webhook-deliveries/:id/redeliver` using the delivery ID. A successful response is `{"queued":true}`. Manual replay preserves the same body and event ID, resets the attempt count, starts a new 24-hour window and signs each new attempt freshly. Pending or sending deliveries cannot be manually replayed. A missing subscription, disabled restored subscription, or erased booking makes replay unavailable; a refusal returns HTTP 404 without queuing delivery. Erasure removes booking-linked delivery bodies, and an erasure in progress also prevents their dispatch.

Choose **Delete webhook**, or DELETE `/api/app/webhooks/:id` using the subscription ID, to remove the subscription, signing authority and its queued delivery records. The API returns `{"deleted":true}`. This stops future sends; a request already in flight can still have reached the receiver.

Archive restore leaves webhook subscriptions disabled with no signing secret and restored deliveries failed as historical commands. Restore does not resume outbound delivery or enable manual replay of those commands. Create new subscriptions deliberately after restoration.

## Team setup and routing event sources

The current team foundation associates event types with the installation's one actual host. It does not implement a full multi-host team scheduling product or a team management interface. Configure the host profile first. GET `/api/app/teams` lists teams with `hostId` and `eventTypeIds`. POST `/api/app/teams` creates a team with a name and existing event-type IDs:

```json
{
  "name": "synthetic-dial-team",
  "eventTypeIds": ["synthetic-dial-event-type-id"]
}
```

Replace the illustrative event ID with an existing event-type ID from your installation. Real IDs must satisfy the API's 26-character uppercase ID format. The returned team belongs to the configured host; its event membership determines which booking and poll events match team subscriptions. Use the returned team ID for a webhook's team `scopeId`.

Native routing APIs provide a real `routing.submitted.v1` event source. GET `/api/app/routing-forms` lists forms. POST `/api/app/routing-forms` accepts a title, `questions` with `key`, `label` and `required`, ordered `rules` with `id`, `questionKey`, `equals`, `eventTypeId` and optional `teamId`, and a `defaultMessage`. Question keys must be unique identifiers; each rule must refer to a configured question and a published event type. A rule with a team must target an event type belonging to that team and the real host.

GET `/api/public/routing/:id` returns the form's questions and a submission capability with `nonce` and `expiresAt`. POST `/api/public/routing/:id/submit` accepts that nonce and an `answers` object keyed by the configured question keys. The capability expires after 15 minutes. The first exact matching rule yields a booking path; no matching rule yields the configured message. Required answers and unknown question keys are checked. Repeating the same answers with the same capability returns the stored result without creating another submission; changing those answers is refused. Each newly persisted submission records the routing event for matching webhook subscriptions. These native API flows do not imply that a complete routing product interface is available.

Implementation references: ./src/core/features/webhooks/routes.ts, ./src/core/features/webhooks/subscriptions.ts, ./src/core/features/webhooks/delivery.ts, ./src/core/features/webhooks/endpoint.ts, ./src/core/features/webhooks/ui/settings-card.tsx, ./src/core/features/teams/routes.ts, ./src/core/features/routing/routes.ts, ./src/core/features/routing/types.ts, ./src/core/features/routing/repository.ts, ./migrations/core/0086_webhooks.sql and ./scripts/archive/policy.mjs.
