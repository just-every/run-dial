# Dial demo

After the ordinary `rer setup`, run `rer demo` (`rer dev --demo`) and open its
private `RER_OPEN` link. The pinned, unmodified `@runeditrun/rer` 0.2.20 release
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

## Real reads and mocked sends

Base's demo module (`modules/demo`, imported first by
`src/core/app/worker.ts`) lets public reads/checks use real networking.
Google Calendar's POST free/busy query declares read intent with
`fetchDemoRead`. External HTTP writes receive simulated provider success.
Dial's dev/demo mail validates normally and is silently suppressed without
retaining a message. Neither a bar nor an outbox is served. The marked product
name and document title read **Dial Demo**; `rer dev` reads **Dial Dev**.

Sample bookings and public availability use the real application, database,
and scheduling rules. Google Calendar connection still needs the installation's
OAuth configuration. The demo's sample events use fixed locations so visitors
can book, reschedule, cancel and invite an operator without provider credentials.

Without `RER_DEMO=1`, public networking and provider writes keep their ordinary
behavior. Production builds/deploys refuse demo settings; local dev continues
to suppress mail.

## Hosted demo

`deploy-demo.json` declares the demo at `demo.run-dial.com` with plain settings
(`MAIL_PROVIDER=development`, `MAIL_FROM=noreply@demo.invalid`); `deploy.json`
lists the `container` platform (workerd engine). Under `RER_DEMO=1` Dial accepts
silent development mail on the demo's https origin, and the owner claim's
audience is the front-supplied `APP_URL`; production still requires its explicit
claim origin and a loopback install for development mail.

`.github/workflows/run-demo.yml` (manual dispatch only, environment `run-demo`,
the RunEditRun account) runs `rer deploy --demo`. `test_only` deploys the
separate `demo-test` host at `demo.test.run-dial.com` with Cloudflare's
always-passing Turnstile test keys; `remove` removes the selected host. No
repository variable is needed. The run-site homepage links to the production
demo with **Try the demo** beside **Run Dial**.

The pinned rer release admits Dial’s `cloudflare:workers` imports,
`BookingCoordinator` Durable Object and `passThroughOnException` forwarding
for the workerd container engine.
