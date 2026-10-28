# Capture Cal.com or SavvyCal

Use **Move in → Cal.com** or **Move in → SavvyCal** with a personal API token, or capture on your own computer with the command below. The capture reads your account, event types and bookings. It never changes the provider account. Upload the saved JSON file, inspect every changed or skipped field, and apply the reviewed plan. Event types arrive as drafts; bookings are imported silently through the same review and apply process.

The terminal command reads the token from `CALCOM_TOKEN` or `SAVVYCAL_TOKEN`. Set that variable privately using your shell or secret manager. Do not put tokens in command arguments, capture files or source control.

```sh
node --experimental-strip-types ./scripts/move-in/download-scheduler.mjs --provider calcom --output ./private-capture
node --experimental-strip-types ./scripts/move-in/download-scheduler.mjs --provider savvycal --output ./private-capture
```

Each command writes one new JSON file with private filesystem permissions. The file contains personal scheduling data: keep it private and erase it when it is no longer needed. The command prints no provider responses or credentials. Capture refuses redirects, repeated cursors, duplicate identifiers, more than 30 requests, over 8 MiB of responses, more than 100 event types, or more than 500 bookings. It fails instead of saving an incomplete capture.

The JSON envelope has `dialCapture: 1`, `provider`, an ISO `capturedAt`, the raw `user` object, and raw `eventTypes`, `schedules` and `bookings` arrays. These arrays contain provider response records, with pagination envelopes removed. Keep the file produced by the command intact. The importer retains its exact original bytes and lists every unused source leaf by field path without repeating its value.

Cal.com uses the documented v2 profile, event type and schedule responses. Bookings use API version `2026-05-01`, event types use `2024-06-14`, and schedules use `2024-06-11`. The capture includes all booking statuses; review skips past and canceled bookings. It preserves schedule associations, weekday windows, date overrides, supported questions, durations, supported locations, account identifiers, explicit booking URLs and confirmed single-host booking details. Unsupported team, pooled, recurring, instant and capacity event types are skipped. Integration credentials, payments, automations and other unsupported fields are listed as losses. Booking answers match the provider field slug. Event-level notice, horizon, buffer and other controls still require review; booking occupancy retains supplied buffers.

Sources: [Cal.com profile](https://cal.com/docs/api-reference/v2/me/get-my-profile), [Cal.com booking pagination](https://cal.com/docs/api-reference/v2/bookings/get-all-bookings), [Cal.com schedules](https://cal.com/docs/api-reference/v2/schedules/get-all-schedules), and [Cal.com event type response contract](https://github.com/calcom/cal.com/blob/main/packages/platform/types/event-types/event-types_2024_06_14/outputs/event-type.output.ts).

SavvyCal uses the documented v1 user, scheduling link and event responses, including archived links. It preserves durations, supported questions, answer labels and text, event URLs, confirmed single-host bookings and occupied intervals. The profile handle is derived from the stable account identifier because the API has no user handle. Rich HTML descriptions and unsupported field types are reported as losses.

SavvyCal's documented link response exposes neither recurring availability configuration nor location settings or host topology. Its capture therefore has an empty `schedules` array. Configure availability and location on each draft, and review its host configuration before publishing. Available time slots are not substituted for recurring availability. Bookings require exactly one organizer matching the captured account and one invitee; group, poll and nonconfirmed bookings are skipped. The API capture does not transfer provider integrations or credentials.

Sources: [SavvyCal API reference](https://docs.savvycal.com/developers/v1/api), [SavvyCal authentication](https://docs.savvycal.com/developers/authentication), [SavvyCal scheduling links](https://docs.savvycal.com/developers/v1/api/list-scheduling-links), and [SavvyCal authoritative OpenAPI specification](https://api.savvycal.com/v1/spec).
