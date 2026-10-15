# Dial demo

After the ordinary `rer setup`, run `rer demo` (`rer dev --demo`) and open its
private `RER_OPEN` link. The pinned, unmodified `@runeditrun/rer` 0.2.14 release
includes demo mode. `rer demo --stop`, Ctrl-C, or its end (one hour) stops it and
deletes `.rer/demo/<start>/`; the next demo starts afresh. Stop `rer dev` first:
one server runs per checkout.

The demo migrates and claims the saved owner in its own state folder: Dial's
adapter (`scripts/installer/local.mjs`, `scripts/local/targets.mjs`) passes the
demo's folder to `wrangler d1 migrations apply --persist-to` and to Vite
(`RER_STATE_DIR`), and skips the owner check that would open the checkout's
database. The checkout's `.wrangler/state` and `.dev.vars` are never written.

The owner lands on a finished first run (`src/demo.ts`, data from
`sample-data/dial-demo.ts`): Maya Chen's profile, three published event types
(Product kickoff on a video link, Roadmap review in person, Office hours by
phone) and a week of bookings around today with four invitees. The data is
written through Dial's own services and repositories, once, after the owner
exists; it sends no mail and makes no calendar request.

## Nothing is sent

Base's demo module (`src/modules/demo`, `withDemo` wrapping the default export of
the Worker entry `src/core/app/worker.ts` as its first import) refuses every
non-loopback `fetch`, WebSocket, beacon, event stream and socket for the whole
isolate, and lists each refusal in the Demo bar. Dial's outbound effects:

| Effect | In a demo |
|---|---|
| Booking mail (confirmations, host notices, reminders, cancellations) and sign-in mail | Captured in the development outbox and listed in the Demo bar. |
| Google Calendar OAuth, busy reads, event sync and push channels | Refused: a demo has no Google client, so **Connect Google Calendar** answers `calendar_not_configured` before any request. The token exchange is refused by the guard too. |
| SendGrid sender-domain check | Refused: demo mail is the outbox, so **Check sender** reads the outbox; a request to `api.sendgrid.com` is refused by the guard. |
| Public booking pages | Locally on the demo's loopback origin. Hosted, every request without the visitor's demo cookie stops at the front Worker. |

Without `RER_DEMO=1` the guard returns the Worker unchanged; `rer deploy` refuses
a declaration or settings that carry `RER_DEMO`.

## Hosted demo

`deploy-demo.json` declares the demo at `demo.run-dial.com` with plain settings
(`MAIL_PROVIDER=development`, `MAIL_FROM=noreply@demo.invalid`); `deploy.json`
lists the `container` platform (workerd engine). Under `RER_DEMO=1` Dial accepts
the development outbox on the demo's https origin, and the owner claim's
audience is the front-supplied `APP_URL`; production still requires its explicit
claim origin and a loopback install for development mail.

`.github/workflows/run-demo.yml` (manual dispatch only, environment `run-demo`,
the RunEditRun account) runs `rer deploy --demo`. `test_only` deploys the
separate `demo-test` host at `demo.test.run-dial.com` with Cloudflare's
always-passing Turnstile test keys; `remove` removes the selected host. No
repository variable is needed. The run site and its homepage are unchanged.

The pinned rer release admits Dial’s `cloudflare:workers` imports,
`BookingCoordinator` Durable Object and `passThroughOnException` forwarding
for the workerd container engine.
