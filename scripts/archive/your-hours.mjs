import { readFile } from 'node:fs/promises';
import { splitSqlStatements } from '../delivery/base/sql-statements.mjs';

export const yourHoursMigration = '0081_your_hours.sql';
const statementStart = statement => statement.replace(/^(?:\s*--[^\n]*\n)*\s*/, '');
// Restored rows never pass through later migrations, and choosing your hours reads
// every event and schedule, not one row. A backup made before 0081 restores with no
// schedule as yours (prior-schemas.mjs), so the update's own guarded steps run once
// after the restore and leave it as they leave a live install.
export async function electYourHours(db) {
  const sql = await readFile(new URL(`../../migrations/core/${yourHoursMigration}`, import.meta.url), 'utf8');
  const steps = splitSqlStatements(sql).filter(statement => !/^(ALTER TABLE|CREATE UNIQUE INDEX)\b/i.test(statementStart(statement)));
  await db.batch(steps.map(statement => db.prepare(statement)));
}
