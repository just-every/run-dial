import { planD1ImportStream, createD1ImportStream, resumeD1ImportStream, canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index.ts';
import { importContext } from '../../src/core/features/move-in/service';
import type { SessionRecord } from '../../src/core/features/operators';

/** Dial filenames cannot carry an email. Use the real maintained kit to create
 * an otherwise inert stream with a person-identifying operation header. Privacy
 * erasure itself is always exercised through the authenticated product HTTP. */
export async function headerFixture(db: D1Database, email: string) {
  const session = await db.prepare("SELECT s.id AS sessionId,o.id FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE o.status='active' AND s.revoked_at IS NULL ORDER BY s.rowid DESC LIMIT 1").first<SessionRecord>();
  if (!session) throw Error('Fixture needs native authenticated owner');
  const context = { ...importContext(db, session), operationKey: email };
  const payload = { fixture: 'header-retirement' };
  const hash = sha256(canonicalJson(payload));
  const source = { artifacts: [{name:'header.json',sha256:hash,size:canonicalJson(payload).length}], diagnostics: [], records: [{ namespace: context.namespace, kind: 'header-fixture', sourceId: 'nonpersonal-header-record', payload, payloadHash: hash, artifactHash: hash, location: {artifact:'header.json'} }] };
  const plan = await planD1ImportStream(source, { version: context.mappingVersion, map: () => ({ effects: [] }) }, context);
  const stream = await createD1ImportStream(plan, { ...context, reviewedFingerprint: plan.fingerprint });
  await resumeD1ImportStream(stream.id, context);
  const jobs = (await db.prepare('SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=? ORDER BY ordinal').bind(stream.id).all<{job_id:string}>()).results;
  return { streamId: stream.id, jobs: jobs.map(row => row.job_id) };
}
