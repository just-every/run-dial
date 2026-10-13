# Calendar adapter input — v2

`CalendarAdapter` in `src/core/platform/calendar/types.ts` and the manifest/
`CAL-001` declaration use `calendar.provider.v2`. This is an authoring input to
the application's service composition; the candidate does not claim a published
runtime extension loader or package. Owners may integrate it using their own
source choices and verify their effective application.

The breaking change from v1 is mandatory
`inspectManagedEvent(accessToken, calendarId, { bookingId, providerEventId })`.
Google and the task-owned test adapters implement this method. Other authored
adapters must add it before adopting this source. Existing OAuth, busy-read,
event-write, cancellation and sync methods retain their signatures.

Inspection returns one normalized snapshot:

- `present`: a managed changed-event fact with booking/occurrence/provider IDs,
  actual provider update time, current time bounds and location. Do not retain
  unrelated event titles, descriptions or attendees.
- `deleted`: affirmative current deletion of the requested provider identity,
  after checking for an active managed replacement. A missing object, unreadable
  calendar, incomplete page or ambiguous lookup cannot produce this result.
- `unresolved`: `event_missing`, `identity_missing` or `ambiguous_events`.
  Transport/auth failures throw a sanitized `ProviderFailure`.

Google inspection GETs the current event using a minimal field projection.
A cancelled snapshot triggers a complete active lookup by Dial's private booking
identity; an active replacement protects the booking. 404/410 and incomplete or
ambiguous results stay unresolved. The service persists bounded probe retries
inside the booking's coordinator; uncertainty keeps the booking and claim intact.
These rules preserve `CAL-007`/`CAL-008` privacy and ordering requirements without
inventing a deletion timestamp. API versioning does not certify the full clause,
live-provider interoperability or callback timing targets.

`tests/deletion-ordering.test.mjs` exercises the actual Google adapter using
injected responses and local D1/Durable Objects. `OPERATIONS.md` describes native
operator status/retry and the additive 0009 migration. Applied 0001–0008 remain
unchanged. Source adoption requires the additive migration before new probe work.

## Availability recommendation authoring helper

The source helper `rankSlots` now takes `(slots, recommendationContext)` rather
than zone strings. Compose its context with `buildRecommendationContext(input,
{ start, end }, explicitlySubmittedInviteeZone)` using the same schedule and
occupancy read that produced the offers. Context is private composition state,
not a public DTO. This corrects the existing declared default policy; it does
not establish a published extension loader or a new runtime policy version.
Owners adopting the helper source must update their calls and verify their own
effective application.

`AvailabilityRepository.listInternalClaims` accepts an optional fourth argument,
`capHostDates`. The maintained service passes evaluated persisted host dates when
a booking cap is configured; those active claims are included even outside the
UTC interval so a profile-zone change cannot bypass the existing atomic cap.
Authored callers that evaluate day caps should pass the same dates. The query
returns no additional personal fields and applies the excluded-booking filter
to both occupancy and cap inputs.

Availability internal claims now optionally carry `bookingStartAt` and
`bookingEndAt`, the actual current occurrence interval. `startAt`/`endAt` remain
the occupied interval including the existing booking's buffers, which alone
governs conflict validity. The optional actual interval improves private buffer
attribution; authored repositories omitting it retain conservative occupancy
exclusion. Diagnostic projections disclose only rule enums and the requested
time/host zone, and never expose these internal rows. Public offer fields and
freshness/claim/cap admission are unchanged.
