# Subject erasure

This dependency-free source module erases one subject (a person, contact,
requester, booking and so on) and everything a seed declares as depending on
it, for BASE-DATA-003. Audit records survive with an anonymised reference
(BASE-OPS-005). It was generalised from the erasure code of Penny, Orbit, Dial,
HappyToHelp, Cradle and Slate. Each seed keeps its own authorization, confirmation UI, holds,
retained exceptions and effects outside D1 and R2. Clauses are in
[CONTRACT.md](CONTRACT.md).

## Declaring an entity

```js
import { defineErasure, createErasure } from './vendor/base/modules/erasure/index.mjs';
export const person = defineErasure({
  entity: 'person',
  root: { table: 'people' },
  edges: [
    { table: 'person_notes', from: 'people', on: { person_id: 'id' } },
    { table: 'person_files', from: 'people', on: { person_id: 'id' }, blob: { bucket: 'FILES', keyColumn: 'storage_key' } },
    { table: 'signals', from: 'people', where: 'instr(payload_json,?)>0', params: ['email'] },
  ],
  redact: [{ table: 'messages', from: 'people', on: { author_id: 'id' }, set: { body: '' }, reason: 'transcript order is kept' }],
  audit: [{ table: 'audit_events', column: 'entity_id', of: 'people', where: "entity_type='person'", clear: { details: '{}' } }],
  retain: [{ table: 'opt_out_hashes', reason: 'keyed hash prevents re-contact' }],
  hold: async ({ db, subject }) => null,         // or a reason string: refuses with 409
  beforeStatements: async ({ db, subject, label }) => [], // durable copy/unlink before the first child batch
  statements: async ({ db, subject, label }) => [], // product SQL committed with the subject row
});
```

| Part | Meaning |
| --- | --- |
| `root` | The subject's table; optional `redact: {set, reason, identityColumns?}` keeps an anonymous root. `set` overwrites every non-key, non-identity column with declared constants, or a function of `{subject,anonymousId}`. `identityColumns` may contain only opaque structural links (e.g. project/workspace IDs), never personal fields. Keys come from its primary key (`{rowid}` for keyless tables). |
| `edges` | Rows deleted with the subject. `on` maps child columns to parent columns. `where` is a bound SQL predicate whose `params` name parent columns. A table may appear in several edges. Overlapping paths are deduplicated and ordered by dependency. A cyclic deletion graph is refused before mutation; unlink cycles in seed policy before using this helper. |
| `blob` | On an edge: the R2 binding and the column holding the object key. Keys should be opaque (no file names). |
| `redact` | Kept rows whose columns are overwritten, each with a reason. |
| `audit` | Audit columns referencing rows of a deleted table (single-column key). They receive the erasure's label, and `clear` columns are overwritten. |
| `retain` | Tables kept on purpose, with reasons. Listed in preview and receipt. |
| `hold`, `beforeStatements`, `statements` | Refusal, durable pre-deletion effects (first batch), and final effects (after deletes). |

Any table with a foreign key into a deleted table must be declared. Otherwise
preview and erasure refuse with `undeclared_dependent:<child>:<parent>`, because a
`CASCADE` would remove a row that erasure never fenced. This includes `rer_*` product
tables. A destructive FK action into a retained/redacted/audit table is refused
with `unsafe_retained_fk:<child>:<parent>`. This is a schema-level refusal, even
when current links are null. Migrate such retained links to non-destructive
`NO ACTION` FKs and detach them before admission, or keep a redacted parent. Retained keys are
verified after each batch and before completion.

## Phases

```js
const erasure = createErasure({ db: env.DB, buckets: { FILES: env.FILES }, portability, declarations: [person] });
const preview = await erasure.preview('person', { id });          // counts, blob count, retained, planHash
const opened = await erasure.start('person', { id }, { planHash }); // receipt, phase 'deleting'
const receipt = await erasure.run(opened.id, { until: Date.now() + 20_000 });
if (receipt.phase !== 'complete') await env.JOBS.send({ erasure: opened.id }); // continue later
```

