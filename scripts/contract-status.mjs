import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parseContract } from '../src/base/seed-contract.mjs';

/** Generated views are checked by contract-docs; source evidence must exist. */
export async function validateContractStatus(root, source, clauseIds) {
  const contract = parseContract(source);
  assert.deepEqual(contract.clauses.map(clause => clause.id).sort(), [...clauseIds].sort(), 'Status covers each clause exactly once');
  for (const clause of contract.clauses) {
    for (const evidence of clause.evidence) {
      const destination = resolve(root, evidence);
      assert.ok(destination.startsWith(root + sep), `${clause.id}: evidence stays inside repository`);
      await access(destination).catch(() => assert.fail(`${clause.id}: missing Evidence path ${evidence}`));
    }
  }
  return ['done', 'partial', 'missing'].map(status => contract.clauses.filter(clause => clause.status === status).length);
}
