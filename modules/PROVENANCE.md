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

The import-kit runtime and documents follow the coordinated runtime refresh below.
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

All vendored runtime modules are refreshed together from rer-v0.2.22,
Base commit `1ce15dd8cbb7c8cf2d83ebfde2b4a8a130ff9d74`, including demo,
operator-auth, owner-claim, mail, dependencies, deploy-kit, editor, import-kit,
erasure, local sign-in and delivery-producer projections. Import-kit now also
uses Base's d1-transport module. Applied migrations retain their original bytes.
`base-copies.json` records the refreshed sources and exact bytes.

Base now witnesses authentication writes with returned IDs, so Dial's former
trigger-count workaround in the dev wrapper is removed. The two DATA-002
rate-correlation adaptations in AuthStore and email-link remain, rebased onto
this release. Base's import erasure implementation now includes the prior Dial
claim adaptation and is byte-exact again. Demo v2 has no bar or mail outbox;
Base mail and authentication complete suppressed sends as success.

Managed mail uses the existing byte-exact Base `modules/mail` RER adapter shipped in rer 0.2.22. The delivery producer spec, mail declaration validator and package adopt Base `a1cde988c1be2c9f74ff5ca374dc47e044ba193c`; setup-manifest keeps Dial’s local schema paths and adds its managed-mail validation. Dial’s relay integration preserves safe status/Retry-After metadata without changing the Base adapter or reading response bodies.

Dial retains its equal-operator administration policy and rate-correlation hook
wiring/types. Local sign-in rebases Base's loopback import to its adopted path;
the unused default-seed persona copy is removed. The erasure queue omits one
unused upstream helper so Dial's lint remains active. These adaptations are
excluded from byte-exact copy claims.

Dial's AuthStore reads an unpinned session and its current operator authority
in one SELECT. Pinned provider sessions retain a second fresh authority read
with the captured provider fence. This request-latency adaptation remains outside
the byte-exact Base copy claims and does not change the upstream revision.

The 18 October 2026 LINK-002 round pins the published CLI package to rer 0.2.50 and reruns its frozen install. Recorded vendored Base copies retain their existing source revisions and bytes; the CLI package pin is separate from those copy claims.

The mounted agent-door and business-settings modules, with their theme/icon
helpers, are refreshed through the installed 0.2.87 CLI to the immutable
`rer-v0.2.87` source commit `62f07fe6ecfdeae1a90bf6e65a02abae288996b3`.
The authenticated source archive supplies the four selected records; all source
bytes, modes and prior membership are retained by `base-copies.json`.
The Worker mounts the native synchronous core door before app setup and session
redirects. Additive migrations 0093–0095 establish Business identities and door
stores. Applied migration bytes are unchanged.

The declared native tools live under `src/agent-door`; ten resource readers
remain prepared, unmounted and undeclared. MCP supports `2026-07-28` and
`2025-11-25`, and refuses `2025-03-26` with `UnsupportedProtocolVersion` (-32022).
The directory README records current native boundaries and upstream limitations.

Public-surface copies, including `src/base/run-site.ts` and demo navigation,
retain their existing `6d38b54a6401879989e8d1f7ab4a02ffbdb4c46c` pin and bytes.
They are outside this door refresh. Native runtime source is distinct from the
published CLI pin, and neither is evidence that optional families are complete.
