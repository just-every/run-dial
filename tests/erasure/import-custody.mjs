import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { endedFiles, endedAsOf } from '../move-in/ended.mjs';
import { snapshot, scan, containsPersonal } from './scan.mjs';
import { savedUploader } from '../move-in/upload.mjs';

export const people = [
  { email: 'custody-a-78321@example.test', name: 'CUSTODY_PERSON_A_78321', answer: 'CUSTODY_ANSWER_A_78321' },
  { email: 'custody-b-78321@example.test', name: 'CUSTODY_PERSON_B_78321', answer: 'CUSTODY_ANSWER_B_78321' },
];
export async function importPeople(rt, subjects = people) {
  const files = await endedFiles();
  for (const [index, person] of subjects.entries()) {
    const file = files.find(file => file.name === `invitees-${index + 1}.json`), page = JSON.parse(file.bytes);
    Object.assign(page.collection[0], { email: person.email, name: person.name });
    page.collection[0].questions_and_answers[0].answer = person.answer;
    file.bytes = Buffer.from(JSON.stringify(page));
  }
  const manifest = files.find(file => file.name === 'manifest.json'), data = JSON.parse(manifest.bytes);
  for (const entry of data.files) {
    const file = files.find(file => file.name === entry.name);
    entry.size = file.bytes.length; entry.sha256 = createHash('sha256').update(file.bytes).digest('hex');
  }
  manifest.bytes = Buffer.from(JSON.stringify(data));
  const preview = await rt.upload('preview', files, { asOf: endedAsOf });
  const applied = await rt.upload('apply', files, { asOf: endedAsOf, fingerprint: preview.report.fingerprint, acknowledged: true });
  const result = await finish(rt, applied, 'completed');
  return { files, job: result.job };
}
export async function finish(rt, current, state) {
  for (let n = 0; current.job.state !== state && n < 100; n++) current = await rt.data(`/api/app/move-in/jobs/${current.job.id}/resume`, {});
  assert.equal(current.job.state, state);
  return current;
}
export async function erase(rt, email) {
  const preview = await rt.data('/api/app/privacy/preview', { email });
  return rt.data('/api/app/privacy/erase', { email, confirmation: preview.confirmation, expiresAt: preview.expiresAt });
}
export async function refuseReplay(rt, files) {
  const before = await snapshot(rt.db), response = await savedUploader(rt.api, endedAsOf)('preview', files);
  assert.equal(response.status, 400);
  await response.arrayBuffer();
  assert.deepEqual(await snapshot(rt.db), before, 'refused replay changes no native, custody or receipt row');
}
export async function assertErased(rt, person) {
  await scan(rt.db, rt.bucket, Object.values(person));
  assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM ik_d1_erasure_tally').first()).n, 0);
  const journal = (await rt.db.prepare('SELECT * FROM ik_d1_erasure_journal').all()).results;
  assert.ok(journal.length);
  assert.ok(journal.some(row => JSON.parse(row.stores_json).some(store => store.rows > 0)));
  return journal;
}

/** Sanitized row counts: diagnostic output never contains identifiers or values. */
export async function custodyEvidence(rt, person) {
  const state = await snapshot(rt.db), markers = Object.values(person);
  return {
    nativeBookings: state.bookings.length,
    custody: Object.fromEntries(Object.entries(state).filter(([name]) => name.startsWith('ik_')).map(([name,rows]) => [name,{rows:rows.length,personalRows:rows.filter(row=>containsPersonal(row,markers)).length}])),
    journal: (state.ik_d1_erasure_journal ?? []).map(row=>({recordsErased:row.records_erased,jobsRetired:row.jobs_retired,streamsRetired:row.streams_retired,stores:JSON.parse(row.stores_json)})),
  };
}
