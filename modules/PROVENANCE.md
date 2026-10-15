# Base source provenance

Dial adopts the local runtime from maintained Base source at revision
3d643dda1d203d36e3fa57e8e5ba14e414bba6f9. Earlier applied migration copies retain their recorded source revisions and bytes. `base-copies.json` records byte-exact files, modes and origins;
`edition.json` and its selected native source snapshots retain component provenance.

The eleven runtime files under `src/modules/erasure` are a separate byte-exact
adoption of Base `4eed99c6a4ca708a9db70d4b5759f5678053cdf5`, recorded in
`base-copies.json`. Dial supplies the entity graphs, admission, anonymisation and
calendar policy. The existing portability runtime remains the only journal and
restore-fence implementation. This adoption does not refresh the whole CLI or
claim a green aggregate Base gate: a later exact-head runner run passed
14/24 stages and remains blocked by failures also reported on its main.

The CLI/onboarding runtime is the published `@runeditrun/rer` package at the
exact version `package.json` pins, with its frozen lockfile and no package patch.
The package awaits Dial's adapter `resetPreflight`, which keeps the legacy-state
guard before any reset inventory or removal. The command guides describe this
package adoption and are maintained by Dial rather than recorded as byte-exact
Base guides.

Dial owns the adapter and the thin `scripts/operations.mjs` delegate. The
native root `operations/` pair remains solely for deploy-kit and the owner-gated live
acceptance boundary; the edition project-operations component owns only that pair.
The retired duplicate `scripts/project-operations.mjs` and local setup/deploy
aliases are absent.

Applied migrations `0001`–`0026` retain their existing bytes. Dial owns
`0027_first_run_setup.sql`, the durable authenticated `/setup` journey, its
setup manifest, and all product integration glue.

Managed source admission adopts Base's native owner-claim and editor runtimes.
`0028_owner_claim.sql` is byte-exact Base owner-claim SQL. Dial selects trusted
bindings, mounts owner claim before public admission and native authentication,
and supplies native sessions to the editor.
The product-owned editor output `src/core/features/editor/visual-edits.json` is
excluded from byte-copy discovery: its initial empty value matches Base's default,
and editor saves belong to Dial's source rather than an immutable Base copy.

The delivery producer retains Base's native exported projection: its exporter
relocates setup-schema imports and copies the three schema/validation files.
Dial owns packaging policy, artifact caller, setup manifest, integration checker
and HTTP/browser/artifact journeys. The integration checker wraps Base producer
validation; Base does not supply a separate projects/integrations CLI.

The import-kit source and its README, CONTRACT and FIXTURES documents are
byte-exact Base files at `6c8374d5eb2e7eb53bad079d0502dbc4f930fd1c`, recorded in
`base-copies.json`, with one exception: Dial's `src/d1/erasure-writes.ts`
rebinds a source claim shared by several jobs to the hashes of its own job's
decision, where Base takes the first job's. A field redaction keeps each job's
own effects, and Dial's per-upload manage tokens make those differ, so Base's
choice left the current import's claim mismatched and its undo refused. The
file leaves the byte-copy record until Base carries the same change.
`0045_import_preparation_steps.sql` and `0046_import_stream_sources.sql` are
byte-exact Base default-seed migrations adding the kit's additive control
tables. Dial owns `0029_move_in_import.sql`, the source adapter, native targets,
routes, the erased-invitee tombstone and synthetic acceptance journeys. No live
source account proof is claimed.

Base keeps its edition importer catalogue and source-specific guides in its private
authoring tree; those files are not copied into Dial. The reusable import schemas
remain byte-exact Base files. Dial retains its own importer implementation and guide;
no live account import is claimed.

Applied migration copies retain their original pins and bytes. Runtime modules
outside the package remain governed by their existing byte-copy records;
`verify:copies` checks those records. `rer check --profile first-party` checks
the package pin, locked dependency, aliases, and absence of the vendored trees.

Demo mode, its local identity wrapper and dependencies, and silent development
mail adopt Base `5afc5530c67454482153dbfc097bbda8a1d27981` (rer 0.2.20).
`base-copies.json` records each refreshed source and its exact bytes. The demo
now lives at `modules/demo` so Base's relative imports remain verbatim.
The dev wrapper index retains one Dial adaptation: a fenced persona insert is
refused only when D1 reports zero changes. Dial's identity projection triggers
make a successful insert report multiple changes; the Base strict-one check
incorrectly returned 409 after creating the operator. All authority fences stay
intact. The adapted index is deliberately outside the verbatim copy inventory.
The existing DATA-002 rate-correlation adaptation is carried across Base's
email-link refactor in service.mjs, accounts/store.mjs, identity/email-link/index.mjs
and index.d.mts. These adapted files are outside the verbatim inventory; counters
and their erasure correlations still commit in one D1 transaction.
accounts/admin.mjs preserves Dial's existing OPER-001/002 equal-operator
management: ordinary invitations/removals do not become a new role-transfer
step-up flow. Actual role changes retain the fresh-proof guard. This adapted
file is outside the verbatim inventory.

Owner sign-in confirmation counters also use that rate-correlation hook, keyed
to the grant's operator through its digest. The Lobby adopts only Base 0.2.20's
manual-setup-token hint condition; Dial retains its existing copy, styles and
onboarding-completion predicate.

Managed mail uses the existing byte-exact Base `modules/mail` RER adapter shipped in rer 0.2.22. The delivery producer spec, mail declaration validator and package adopt Base `a1cde988c1be2c9f74ff5ca374dc47e044ba193c`; setup-manifest keeps Dial’s local schema paths and adds its managed-mail validation. Dial’s relay integration preserves safe status/Retry-After metadata without changing the Base adapter or reading response bodies.
