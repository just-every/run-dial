# Prior-release backup fixture

`listed-bb5d650f.rer` retains the populated installation from release `bb5d650f`,
through migration `0061_booking_links.sql`. It holds 67 rows and two files. Its
owner-held salt and all identities are synthetic.

The fixture was re-exported with the pinned rer 0.2.87 writer, following Base
portability's documented re-export path for older version 2 backups without
`schemaObjects`. This adds the complete inventory of 360 indexes and triggers.
It does not apply later product migrations or acknowledge an unverified schema.

To repeat the update, preserve the retained input outside the checkout. Recreate
the original release source with `git archive bb5d650f`, install its original
migrations into an empty local D1/R2 installation, and supply the synthetic salt
from `tests/archive-prior-release.test.mjs`. Use the current pinned dependencies
with that source, keeping its schema model, table policy, row validation and
schema-proof producer unchanged. Supply the current runner's documented
`migrations` callback to `createPortability`: replay the original installation's
applied migration names, exact file hashes and split statements with
`migrationReplay`. This lets the current importer verify the old backup against
the same original schema, including its indexes and triggers.

Run the original installation's `scripts/local/transfer.mjs import` on the
private retained input, then `scripts/local/transfer.mjs export` to a new file.
Both operations use the pinned Base importer/writer. Never construct or edit an
archive manifest, schema identity, schema-object inventory or checksum by hand.
Before replacing the fixture, read both archives through `readArchive` and
compare every part item (all rows, file chunks and extra payloads), every table
definition/count and all object metadata. They must be identical. Only the
writer's authenticated manifest metadata and closing archive hash change.

Run `tests/archive-prior-release.test.mjs` against the replacement. It must still
restore all original values and files through both native and Platform ledgers,
apply the later migrations' declared defaults, and refuse each malformed ledger
without changing storage. Keep the test assertions and production checks intact.
