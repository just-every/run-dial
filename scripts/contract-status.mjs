import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/** Documentation claims must agree with the row census; evidence names actual repository artifacts. */
export async function validateContractStatus(root, contract, clauseIds) {
  const [acceptance, claims] = await Promise.all(['ACCEPTANCE.md', 'docs/CLAIMS.md'].map(path => readFile(resolve(root, path), 'utf8')));
  const rows = contract.split('\n').filter(line => /^\| `[A-Z][A-Z-]*-\d{3}` \|/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
  const statuses = new Map(rows.map(row => [row[0].replaceAll('`', ''), row[3]]));
  assert.equal(rows.length, statuses.size, 'Status has no duplicate clause rows');
  assert.deepEqual([...statuses.keys()].sort(), [...clauseIds].sort(), 'Status covers each clause exactly once');
  const accepted = new Map(acceptance.split('\n').filter(line => /^\| [A-Z][A-Z-]*-\d{3} —/.test(line)).map(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    return [cells[0].split(' —')[0], cells.at(-1).toLowerCase()];
  }));
  assert.equal(accepted.size, statuses.size, 'ACCEPTANCE covers the same clause census');
  for (const [id, status] of statuses) {
    assert.ok(['done', 'partial', 'missing'].includes(status), `${id}: known Status`);
    assert.equal(accepted.get(id), status, `${id}: ACCEPTANCE agrees with Status`);
  }
  for (const [, id, status] of claims.matchAll(/^([A-Z][A-Z-]*-\d{3}) is (done|partial|missing)\b/gm)) assert.equal(statuses.get(id), status, `${id}: CLAIMS agrees with Status`);
  const counts = ['done', 'partial', 'missing'].map(status => rows.filter(row => row[3] === status).length);
  const census = claims.match(/The contract census is (\d+) done \/ (\d+) partial \/ (\d+) missing \((\d+) clauses\)/);
  assert.ok(census, 'CLAIMS states the current census');
  assert.deepEqual(census.slice(1).map(Number), [...counts, rows.length], 'CLAIMS census is recounted from Status rows');
  const acceptedCensus = acceptance.match(/Counts: (\d+) clauses — (\d+) done, (\d+) partial, (\d+) missing\./);
  assert.ok(acceptedCensus, 'ACCEPTANCE states the current census');
  assert.deepEqual(acceptedCensus.slice(1).map(Number), [rows.length, ...counts], 'ACCEPTANCE census is recounted from Status rows');
  for (const row of rows) {
    for (const [, path] of row[4].matchAll(/`([^`]+)`/g)) {
      if (/\s/.test(path)) continue; // Named journeys are prose; repository evidence paths use no spaces.
      if (!path.includes('/') && !/\.(?:md|mjs|ts|tsx|sql|json)$/.test(path)) continue;
      const destination = resolve(root, path);
      assert.ok(destination.startsWith(root + sep), `${row[0]}: evidence stays inside repository`);
      await access(destination).catch(() => assert.fail(`${row[0]}: missing Evidence path ${path}`));
    }
  }
  return counts;
}
