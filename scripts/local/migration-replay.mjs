import { PortabilityError } from '@runeditrun/rer/modules/portability';
import { migrationReplay } from '@runeditrun/rer/modules/portability/migration-history';
import { appliedMigrations } from '@runeditrun/rer/internal/modules/portability/bridge.mjs';
import { splitSqlStatements } from '../delivery/base/sql-statements.mjs';
import { migrationFiles } from '../archive/schema.mjs';

/** Base's replay of the destination's applied migrations, in its ledger's order,
 * from this checkout's files (never the archive's SQL). Base places a restore in
 * that history and vouches for rows the migrations themselves seed. */
export async function restoreMigrations(db, policy) {
 const files = new Map((await migrationFiles()).map(m => [m.file.split('/').at(-1), m]));
 const plan = ((await appliedMigrations(db)) ?? []).map(name => {
  const file = files.get(name);
  if (!file) throw new PortabilityError('schema_mismatch:migration_history', 409);
  return { name, statements: splitSqlStatements(file.sql), sha256: file.sha256 };
 });
 return migrationReplay(plan, policy);
}
