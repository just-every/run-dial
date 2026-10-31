# API credentials and connected apps

Owners create API access in Settings. Choose a personal token, a machine application or a delegated application, select only the required actions, choose the workspace or a host, and set an expiry. Store the secret in the integration's private secret store. It appears once; refreshing the page cannot retrieve it. The issued-access list shows expiry, last use and revoked state. Revocation stops the next request.

An owner can invite an API administrator from Workspace access in Settings. This native administrator can issue and revoke credentials and register applications using the authenticated credential routes. Workspace pages, archives, erasure and role changes remain owner-only until the broader workspace roles experience ships. Only an owner changes an existing administrator's API role, through `POST /api/app/operators/:id/api-role` with `role` set to `admin` or `member`. The protected setup owner cannot be demoted through this door.

Send a token only in the `Authorization: Bearer` header to the versioned API. Named actions are independent. Reading bookings does not permit changing them. API authority does not create an operator session or grant access to operator documents, archives, erasure or role management. Requests outside the credential's host or team scope return no foreign record.

## Host partitions

A native active person can be registered as an API host using `POST /api/app/api-hosts` with their `operatorId`. List the directory with `GET /api/app/api-hosts`. Assign an existing event type with `POST /api/app/api-hosts/:id/events`, supplying `eventTypeId` and explicitly acknowledging `transferBookings: true`. This assignment transfers access to the event's existing bookings as well as future bookings. Only an owner or API administrator can make this change. The original host remains the default for unassigned event types.

The directory partitions API access to native bookings. Public profiles and connected calendars still use the installation's shared configuration. It does not establish separate public host profiles or separately connected calendars. Removing a person detaches their native identity and closes their host partition without transferring those bookings to another host.

## Delegated OAuth connection

Register a delegated application with a precise HTTPS callback, expiry, scopes and optional host or team. Registration grants no booking access. A machine application instead uses its explicitly registered client-credentials grant and cannot use delegated authorization codes.

For a delegated connection, send the person to the installation's Settings page with these query parameters:

- `client_id`: the registered application's ID.
- `redirect_uri`: the exact registered HTTPS callback.
- `response_type`: `code`.
- `scope`: a space-separated subset of the registered actions.
- `state`: an unpredictable value of at least 16 characters, retained by the client for comparison.
- `code_challenge`: the unpadded base64url SHA-256 digest of a fresh PKCE verifier.
- `code_challenge_method`: `S256`.

An active owner reviews the app, actions, host or team, expiry and callback in Settings. The conservative consent policy currently permits owners only. Administrators register applications and issue personal tokens; they cannot approve delegated access. Declining grants nothing. Approval records an audit fact and offers an explicit return to the registered application. The callback carries the original state and a single-use code, valid for at most five minutes. The client must verify the state before exchanging the code.

Exchange at `POST /api/oauth/token` using form-encoded `grant_type=authorization_code`, `client_id`, `client_secret`, `redirect_uri`, `code` and `code_verifier`. The verifier must be 43 to 128 unreserved characters. A mismatched callback, incorrect client secret, wrong verifier, expired code or replay yields no access token. Successful access expires within one hour and never later than the application or consent expiry. No refresh-token authority is issued.

Disconnect an approved app in Settings, or revoke its grant through `POST /api/app/oauth/grants/:id/revoke`. Only the consenting person can revoke their grant through that door; an administrator can revoke the registered application. Either revocation stops the next API request. Demoting or removing the issuing administrator, removing the consenting person, and application expiry also close the grant.

Secrets and authorization codes are never returned by later lists or written into application audit facts. Archives retain credential and consent metadata in a revoked state, omit secret hashes and exclude authorization codes. Restoring an archive cannot reconnect an app or revive an old code.
