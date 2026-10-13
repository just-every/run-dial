# Managed delivery source

`rer-setup.json` is the canonical setup form shared with the local installer.
`rer-project.json` records its exact byte digest. `scripts/delivery/base/packaging.json`
selects that file and declares Dial's source identity, actual build outputs, native
bindings, public setting names, secret names, provider effects and recovery policy.
The producer is the exported Base delivery runtime. It contains no product detection.

Run `node scripts/projects/integrations.mjs check` to validate the committed source
selection and generated descriptor/workflow without credentials or network access.
This is a structural source check, not hosted integration acceptance. Run
`node scripts/operations.mjs check` after setting the local inputs documented in
OPERATIONS.md. It checks local configuration, never account permissions or delivery.
Both checks must pass before an authorized live setup supplies provider credentials.

After `pnpm run build`, `pnpm run delivery:artifact` emits the schema-2 package in
`delivery-artifact/`, with raw Worker/assets payloads and exact migration SQL.
The output directory must be fresh. `pnpm run verify:delivery` packages to its own
fresh temporary directory and compares every payload with the actual build output.
The declared dead-letter queue has its own JOBS_DEAD producer binding so it is an
explicit installation resource. The native BookingCoordinator, queue consumer,
minute schedule, D1 and R2 declarations come from emitted Wrangler configuration.
No credential values are inputs to packaging. Provider effects declare possible
calendar, conferencing, OAuth and mail activity; they do not grant consent.

`.github/workflows/rer-managed.yml` calls the trusted delivery workflow at an
immutable commit. Full verification includes the local owner-claim HTTP tests,
built-artifact checks and the native editor browser journey at 1440 and 390 pixels.
The browser fixture replaces only the management network edge and sends no external
traffic. Hosted management, preview or production provisioning, owner handoff and
live provider acceptance require a separate authorized installation.
