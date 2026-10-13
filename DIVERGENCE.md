# DIVERGENCE.md

Where Dial departs from the shared documents, and where the shared documents made that departure necessary. The contract records each deliberate replacement of a baseline guarantee.

## Baseline clauses this contract supersedes

Each is declared the sanctioned way: the contract clause names the `BASE-` ID it supersedes and carries its own test.

### `AUTH-001` supersedes `BASE-ACCESS-004`

`BASE-ACCESS-004` requires every mutation to check a caller session and ownership. Dial's essential workflow lets an invitee create a booking or an availability request and later reschedule or cancel it without an account, and calendar OAuth callbacks and provider webhooks complete work initiated outside any session. No operator session exists on those requests.

`AUTH-001` narrows rather than weakens: it supersedes the baseline only for the paths in `seed.json → deploy.publicPaths`, and each of those paths must present specific capability material — a single-use 256-bit booking nonce that expires in 30 minutes (`AUTH-002`), a per-booking manage token (`AUTH-003`, `BOOK-006`), OAuth state signed against the initiating operator session and expiring in 10 minutes (`AUTH-004`), or the provider's own signature or channel identity plus a configured secret (`AUTH-005`). Every other mutation still requires a session and a server-side ownership check.

### `PROFILE-003` supersedes `BASE-INPUT-003` for `/media/`

`BASE-INPUT-003` requires uploads to be served "with their declared content type and a download disposition". The host avatar is an upload that must render as an image on the public profile and event pages, which a download disposition prevents. `PROFILE-003` supersedes the baseline for the `/media/` prefix only, serving the avatar inline; the size limits, type allow-list, declared content type, and the requirement that every other upload stay private all still hold. `PROFILE-003` also discharges the baseline's own requirement that a product contract name any public delivery channel for uploads.

### `EVENT-005` supersedes `BASE-DATA-003` for event types

`BASE-DATA-003` requires deletion to cascade to dependent records. Bookings are dependent on an event type, but they are the record of an appointment a real person agreed to; destroying them because an operator retired a template would be data loss, not erasure. `EVENT-005` therefore does not cascade, and each booking keeps its own copy of the event title, duration, and location. The baseline's erasure guarantee is met instead by `DATA-002`, which lets an operator delete a booking or a request and anonymise the surviving audit reference.

### `DATA-001` supersedes `BASE-DATA-001` for OAuth credentials

`BASE-DATA-001` requires the export to contain every record and to round-trip. Exporting the host's calendar access and refresh tokens would put live account credentials in a portable archive. `DATA-001` excludes them and states the observable consequence instead: after an import the calendar connection is unhealthy under `CAL-006` until an operator re-authorises it.

## Contract clauses narrowed by another contract clause

### `DATA-003` release narrows `NOTIFY-004` and `BOOK-009` for imported bookings cancelled at the source

`NOTIFY-004` sends the invitee exactly one email for every cancellation. During a move-in, an invitee who cancels at the source scheduler has already been told by it, and the imported Dial booking would otherwise keep blocking real time until someone cancels it. A second cancellation email from Dial, about a booking the invitee never made in Dial, would be wrong. `DATA-003` therefore adds one operator action, release this time, available only for an imported booking that the latest catch-up lists as cancelled at the source and that has no decision yet: it cancels the booking, frees its slot and buffers, records the operator and reason in history (`BOOK-010`), and sends no email. The ordinary operator cancellation of `BOOK-009` and its one email stay available beside it, and every other cancellation keeps `NOTIFY-004` unchanged. `tests/move-in-catch-up.test.mjs` proves the release sends nothing and frees the slot, and that the ordinary cancel still sends exactly one email.
