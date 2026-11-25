import { migrationReplay } from '@runeditrun/rer/modules/portability/migration-history';
import { nativeMigrationHistory, requireAppliedOwnerFiles } from '@runeditrun/rer/internal/modules/portability/owner-history.mjs';
import { matchMigrationLedger } from '@runeditrun/rer/internal/modules/portability/ledgers.mjs';
import { splitSqlStatements } from '../delivery/base/sql-statements.mjs';
import { migrationFiles } from '../archive/schema.mjs';

/** Base's replay of the destination's applied migrations, in its ledger's order,
 * from this checkout's files (never the archive's SQL). Base places a restore in
 * that history and vouches for rows the migrations themselves seed. The files
 * come from Dial's own migration inventory: rer's inventory reads a root
 * wrangler.jsonc, which Dial does not keep (it renders wrangler.toml). */
export async function restoreMigrations(db, policy) {
 const files = (await migrationFiles()).map(m => ({ name: m.file.split('/').at(-1), sha256: m.sha256, statements: splitSqlStatements(m.sql) }));
 const history = await nativeMigrationHistory(db, []);
 requireAppliedOwnerFiles(history, files);
 return migrationReplay(matchMigrationLedger(history?.entries ?? [], files, {}).map(name => files.find(file => file.name === name)), policy);
}
