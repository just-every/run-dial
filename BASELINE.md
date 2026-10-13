# BASELINE.md

Shared baseline requirements defined in Base. Editions ship their own copy and baseline evidence; their reports distinguish implemented checks from planned coverage. An intentional override identifies the baseline clause and the owner's authorized replacement requirement, including changed security consequences, with appropriate verification. Existing owner authorization is sufficient; ordinary fixes to meet a requirement need no additional acknowledgement.

## Access

- **BASE-ACCESS-001 — Sign-in.** Operators sign in by magic link to an allow-listed email address; passkeys may be offered in addition. No passwords are stored.
- **BASE-ACCESS-002 — Sessions.** A session expires after at most 30 days of inactivity; sign-out revokes that session. A valid session is required before an operator request reads private product data or performs its requested action. A protected operator document and each private generated server-function handler validate the session independently; a document gate does not authorize a function call. For an otherwise-admissible request that reaches session validation, a protected operator HTTP API returns 401 when the session is missing, expired, or revoked; a protected document returns its native sign-in response; and a generated transport may encode an identifiable session denial or sign-in redirect in its framework protocol, including a 200 serialized redirect. No such denial response exposes private product data or performs the requested mutation. Declared public exceptions remain governed by BASE-ACCESS-003, and host, method, Origin/CSRF, input, and runtime guards retain their normal order.
- **BASE-ACCESS-003 — Public endpoints.** Only paths declared in `seed.json → deploy.publicPaths` are reachable without a session. Entries are exact paths or prefixes and must cover the sign-in flow and the operator app's static assets. Each is rate-limited at the limits in `seed.json` and returns 429 when exceeded.
- **BASE-ACCESS-004 — Server-side authorisation.** Every mutation checks the caller's session and ownership on the server. Client-supplied identity, role, or ownership claims are never trusted.

## Input

- **BASE-INPUT-001 — Validation.** Every request body, query, and path parameter is validated against a schema at the boundary. Invalid input returns 400 in the standard error format and reaches no service.
- **BASE-INPUT-002 — HTML.** User-supplied HTML is sanitised before display: scripts, forms, and tracking pixels are removed; remote images load only on operator request. Channels that carry text are rendered as text.
- **BASE-INPUT-003 — Uploads.** Uploads are accepted only within the size and type limits in `seed.json`, stored in R2, served with their declared content type and a download disposition, and readable only by an authorised session or through a delivery channel the product contract names.

## Secrets and configuration

- **BASE-SECRET-001 — No leakage.** No secret appears in the client bundle, in logs, or in an error response.
- **BASE-SECRET-002 — Startup.** Missing required configuration fails at startup naming the variable. The product never runs in a degraded mode.

## Data ownership

- **BASE-DATA-001 — Export and import.** `pnpm export` produces every record and attachment; `pnpm run import` restores it into a fully migrated empty deployment; export, import, export yields an archive with equivalent contents. DATA-001 explicitly records Dial’s credential/live-authority exclusions and canonicalization.
- **BASE-DATA-002 — Retention.** No user data is deleted automatically. Only sessions and rate-limit state expire.
- **BASE-DATA-003 — Erasure.** Every entity that holds personal data can be deleted by an operator. Deletion cascades to dependent records and attachments within 5 minutes and is confirmed when complete. Audit entries are kept with the reference anonymised.
- **BASE-DATA-004 — Outbound flows.** User data leaves the deployment only through externals declared in `seed.json → externals`. No other outbound request carries user data.
- **BASE-DATA-005 — Independence.** The deployment makes no request to the marketplace or the seed author. There is no telemetry, phone-home, licence check, or kill switch.

## Public surfaces

- **BASE-PUBLIC-001 — Privacy.** Public surfaces (widgets, booking pages, forms, status pages) set no cookies, load nothing from third-party domains, and send no visitor data before the visitor's first interaction.
- **BASE-PUBLIC-002 — Origins.** Embeddable surfaces can be embedded only on host origins listed in settings.
- **BASE-PUBLIC-003 — Accessibility.** The operator app and every public surface are keyboard operable and labelled for assistive technology, passing the automated accessibility check at the level in `seed.json`.

## Operations

- **BASE-OPS-001 — Health.** `/health` returns 200 within 1 second when the database, storage, and queues are reachable, and 503 otherwise.
- **BASE-OPS-002 — Migrations.** Migrating from the previous released tag to the current one succeeds on sample data. Destructive changes are expand → migrate → contract with a documented recovery step.
- **BASE-OPS-003 — Idempotency.** Queue consumers and webhook handlers produce the same result when a message is delivered twice.
- **BASE-OPS-004 — Failure is visible.** A job that fails after its retries is marked failed where an operator can see it. Nothing is dropped silently.
- **BASE-OPS-005 — Audit.** Every destructive action and every automated action that reaches a user records the actor, or the feature that acted, and the time. Audit records survive deletion of what they describe.
