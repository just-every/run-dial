# Portable installation data

This dependency-free source module exports and restores one installation's D1
tables, R2 objects and optional named byte payloads. It is generalised from the
Penny and Orbit seeds, with atomic graph restoration from Lamp. Products retain
their data policy, erasure planning, authorization and interface.

The library works in Workers and Node with D1/R2 bindings. It makes no network
request and dispatches no product effect. Only the CLI contacts the product's
HTTP handler. Copying the module does not establish a product's complete data
ownership guarantee: include every binding, review transformations and extra
payload consumers, and prove the integrated round trip.

## Policy

`await createPortability({db, buckets, policy})` validates policy and the current
schema at construction. Apply the bookkeeping migration first. Policy fields:

| Field | Meaning |
| --- | --- |
| `product` | Required archive product identity. |
| `excludeTables` | Additional exact names or prefixes ending in `%`. |
| `includeTables` | Explicit identity tables to include despite default exclusions. |
| `derivedTables` | Virtual/FTS tables to regenerate; their shadow tables are excluded. |
| `secretColumns` | Per-table nullable base columns omitted at export and written as NULL. Primary keys and generated columns cannot be secret. |
| `exportRow(table,row)` | Pure, synchronous, idempotent transformation of encoded base cells. Restore writes its result verbatim; SQLite recomputes generated cells. |
| `replaceableTables` | Bootstrap or migration-seeded rows replaced in the atomic restore batch. Populated excluded dependents reachable through modifying FK actions refuse replacement. |
| `requiredConfiguration` | Setting names returned after restore for the owner to re-enter. |
| `validateStaged({db,tables,read,manifest})` | Read-only product validation before any object write; false or a thrown error refuses restore. `tables` names the staging tables for bounded SQL queries; `read` is a convenience for small tables. |
| `acceptedSchemas` | Map from an earlier full schema hash to `{upgradeRow(table,row)}`. Upgrade functions are pure and synchronous. No older schema is accepted by default. |
| `buckets` | Binding names mapped to `{prefix?,objectReferences?:{table,keyColumn}}`. Prefixes isolate an object namespace. References require exactly the distinct referenced keys. |
| `extraPayloads` | Named `{produce,consume}` pairs. Producers return bytes or a byte stream. Consumers receive a verified byte stream and descriptor before D1 commit. |
| `partBytes` | Maximum part size, default 16 MiB, configurable from 1 KiB to 16 MiB. |

Default exclusions are `sqlite_%`, `_cf_%`, `d1_migrations`,
`rer_portability_%`, `rer_mail_development_outbox`, `oa_%`, `oc_%`,
`rer_dependency_keys`, `rer_dependency_pending` and `rer_dependency_codes`.
When a policy includes operator-auth tables, local dev identity still never
travels, and no policy option changes that: export drops `oa_sessions` rows of
kind `dev`, every credential recorded in `oa_dev_credentials` (and that table's
rows), and marks dev personas (`<as>@dev.localhost` operators) inactive with a
new authority version; import refuses with 409 (`dev_data`, exit 4 in the CLI)
an archive holding a `dev` session or `oa_dev_credentials` rows. Only tables with
operator-auth's own columns are touched.
A policy may preserve people, their external identity bindings and the original
owner claim. Such a destination keeps that claim and recovers access through
ordinary native sign-in; setup does not grant another owner. Other tables are
discovered automatically. Exclusion rules follow SQLite's ASCII identifier case matching.
Unlisted virtual tables, hidden virtual-table columns and foreign keys into
excluded tables fail by name. The product must explicitly regenerate derived
data. A schema upgrade may change columns but cannot silently omit tables.

Provider link keys and transient provider sessions never travel. Export marks
retained dependency links as needing re-link and turns provider sign-in and
first-setup enablement off. When `oa_auth_settings` is included, each export
advances its authority generation; importing then exporting therefore changes
that generation and the content hash, while retained domain and identity rows
remain equal. Re-linking keeps the installation sector and person bindings;
restored provider sign-in remains off until the owner explicitly enables it.