`portability` is the seed's `createPortability({db,buckets,policy})` service.
`commit(id,{rows,until})` runs only the D1 phase: bounded atomic batches of at
most `rows` dependents (default 500), leaves first, with the subject row last.
Each deleted row's `erasureStatements` and `invalidateTransfersStatements()` go
in the same batch.
The first step collects and orders the whole plan and queues what it does not delete
in the private scope table; each later step reads and verifies only its own slice, so the
work of an erasure is linear in its rows, however many steps it takes. The queue is
not trusted for completeness: once it is empty, one more step collects the graph again
from the subject and every remembered parent, and anything written meanwhile is
erased before the receipt says `complete`. Index the child columns an edge
matches on (`on`), as foreign keys usually are, or each step scans that table. `deleteBlobs(id,{until})` runs only the blob phase, after the
commit. `run` does both within the time budget. Every phase is safe to repeat,
and a concurrent runner gets `erasure_busy` (409). The receipt says `complete`
only after the completion transaction re-reads every declared dependent and audit path
inside the fence, then every recorded object has been deleted and read back as
absent. Scope changes roll back that step and resume collection. Temporary scope
remembers earlier parents through blob cleanup, so rows or audits added after the
first D1 fence return to deletion before completion. It is scrubbed atomically
with completion. A root deleted outside the helper is refused rather than reported complete.

For retained attribution, use `root: {table: 'operators', redact: {reason: 'stable
anonymous attribution', set: ({anonymousId}) => ({email: anonymousId + '@removed.invalid',
name: 'Removed operator', status: 'removed'})}}` and explicitly set any other
non-identity columns in that schema. Only opaque IDs survive; root redaction also
advances portability's redaction checkpoint; completion verifies the replacements
and preserved structural IDs. Older archives are refused when the destination or
a supplied trusted later journal knows that checkpoint, while a post-redaction
archive can restore the anonymous row. The portability adapter must forward
`redactionStatements()` for this mode.
`anonymousId` is independent of the audit label, so retained root values cannot
link that label back to the opaque identity. Root setters must be deterministic
for their input and must not read or copy personal data.

A subject too large for one request continues through the seed's queue, and a
scheduled sweep picks up any erasure whose message was lost. The default seed's
`src/core/features/people/routes.ts` shows both. The receipt (`receipt(id)`)
holds entity, label, planned and deleted counts, retained exceptions, blob totals
and times, and never a stored value. The subject key is held only while rows
are still being deleted.

## Attributable counters

A rate limit or counter whose key is a person id, an email or a digest of one is
personal data, and a hashed key cannot be traced back to its person afterwards. So the
write records who the key belongs to, in the same D1 batch as the counter upsert, and
the declaration erases both together.

```js
import { rateEdges, rateWrite } from './vendor/base/modules/erasure/index.mjs';
const root = { table: 'people', column: 'id' };
// in the declaration
edges: [...rateEdges({ entity: 'person', root, counters: [{ table: 'rate_limits', keyColumn: 'key' }] })],
// at every write whose key identifies a known person
const [counted] = await rateWrite(db, { entity: 'person', root, subject: person.id, rateTable: 'rate_limits', rateKey: key },
  [db.prepare('INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key, window)]);
```

`rateWrite` returns the results of your statements (so admission still reads `count`).
Where the seed owns its batch, put `rateCorrelation(db, spec)` (three statements) first
in that batch instead. They abort the batch when the subject row is already gone, so a
write admitted after erasure writes nothing and `rateWrite` refuses `subject_gone`
(409); a write admitted while an erasure runs is caught by the completion re-read.

A redacted root (retained attribution, above) keeps its row under the same id, so "the row
exists" no longer means "the person is still here". Give that root a `live` predicate
over its row, false once redacted, and use the same `root` in `rateEdges` and every
`rateWrite`/`rateCorrelation`:

```js
const root = { table: 'operators', column: 'id', live: "status<>'removed'" };
```

The write guard then requires the row and the predicate. `defineErasure` refuses a
declaration with a redacted root and a rate edge on that root but no `live`
(`rate_root_live:<edge>`), and admission refuses (`rate_root_live`, 409) when the
predicate is still true for the redaction's `set` values, or names a column the
redaction does not set. A deleted root needs no `live`.
Preview and receipt count `rer_erasure_rates` and the counter table like any edge.

Seed adoption note:

