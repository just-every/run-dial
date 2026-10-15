import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { main as deploy } from '../scripts/deploy.mjs';
import { main as teardown } from '../scripts/teardown.mjs';
import { installation } from './deployment/fixture.mjs';

const destructive = requests => requests.filter(row => row.method === 'DELETE');

test('Dial repeat deployment refuses drift without overwriting its retained receipt or provider state', async t => {
 const { env, requests } = await installation(t);
 const receipt = await readFile(env.RER_DEPLOY_RECEIPT);
 await assert.rejects(deploy(['deploy'], env), /repeat-deployment-drift/);
 assert.deepEqual(await readFile(env.RER_DEPLOY_RECEIPT), receipt);
 assert(requests.length > 0); assert(requests.every(row => row.method === 'GET'));
});

test('reviewed Dial health requires authoritative owner bootstrap before dropping only the consumed setup secret', async t => {
 const { env, state, requests, planned } = await installation(t);
 assert.equal(planned.deployed, false);
 assert.equal((await deploy(['health'], env)).ok, true);
 state.handlers = ['fetch', 'queue'];
 await assert.rejects(deploy(['health'], env), /missing-scheduled-handler/);
 state.handlers.push('scheduled');
 state.secrets = state.secrets.filter(row => row.name !== 'SETUP_TOKEN');
 await assert.rejects(deploy(['health'], env), /missing-deployed-secret/);
 state.bootstrap.exec("INSERT INTO oa_bootstrap VALUES(1,'owner')");
 await assert.rejects(deploy(['health'], env), /missing-deployed-secret/);
 state.bootstrap.exec("INSERT INTO oa_operators VALUES('owner','owner','inactive')");
 await assert.rejects(deploy(['health'], env), /missing-deployed-secret/);
 state.bootstrap.exec("UPDATE oa_operators SET status='active'");
 assert.equal((await deploy(['health'], env)).ok, true);
 for (const name of ['SESSION_SECRET', 'MAIL_API_KEY']) {
  const saved = state.secrets; state.secrets = saved.filter(row => row.name !== name);
  await assert.rejects(deploy(['health'], env), /missing-deployed-secret/); state.secrets = saved;
 }
 assert.equal(destructive(requests).length, 0);
 assert(requests.every(row => row.method === 'GET' || row.path.endsWith('/query')));
});

test('interrupted Dial deployment inventory reads exact owned identities without authorizing deletion', async t => {
 const { env, plan, receipt, requests } = await installation(t, { interrupted: true });
 const result = await teardown(['inventory'], env);
 assert.equal(result.worker, null); assert.equal(result.deleted, false); assert.equal(result.requiresIdentityReview, true);
 assert.deepEqual(result.resources.d1, []);
 assert.deepEqual(result.resources.r2, [{ name: `${plan.worker}-files` }]);
 assert.deepEqual(result.resources.queues, receipt.resources.queues.map(({ name, id }) => ({ name, id })));
 assert(requests.every(row => row.method === 'GET'));
 await assert.rejects(teardown(['delete'], env), /missing-or-invalid-RER_DEPLOY_PLAN/);
 assert.equal(destructive(requests).length, 0);
});

test('Dial teardown refuses unconfirmed, foreign or drifted receipts and ambiguous consumers before destructive writes', async t => {
 const { env, receipt, state, requests, plan } = await installation(t);
 const proof = await teardown(['plan'], env);
 assert.equal(proof.deleted, false); assert.equal(destructive(requests).length, 0);
 await assert.rejects(teardown(['delete'], env), /teardown-confirmation-required/);
 await assert.rejects(teardown(['delete'], { ...env, RER_TEARDOWN_CONFIRM: 'other-worker' }), /confirmation-mismatch/);
 const drifted = structuredClone(receipt); drifted.resources.d1[0].id = '99999999-9999-4999-8999-999999999999';
 await writeFile(env.RER_DEPLOY_RECEIPT, JSON.stringify(drifted));
 await assert.rejects(teardown(['delete'], { ...env, RER_TEARDOWN_CONFIRM: plan.worker }), /resource-identity-drift/);
 await writeFile(env.RER_DEPLOY_RECEIPT, JSON.stringify({ ...receipt, accountId: '9'.repeat(32) }));
 await assert.rejects(teardown(['delete'], { ...env, RER_TEARDOWN_CONFIRM: plan.worker }), /disposable-receipt-required/);
 await writeFile(env.RER_DEPLOY_RECEIPT, JSON.stringify(receipt));
 const later = state.queues[1], owner = { type: 'worker', script_name: plan.worker, consumer_id: '7'.repeat(32) };
 for (const consumers of [
  [{ ...owner, script_name: 'foreign-worker' }],
  [{ ...owner, script: 'foreign-worker' }],
  [{ ...owner, consumer_id: state.queues[0].consumers[0].consumer_id }],
  [{ ...owner, consumer_id: 'not-an-id' }],
  [owner, { ...owner, consumer_id: '8'.repeat(32) }],
 ]) {
  later.consumers = consumers;
  await assert.rejects(teardown(['delete'], { ...env, RER_TEARDOWN_CONFIRM: plan.worker }), /teardown-(foreign-queue-consumer|invalid-consumer-id|ambiguous-queue-consumer)/);
 }
 assert.equal(destructive(requests).length, 0); assert.equal(state.present, true);
});

test('confirmed Dial teardown removes owned consumers before their Worker and preserves similarly named resources', async t => {
 const { env, plan, state, requests } = await installation(t);
 // Both observed and documented provider identities name the same owned Worker.
 state.queues[0].consumers[0].script = plan.worker;
 const result = await teardown(['delete'], { ...env, RER_TEARDOWN_CONFIRM: plan.worker });
 assert.equal(result.deleted, true);
 const deletions = destructive(requests);
 assert.match(deletions[0].path, /\/consumers\//);
 assert.equal(deletions[1].path, `/workers/scripts/${plan.worker}?force=true`);
 assert.deepEqual(state.buckets, [{ name: `${plan.worker}-files-old` }]);
 assert.deepEqual(state.queues.map(row => row.queue_name), [`${plan.worker}-jobs-old`]);
 assert.deepEqual(state.databases, []); assert.deepEqual(state.namespaces, []);
});