SQLite VIRTUAL and STORED generated columns retain their visible schema metadata
and original table SQL. Only writable base cells appear in archived rows or
restore inserts; the destination's migrated schema computes generated values and
maintains its indexes. Snapshot and staging tables retain native generated
expressions, column affinities and collations, while leaving final constraints
to the atomic destination restore. Normalization updates base cells, so generated
attachment references and `validateStaged` reads see recomputed values. Nullable
secret base cells become NULL before generated snapshots are normalized. A
generated column cannot itself be redacted: exclude the table or change the
product schema/policy if its computed value must be secret. Ordinary-column
metadata and row encoding are unchanged. Ordinary-table archives using the
authenticated format continue to import into the same schema; see the version
1 refusal below.

An archived INTEGER-affinity base cell outside JavaScript's safe integer range fails before
precision is lost. Cells are null, strings, finite numbers or `{blob:base64}`.
Column affinity and NOT NULL are checked before staging. R2 metadata moves with
the bytes. Large objects span parts and restore through multipart upload with at
most one 5 MiB upload buffer. Extra payload consumers own their own transaction,
idempotence and recovery; D1 cannot roll back Durable Object or external state.

## Archive and durable jobs

The UTF-8 JSON-lines archive has a manifest, indexed checksummed parts and a
closing record. `readArchive(stream)` uses the shared bounded, fatal UTF-8 line
reader. The default maximum line size is 24 MiB; callers can set a smaller bound.
No runtime or CLI materializes the whole archive. Readers enforce a 16 MiB
canonical UTF-8 part limit; `readArchive(stream,{partBytes})` can lower it.
Import uploads enforce the policy's part limit before any staging write.
A part has at most 1,000 rows;
R2 and payload parts contain base64 byte chunks.

The manifest includes product, export time, persistent random installation
identity, schema identity, table SQL/columns/counts/FK dependencies, object and
payload sizes/hashes/metadata, exclusions, required configuration, part count and
the source erasure epoch/journal. The closing `contentHash` hashes canonical JSON
of the schema, normalized rows ordered by archived primary key (original row order without a key),
object metadata/hashes, payload hashes and required configuration. Keyless row
parts also preserve the original rowid, including gaps, for restoration and
erasure matching. Export time,
source identity, job ids and boundaries do not affect equivalence.

New exports use archive version 2. The closing `archiveHash` is SHA-256 of
canonical JSON `{manifest,parts}`, where `manifest` is the complete manifest
and `parts` is the ordered array of verified part SHA-256 strings. This binds
source identity, erasure epoch/journal, export time, all table and policy-visible
metadata, and every part field (including original rowids). It is required on
finalize and checked before any R2 write, extra payload consumer or D1 restore
commit. Local `rer import` verifies the whole input before even applying
destination migrations. `contentHash` remains the content-equivalence digest;
`archiveHash` changes when export time, source metadata or part boundaries change.

