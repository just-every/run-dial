# Erasure contract v1

The module erases one subject (an entity that holds personal data) and everything
declared as depending on it, for BASE-DATA-003. It keeps audit records with an
anonymised reference, as BASE-OPS-005 requires. Public signatures are in
`index.d.mts`. The seed owns authorization, confirmation UI, holds and any effect
outside D1 and R2.

- **ERASE-001 — Declared graph.** A seed declares one root table per entity and
  the edges that reach its dependents: column equality (`on`) or a bound SQL
  predicate (`where` + `params` taken from the parent row). A table may be
  reached through several edges, and the closure runs to a fixed point. Kept
  rows that must lose columns are declared as `redact` with a reason. Audit
  references are declared as `audit`. `root.redact` keeps an opaque anonymous
  root with a reason and explicit replacements for every non-identity column.
  The same transaction advances the maintained portability redaction checkpoint;
  old archives are refused with a trusted later journal, and post-redaction
  archives preserve anonymous attribution. Structural identities are verified.
  Root-return edges and cyclic deletion dependencies are refused before mutation.
- **ERASE-002 — No silent dependents.** Before preview or erasure, every table
  with a foreign key into a tracked table, including a redacted root, must be declared (as an edge, a
  redaction, an audit reference or a retained exception). Otherwise the call
  refuses with `undeclared_dependent:<child>:<parent>` (409) and changes
  nothing. This includes product tables named `rer_*`. Destructive FK actions
  into retained/redacted/audit rows are refused; retained keys are verified
  after effects, so `ON DELETE` actions never remove a promised retained row.
- **ERASE-003 — Preview without values.** `preview` returns counts per deleted,
  redacted and audited table, the blob count, the retained exceptions, a hold
  reason if any, and a plan hash. It never returns a stored value.
- **ERASE-004 — Cascade and fence in one commit.** Every deleted row (dependents
  leaves-first, the subject row last) is deleted in a D1 batch that also holds
  portability's `erasureStatements(table, key)` for that row and
  `invalidateTransfersStatements()`. A batch holds at most `rows` dependents, so
  deletion work is bounded. The first step reads and orders the declared closure
  and queues what it leaves; every later step reads, verifies and deletes only its
  own slice of that queue, and the last step reads the closure once more from the
  subject and every remembered parent, so the work of an erasure is linear in its
  rows. A guard on the operation's step
  counter makes a concurrent runner fail with `erasure_busy` (409) instead of
  committing twice.
- **ERASE-005 — Blobs after the commit.** For a declared `blob` edge, each row's
  object key is recorded in the same batch that deletes the row. Objects are
  deleted only after that commit. Each recorded key is checked with a read, and
  leaves the work list only once the object is gone. Repeating the blob phase is
  safe.
- **ERASE-006 — Complete means complete.** A receipt reads `deleting` while rows
  remain, `blobs` once every row is committed but some object may remain, and
  `complete` only when the final fenced transaction has re-read every declared
  dependent and audit path, retained/root-redacted rows have been verified, and
  the blob work list is empty. New dependents restart collection; a persistently
  changing scope refuses with `erasure_scope_unstable` and remains resumable. `completedAt` and `seconds` are
  set only at `complete`.
- **ERASE-007 — Untraceable audit label.** Declared audit references are
  replaced with one label per erasure, `erased:<128 random bits>`. The label is
  not derived from the subject, so nobody who holds the database or an older
  archive can recompute it or test a guess against it. Declared `clear` columns
  are overwritten. Audit rows for a batch's dependents are relabelled in that batch, and every remembered dependent's in the final one. Temporary
  scope preserves earlier keys until the final pass, catching audit rows written
  after those dependents disappeared; that scope is then removed atomically.
- **ERASE-008 — Value-free receipt.** The receipt row holds the entity name,
  label, planned and deleted counts per table, retained exceptions with reasons,
  blob totals and times. It holds the subject key only while rows are still
  being deleted, and clears it when the subject row commits.
- **ERASE-009 — Declared exceptions.** A table kept on purpose is declared in
  `retain` with a reason. Preview and receipt list it, including a root redaction reason. Nothing is skipped
  without a declaration.
- **ERASE-010 — One open erasure per subject.** `start` for a subject that has an
  open erasure in `deleting` returns that erasure unchanged. Once the subject row
  is gone, `start` answers `subject_not_found` (404) and changes nothing.
- **ERASE-011 — Seed policy hooks.** `hold` can refuse with a reason
  (`held:<reason>`, 409). `statements` adds product statements to the batch that
  commits the subject row, after deletion. `beforeStatements` adds durable
  pre-deletion policy effects in the first batch. Hooks run in the seed's code.
- **ERASE-012 — import-kit composition.** `nativeStatements(entity, subject)`
  returns the whole D1 phase as import-kit `D1Sql` (`{sql, params}`), opening
  the receipt in the same statements. These are passed to
  `eraseD1ImportTarget(kind, id, nativeStatements, context)`, so kit custody,
  the product cascade and the fence commit in one batch. `deleteBlobs` then runs
  as usual. `retireD1ImportCustody` takes the same statements for a whole
  person's import custody and its erasure journal.
- **ERASE-013 — Stated limits.** An old archive restored into a brand-new store
  that has no journal cannot be recognised. Raw database imports bypass every
  product fence. Copies outside the installation are out of reach: downloaded
  archives, delivered mail, provider records and platform backups.
- **ERASE-014 — Attributable counters.** A counter or rate row keyed by a person id,
  email or digest is written with a `rer_erasure_rates` correlation in the same D1
  batch (`rateWrite` / `rateCorrelation`), guarded on the subject row existing and,
  for a redacted root, on its `live` predicate: a declaration with a redacted root
  and a rate edge on it is refused without one, and erasure refuses a redaction that
  leaves it true, so no write is admitted after erasure in either mode.
  `rateEdges` declares the correlation and the counter rows it names as edges, so one
  erasure plan deletes both and completion re-reads them. Uncorrelated aggregates are
  untouched. A key that was never correlated cannot be found.
