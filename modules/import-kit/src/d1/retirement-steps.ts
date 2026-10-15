import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { D1Database, D1FieldMatch, D1FieldRedaction, D1Sql } from './types.ts';
import { canonicalJson, sha256 } from '../provenance/identity.ts';
import { sql } from './database.ts';

/** Jobs one resumable step reads. A step reads and rewrites at most this many
 * jobs' custody, which keeps it far inside one request's statements and CPU. */
export const STEP_JOBS = 25;

/** Where a resumable redaction stands: the jobs already read and found free of
 * the selected values (or rewritten), each at the custody revision it then had,
 * and the matches counted so far. A changed revision makes a job pending again.
 * It holds job ids, revisions, counts and a salted digest of the selectors, never
 * a selected value; it is bound to the destination and selectors it began with. */
export interface RedactionProgress { nonce: string; digest: string; clean: Map<string, number>; matched: D1FieldMatch[] }

const digestOf = (nonce: string, destination: string, fields: readonly D1FieldRedaction[]) =>
  sha256(canonicalJson([nonce, destination, fields.map(({ path, value, optional }) => [path, value, optional === true])]));

export function readProgress(continuation: string | undefined, destination: string, fields: readonly D1FieldRedaction[]): RedactionProgress {
  if (continuation === undefined) {
    const nonce = randomUUID();
    return { nonce, digest: digestOf(nonce, destination, fields), clean: new Map(), matched: [] };
  }
  let token: any;
  try { token = JSON.parse(Buffer.from(continuation, 'base64url').toString('utf8')); } catch { throw new Error('IMPORT_REDACTION_CONTINUATION_INVALID'); }
  if (token?.v !== 1 || typeof token.nonce !== 'string' || !Array.isArray(token.clean) || !Array.isArray(token.matched)
    || !token.clean.every((item: unknown) => Array.isArray(item) && typeof item[0] === 'string' && Number.isSafeInteger(item[1]))) throw new Error('IMPORT_REDACTION_CONTINUATION_INVALID');
  // A continuation from another erasure (other selectors or destination) must
  // never let this one skip a job.
  if (token.digest !== digestOf(token.nonce, destination, fields)) throw new Error('IMPORT_REDACTION_CONTINUATION_MISMATCH');
  return { nonce: token.nonce, digest: token.digest, clean: new Map(token.clean), matched: token.matched };
}

export function writeProgress(progress: RedactionProgress): string {
  return Buffer.from(JSON.stringify({ v: 1, nonce: progress.nonce, digest: progress.digest, clean: [...progress.clean], matched: progress.matched }), 'utf8').toString('base64url');
}

export function addMatches(total: D1FieldMatch[], step: readonly D1FieldMatch[]): D1FieldMatch[] {
  const result = total.map(item => ({ path: [...item.path], matches: item.matches }));
  for (const item of step) {
    const prior = result.find(count => canonicalJson(count.path) === canonicalJson(item.path));
    if (prior) prior.matches += item.matches; else result.push({ path: [...item.path], matches: item.matches });
  }
  return result;
}

/** Every job of the destination with its custody revision, read before any plan,
 * so a change after the read always shows as a newer revision. */
export async function destinationRevisions(db: D1Database, destination: string): Promise<{ id: string; revision: number | null }[]> {
  return (await db.prepare('SELECT j.id AS id,s.revision AS revision FROM ik_jobs j LEFT JOIN ik_d1_custody_states s ON s.job_id=j.id WHERE j.destination=? ORDER BY j.id').bind(destination).all<{ id: string; revision: number | null }>()).results;
}

/** Read inside a step's batch, after its writes: the revisions it leaves. */
export const revisionsAfter = (jobs: string[]): D1Sql => sql('SELECT job_id,revision FROM ik_d1_custody_states WHERE job_id IN (SELECT value FROM json_each(?))', JSON.stringify(jobs));
