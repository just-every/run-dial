import { createHash } from 'node:crypto';
import { endedFiles, endedAsOf } from '../move-in/ended.mjs';

export async function personalSource(rt, { email, name, text }) {
  const files = await endedFiles();
  const file = files.find(item => item.name === 'invitees-1.json');
  const page = JSON.parse(file.bytes);
  Object.assign(page.collection[0], { email, name });
  page.collection[0].questions_and_answers[0].answer = text;
  file.bytes = Buffer.from(JSON.stringify(page));
  const manifestFile = files.find(item => item.name === 'manifest.json');
  const manifest = JSON.parse(manifestFile.bytes);
  const entry = manifest.files.find(item => item.name === file.name);
  entry.size = file.bytes.length; entry.sha256 = createHash('sha256').update(file.bytes).digest('hex');
  manifestFile.bytes = Buffer.from(JSON.stringify(manifest));
  const preview = await rt.upload('preview', files, { asOf: endedAsOf });
  let current = await rt.upload('apply', files, { asOf: endedAsOf, fingerprint: preview.report.fingerprint, acknowledged: true });
  for (let n = 0; current.job.state !== 'completed' && n < 60; n++) current = await rt.data(`/api/app/move-in/jobs/${current.job.id}/resume`, {});
  assertCompleted(current);
  return { files, job: current.job, asOf: endedAsOf };
}
function assertCompleted(value) { if (value.job.state !== 'completed') throw Error('Personal source fixture did not complete through native routes'); }
