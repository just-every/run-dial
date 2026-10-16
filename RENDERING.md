# Dial rendering custody

Start owns React documents at `/`, `/signin`, `/privacy`, `/docs` and its children, `/app` and its children, `/setup` and its private editor children,
`/book`, `/manage` and origin-authorized `/embed` documents, and generated
`/_serverFn/` dispatch. Dynamic documents are never prerendered.

Hono owns `/health`, `/api` and its children, native auth, calendar OAuth, provider
callbacks, `.ics` and the embed bootstrap script. Existing document capability,
status, session and framing gates run in Hono before its document renderer delegates
to Start. Unknown API members stay Hono 404s; unknown documents stay Start 404s.
Built assets belong to Cloudflare assets. Worker Queue and Cron exports remain on
the custom Worker entry. Unsupported hosts and methods reach no document or data.

The production build embeds an exact inventory of fingerprinted client JavaScript, CSS and fonts
in the Worker, using bundler output metadata rather than matching
request filename patterns. After public admission, successful GET/HEAD responses
for those assets may be cached for a year as immutable. Public-directory files,
unfingerprinted outputs, failed responses and private/no-store responses retain
their existing cache policy. Development has no production asset inventory.
Documents and generated server functions retain their existing handling; every
asset request that reaches the Worker still passes the normal public budget.

Public document loaders select only declared public projection endpoints and
carry no initial visitor-derived timezone. Private generated loaders independently
validate native D1 sessions before reading host or operator data. No server function
performs a product mutation; existing typed Hono mutations retain their authority.

Private app documents stream their head while fresh native projection reads
finish. The fixed read inventory uses the same Hono GET handlers and errors;
request-local sharing never survives a navigation or mutation. App documents
use Start's streaming renderer without its crawler-only all-ready wait, and
archive admission lasts through deferred reads and the document stream. Setup
and public documents retain Start's default renderer.

SendGrid can retain an authenticated domain ID in memory, keyed by a hash of the
credential and sending address. Each use still reads that exact domain from the
provider and verifies its current domain and validity. Failed or invalid lookups
clear the hint and fail the check without retrying; no health result is cached.

The existing `/_serverFn/` transport prefix is declared in `seed.json` alongside
the public document/API/asset paths. The Worker applies shared atomic public
admission before dispatching those paths; this declaration adds no transport or
mutation. Private generated loaders still authenticate independently. Provider
callbacks instead authenticate natively before admission and before recording a
fact or invalidating a cache. SSR projection reads do not consume a second quota.

Booking step and receipt presentation now derive from the rendered route and
verified native booking state. Embedded navigation reads the explicit router
query parent during SSR; no browser global, hash-only parent or storage value
substitutes for the native framing gate. The local simplification fixture renders
actual production document routes with isolated synthetic provider state. It
launches no browser and does not certify hydration, viewport appearance or
interactive form recovery without separate browser acceptance.

Hono guards private documents using the durable operator setup identity marker.
Start parent beforeLoad server functions independently authenticate and make the
same first-run decision before rendering children, including hydrated navigation.
Unfinished app documents redirect to /setup; completed setup documents redirect to
/app. Setup reuses native editors and authenticated APIs. Only the same-origin Hono
finish mutation records completion after current publication and copy-report checks.
Provider health remains operational status and cannot clear this durable marker.