1. Apply `schema/erasure-rates.sql` as the next numbered migration, after the erasure
   migrations. Add `rer_erasure_rates` and each counter table to the portability
   policy's `excludeTables` (rate windows are ephemeral).
2. Spread `rateEdges(...)` into the declaration of the entity the key identifies, one
   `counters` item per rate table. Every counter table needs a primary key.
3. Route each write whose key is derived from a known person through `rateWrite` or
   `rateCorrelation`. Keys that identify nobody (client IP, global or route scope)
   are written directly and survive as aggregates; never correlate those.
4. One key must identify one person. Erasing a person deletes every counter row their
   correlation names.

Limits: a row written before the person existed, or for an address with no person
record, has no subject and is not found; use an expiring window for it or key it by
something that identifies nobody. Rows written before adoption have no correlation:
the seed retires them in its own migration.

## Seams

- **Portability.** This module adds no second fence. It calls the service's
  `erasureStatements` for every deleted row (children and files included, not
  only the subject), so an older archive that contains any of those rows is
  refused on restore. The fence's own limit stays: an old archive offered to a
  brand-new store that has no journal cannot be recognised. Supply the owner's
  later journal there (`rer import --journal LATER_ARCHIVE`).
- **import-kit.** `nativeStatements(entity, subject)` returns the whole D1 phase
  as `{sql, params}` statements for `eraseD1ImportTarget(kind, id,
  nativeStatements, context)`. Kit custody, the product cascade and the fence
  then commit in one batch. Afterwards call `deleteBlobs(operationId)`. This
  path is unbounded (one batch), so use it for imported targets of ordinary size.
  To erase a person (not one record), pass the same statements to
  `retireD1ImportCustody({ target, values }, nativeStatements, context)`: it also
  retires imports whose headers hold the person's exact identifiers and writes
  the import erasure journal (import-kit `src/d1/README.md`).

## Adopting

Copy these files byte for byte to a folder the Worker build serves, such as
`src/modules/erasure/`. A seed made by `rer` export also receives them under
`scripts/base-cli/modules/erasure/`, but `vite dev` serves only `src`, `public`
and `node_modules`, so runtime imports must not reach into `scripts/`. The
standalone default seed copies this module and portability into `src/modules/`.
The files are:

```text
modules/erasure/index.mjs
modules/erasure/index.d.mts
modules/erasure/declaration.mjs
modules/erasure/plan.mjs
modules/erasure/order.mjs
modules/erasure/root.mjs
modules/erasure/scope.mjs
modules/erasure/completion.mjs
modules/erasure/verification.mjs
modules/erasure/cascade.mjs
modules/erasure/blobs.mjs
modules/erasure/audit.mjs
modules/erasure/receipt.mjs
modules/erasure/fence.mjs
modules/erasure/sql.mjs
modules/erasure/schema/erasure.sql
modules/erasure/rate.mjs
modules/erasure/schema/erasure-rates.sql   # only when the seed keeps attributable counters
```

Apply `schema/erasure.sql` as the seed's next numbered migration, after
portability's. For existing installations apply the scope/guard additions as a new migration
(default-seed `0017_erasure_scope.sql`), leaving applied migrations unchanged.
Finish or reconcile open operations with the old helper before upgrading. Older
operations that discarded their scope refuse `erasure_scope_missing`; the helper
cannot prove completeness without the earlier parent keys.
Add `rer_erasure_blobs`, `rer_erasure_guard`, and `rer_erasure_scope` to the portability
policy's `excludeTables`. Receipts (`rer_erasure_operations`) travel in
archives; the blob work list does not.

## Historical measurements before the review fixes

Through the default seed's route in a local `rer dev` Worker, a subject with
10,000 dependent rows (9,500 notes and 500 file rows) and 500 R2 blobs was
erased in 10.7 s in one run and 15.0 s in another. That is one request: 20
bounded D1 steps, then the blob phase, with no queue continuation needed. The
full proof table is kept with the consolidation evidence for this change.
These pre-fix measurements do not establish the performance of the corrected
helper. They are local Miniflare measurements, not production capacity claims. Real D1
statement, CPU and request limits decide `rows` per step and the request budget.
Larger subjects continue on the queue, and the receipt stays `deleting` or
`blobs` until done.