Version 1 archives lack this binding and are refused with
`legacy_archive_unverifiable` (HTTP 409; local `rer import` exit 4), before
restoration. Upgrade the original installation and export a new archive.
Changing an old archive's version or recomputing its part checksums cannot
authenticate it. If the original installation is unavailable, use the explicit
[backup-only v1 recovery](#backup-only-v1-recovery) below. Normal import still
requires version 2 integrity.

## Archives across later additive migrations

An archive restores into an installation whose schema differs only by migrations
applied after the archive was made, when those migrations are additive: new
tables, new columns that are nullable or have a default, and indexes. The
archive's tables restore with their archived columns, later columns take their
defaults, and later tables stay empty (they must be empty, like every restored
table). This applies to normal v2 import and to backup-only v1 recovery.

The Base CLI runners (local Workers and container) pass `createPortability` a
`migrations` replayer (`migration-history.mjs`, Node only) built from the
destination's applied migration ledger and migration files. Import replays them
into a scratch database to find the archive's place in that history:

- Archives record the applied migration names in `manifest.migrations` (since
  additive restore). Every recorded migration must be applied here, and
  replaying exactly those must give the archive's schema identity.
- Older v2 and all v1 archives do not record them; the latest prefix of the
  applied migrations that gives the archive's schema identity is used. Migrations
  that change no archived table (indexes, excluded tables) cannot be told apart
  there and are reported as later.

Restored rows never pass through the later migrations, so each of them may
contain only `CREATE TABLE` (not `AS SELECT`), `CREATE INDEX` and
`ALTER TABLE ... ADD COLUMN` (SQLite allows only constant defaults there) on the
restorable tables. A later migration with any other statement that names a
restorable table, such as an `INSERT`, `UPDATE` or `DELETE` that purges or
backfills rows or a trigger, is refused with `schema_mismatch`; statements that
touch only excluded tables are allowed. For archives without a migration record,
every migration after the earliest prefix that gives the archive's schema is
checked, since the archive may predate any of them.

The same check runs when the archive's schema identity equals the destination's:
a later migration that only purges or backfills rows leaves the schema unchanged,
yet the archive's rows never passed through it. Such an archive is refused with
`schema_mismatch:migration_data:<migration>` (local `rer import` exit 4, naming
the migration) before any staging or import job; one whose later migrations only
add indexes or touch excluded tables restores as usual. Without a replayer, an
archive whose recorded migrations the destination's ledger has outgrown is
refused with `schema_mismatch:migrations`, since those migrations cannot be read;
an archive with no migration record cannot be placed there and restores as before.

Then each archived table must still exist with the same leading columns, types,
keys and constraints; its definition may differ only by added column definitions,
as `ALTER TABLE ADD COLUMN` writes them. Anything else, including a dropped,
renamed or retyped table or column and a migration the archive has but this
installation lacks, is refused with `schema_mismatch` (local `rer import` exit 4)
before any staging or audit write. Without a replayer (the HTTP handler, direct
bindings), only identical schemas and `acceptedSchemas` restore.

The import status and CLI receipt carry `bridged`: `migrations` (the later
migrations bridged), `tables` (later tables left empty), `columns` (later columns
per table that took defaults), `fromSchema` and `toSchema`. The import job keeps it
and v1 recovery adds it to its audit record. `archiveHash`, `contentHash`,
the erasure fence and v1's own checks are unchanged.

## Backup-only v1 recovery

When your only backup is a version 1 archive and the original installation is
gone, the Base local Workers CLI provides an explicitly acknowledged recovery.
Use a separate, empty installation with the same product schema, or one that
differs only by [later additive migrations](#archives-across-later-additive-migrations),
and the same portability policy. Keep its writers stopped. Do not run setup or claim an owner first:
recovery also refuses populated identity, excluded and normally replaceable
tables, and any objects in the declared buckets. It does not merge or overwrite
existing installation data. Remote and container recovery are not supported.

1. Keep the original v1 backup untouched. Obtain a fresh runnable checkout of
   your product with this CLI, install its dependencies with `rer install`, and
   copy the backup to `./exports/backup-v1.rer`. On macOS/Linux, make that copy
   owner-only with `chmod 600 exports/backup-v1.rer`. Input files must be regular,
   private, single-link files; do not use a symlink.
2. Read the verification limits below, then run from that empty checkout:

   ```sh
   rer import --input exports/backup-v1.rer --legacy-v1 --yes \
     --acknowledge-unverified-metadata --output exports/recovered-v2.rer
   ```

   `--yes` confirms restoring data. The separate
   `--acknowledge-unverified-metadata` accepts the missing v1 metadata binding;
   `--yes` alone cannot authorize legacy recovery. `--output` must name a new
   safe archive path, inside `exports/` or an absolute path outside the checkout.
   The command verifies the input before destination migrations, restores it,
   and finishes by writing and verifying a fresh owner-only v2 export. An
   existing output is refused. A v2 input cannot use this recovery mode.
3. Keep `recovered-v2.rer` with your backups. Ordinary
   `rer import --input exports/recovered-v2.rer --yes` accepts it in another
   empty installation. Re-enter the reported required configuration and recover
   owner access according to your product's identity policy; provider links
   still need explicit re-linking. Check the recovered content before normal use.

Recovery verifies all checks v1 carried: schema checksum, each ordered part's
checksum, part/table counts, row order/types, binary sizes and hashes, the
closing content hash and completeness. It validates the carried erasure journal
and refuses rows matching its tombstones or any destination erasure fence.
Product validation, foreign keys and normal restore safeguards still apply.
Any mismatch refuses recovery; this mode does not repair damaged archives.

Recovery needs a new installation. SQLite, migration and transfer bookkeeping, the
storage tables of FTS5 indexes (`<index>_data|idx|content|docsize|config`; the index
itself is still checked through its own SELECT) and the rows the destination's own
migrations seed may exist; the seed rows are compared with a scratch replay of the
applied migrations (Node runners) and must be unchanged. Any other row refuses with
`legacy_target_not_empty`, before staging and again inside the restore batch. A table
the policy lists in `replaceableTables` is replaced by the restore as usual.

V1 cannot authenticate the complete manifest: source identity, export time,
erasure epoch/journal, rowids and other metadata lack the v2 archive binding.
Checksums are consistency checks, not proof of authorship. A missing or altered
erasure record cannot be reconstructed, and deletions after the backup are
unknown. The new v2 export binds the recovered data and metadata from recovery
onward; it cannot prove the original v1 metadata was authentic.

The installation records `legacy_v1_unverified_restore`, the explicit metadata
acknowledgement, claimed source identity and export time, output path and restored content
hash in `rer_portability_recovery_audit`, atomically with the restore. This
additive, local bookkeeping table survives transfer cleanup and is excluded
from data exports. No historical migration is rewritten. If the final v2
export fails (for example, disk full), the restore and audit remain: preserve
the installation, resolve the output problem and run ordinary `rer export
--output exports/recovered-v2.rer`. The recovery command reports failure until
its v2 output succeeds; do not reset the recovered installation to retry.

`exports.create(actor?)` copies all tables in one D1 batch. Product writes may
continue after that snapshot. R2 listing records size and etag; changes or missing
objects fail subsequent reads. D1 and R2 do not share a cross-binding transaction.
Transfer bookkeeping lives in sidecar tables, so product tables up to D1's
100-column limit retain the full column and binding capacity. A keyless table
with 100 columns or generated columns restores its rowids with two updates in
the same atomic batch.
Schemas shadowing all three SQLite rowid aliases refuse export at construction.
Encoded projections that exceed D1's SQL statement limit also refuse construction
by table name. Product-only staging keeps restore queries small even with long
column names.
Advance normalizes the durable snapshot, sorts archived keys and checks attachment
references again before completing the archive.
`exports.advance(id,{expectedPart,maxParts})` commits durable bounded parts;
`expectedPart` makes a lost-acknowledgement retry a no-op. Status reports progress;
download streams completed jobs. Abort removes snapshots and stored parts.

`imports.create(manifest,actor?)` creates staging under one durable import lock.
Upload parts strictly in order. Same-index/same-hash retries are no-ops; different
content returns 409. Finalize requires the closing `archiveHash` and verifies all
parts, semantic contents, destination
emptiness, erasure and product invariants. R2 ownership is recorded after the
empty-namespace check. Verified object writes precede one atomic D1 batch, with
deferred FKs, trigger suppression/recreation, replaceable rows, staged inserts,
journal adoption and completion. FK cycles and self-references restore together.
An unsuccessful commit removes only owned objects. A lost commit acknowledgement
is resolved by reading durable completion before any cleanup.

An empty destination must be reserved for restore: pause destination writers and
serialize finalize/abort calls. Product writes to source tables can continue.
R2 has no compare-and-swap transaction covering bucket emptiness and writes.
An interrupted applying job can be finalized again; ownership survives restart.
Keep job status until the client acknowledges completion. Abort completed exports
and unfinished imports when no longer needed; completed import copies can be
invalidated by the product's erasure batch.

## HTTP and CLI

`await createPortabilityHandler({db,buckets,policy,appOrigin,basePath,authorize})`
returns an async dispatcher, or null for foreign paths. Default base path is
`/api/portability`. The product's `authorize(request,{operation,jobId})` returns
an actor id or null. Jobs belong to their creating actor. Unsafe methods require
the exact configured Origin. Responses have `Cache-Control: no-store` and errors
are `{error:code}`. Request bodies are bounded; `maxBodyBytes` can lower the bound.

| Method / relative path | Action |
| --- | --- |
| `POST exports` | Create export. |
| `GET exports/:id` | Status. |
| `POST exports/:id/advance` | Advance with optional expectedPart/maxParts. |
| `GET exports/:id/download` | Stream archive. |
| `POST exports/:id/abort` | Clean up export. |
| `POST imports` | Create with `{confirmed:true,manifest}`. |
| `PUT imports/:id/parts/:index` | Upload part. |
| `POST imports/:id/finalize` | Apply with `{archiveHash,contentHash?,laterJournal?}`. |
| `GET imports/:id` | Status. |
| `POST imports/:id/abort` | Clean up unfinished import. |

```sh
node vendor/base/modules/portability/cli.mjs export --origin https://app.example.com --session-file /absolute/session.cookie --out /absolute/archive.jsonl
node vendor/base/modules/portability/cli.mjs import --origin https://app.example.com --session-file /absolute/session.cookie --from /absolute/archive.jsonl
node vendor/base/modules/portability/cli.mjs status --origin https://app.example.com --session-file /absolute/session.cookie --resume JOB_ID
node vendor/base/modules/portability/cli.mjs abort --origin https://app.example.com --session-file /absolute/session.cookie --resume JOB_ID
```

Only HTTPS or HTTP on literal localhost, 127.0.0.1 or [::1] is accepted. Origins
cannot contain URL credentials, path, query or fragment. The small regular session
file contains one cookie; its value is never displayed or copied. Paths must be
absolute. `--base-path` selects another mounted path. Export refuses an existing
output, writes a 0600 `.partial`, verifies every line, syncs, then renames it to
the final name, leaving no second link, so `rer import` accepts the file. New
directories are 0700. A 0600 `.transfer.json` stores the job id and origin.
Use the printed resume command with the same job id. A resumed download
starts at the manifest and re-verifies the stream before promotion. Imports
re-read and verify the file, retrying earlier acknowledged parts harmlessly.

## Direct bindings

The adopting seed supplies Wrangler; the module adds no dependency:

```js
import { getPlatformProxy } from 'wrangler';
import { createPortability, readArchive } from './vendor/base/modules/portability/index.mjs';
import { portabilityPolicy } from './src/portability-policy.mjs';
const proxy = await getPlatformProxy({ remoteBindings: false });
// For reviewed remote use, mark the D1/R2 bindings remote in Wrangler config
// and enable remoteBindings. Credential provisioning stays with the seed.
try {
  const service = await createPortability({ db: proxy.env.DB, buckets: {FILES:proxy.env.FILES}, policy: portabilityPolicy });
  const id = await service.exports.create();
  while ((await service.exports.advance(id,{maxParts:16})).phase === 'building') {}
  for await (const record of readArchive(await service.exports.download(id))) {
    // Write each record to an owner-only file, or upload it to a fresh target.
  }
} finally { await proxy.dispose(); }
```

## Erasure fence

Include `await service.erasureStatements(table,primaryKey)` in the product's own
deletion batch. Keys are objects of primary-key columns; a keyless table uses
`{rowid:integer}`. Tombstones are opaque hashes bound to source identity, table
and canonical key. Journals grow and epochs prevent older source restoration.
For rows deliberately kept with all personal values replaced, include
`await service.redactionStatements()` in that same transaction instead of
permanently tombstoning their retained primary keys. It fences the source's
checkpoint using the private portability state row and advances the epoch.
A destination or trusted later journal with that checkpoint refuses the whole
older archive; a post-redaction archive remains restorable with anonymous rows.
This stricter checkpoint is necessary when preserved identities still appear in
new archives. It does not change offline transfer's need for a trusted later journal.

Archives, separately supplied later journals and destination journals all fence
restore. Commit adopts source identity so subsequent erasures keep matching.

Include `await service.invalidateTransfersStatements()` in that same batch to
drop every transfer snapshot, staging copy and stored part. This does not plan
product erasure or remove product objects; the product handles attachments and
any extra state. Do not retain a previously downloaded archive as erasure proof;
supply the owner's later journal when restoring old offline data.

## Measured capacity

One local Miniflare D1/R2 run exported, restored and exported 20,000 rows across
five tables in 171.169 seconds, with 625 parts at a configured 4 KiB bound and a
1,979,471-byte archive. Restore used one atomic D1 commit. The verification run
reports the measurements again. These measurements are test evidence, not a production
capacity claim. Real D1 CPU, query, statement and storage limits, object mutation,
destination writers and extra-payload recovery need product-level verification.

## Adopting

Copy exactly these runtime, declaration and schema files byte for byte under the
seed's `vendor/base/` directory. The fixture adoption test parses this list and
executes the copied Worker and CLI. Tests and development fixtures are not copied.

```text
modules/portability/index.mjs
modules/portability/index.d.mts
modules/portability/lines.mjs
modules/portability/hash.mjs
modules/portability/format.mjs
modules/portability/catalogue.mjs
modules/portability/storage.mjs
modules/portability/copies.mjs
modules/portability/dev-data.mjs
modules/portability/provider-data.mjs
modules/portability/generated.mjs
modules/portability/restore-safety.mjs
modules/portability/bridge.mjs
modules/portability/migration-statements.mjs
modules/portability/legacy-safety.mjs
modules/portability/export.mjs
modules/portability/import.mjs
modules/portability/payloads.mjs
modules/portability/journal.mjs
modules/portability/http.mjs
modules/portability/cli.mjs
modules/portability/cli-options.mjs
modules/portability/schema/portability.sql
```

Apply `schema/portability.sql` as the seed's next numbered migration. Preserve
all existing migrations and their ledger. Wire package.json:

```json
{"scripts":{"export":"node vendor/base/modules/portability/cli.mjs export","import":"node vendor/base/modules/portability/cli.mjs import"}}
```

Before copying, capture the source checkout's actual origin with
`git remote get-url origin` and its full revision with `git rev-parse HEAD`.
Record this component in `edition.json`, replacing `ORIGIN` and `PIN` with those
values. Keep the real source provenance in the edition's component and source
lock rather than embedding a repository address in the copied module:

```json
{"id":"runeditrun/portability","role":"module","source":{"kind":"local","paths":["vendor/base/modules/portability"],"origin":{"repository":"ORIGIN","revision":"PIN","paths":["modules/portability"]}}}
```

Follow the seed's edition-authoring source-lock workflow, then prove the copy:

```sh
node scripts/edition-authoring/cli.mjs lock
node scripts/edition-authoring/cli.mjs check
node scripts/edition-authoring/cli.mjs record-base vendor/base/modules/portability modules/portability PIN
node scripts/edition-authoring/cli.mjs verify-base
```

Add `verify-base` and an integrated export/import/export test to the seed's verify.
Keep the seed's real binding names and authorization in its Worker:

```js
import { createPortabilityHandler } from './vendor/base/modules/portability/index.mjs';
const handler = await createPortabilityHandler({
  db:env.DB, buckets:{FILES:env.FILES}, appOrigin:env.APP_ORIGIN,
  policy:{product:'my-product',buckets:{FILES:{}},secretColumns:{connections:['token']},
    requiredConfiguration:['PROVIDER_KEY'],
    exportRow(table,row){if(table==='connections')row.enabled=0;return row;}},
  authorize:async request=>(await ownerSession(request))?.actorId??null,
});
const response = await handler(request); // null means another route owns it
```

Policy, erasure planning, destination maintenance and UI stay in the product.
Base's default-seed and composed foundation CLI adapters adopt direct local D1
bindings with explicit identity/configuration exclusions. Their CLI journeys
exercise archive/reset/restore/archive equivalence. Remote transfer and deployed
product acceptance remain outside this local adoption.
