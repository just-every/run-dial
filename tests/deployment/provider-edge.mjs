import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// Deliberately bounded Cloudflare responses for Dial's retained-receipt workflow.
// Unknown traffic fails; no real request or substitute application is allowed.
export function providerEdge({ receipt, plan, bindings, requests, interrupted }) {
 const db = new DatabaseSync(':memory:');
 db.exec('CREATE TABLE oa_bootstrap(singleton INTEGER, claim_id TEXT); CREATE TABLE oa_operators(id TEXT, role TEXT, status TEXT)');
 const state = {
  present: !interrupted, bindings, bootstrap: db,
  secrets: ['SESSION_SECRET', 'SETUP_TOKEN', 'MAIL_API_KEY'].map(name => ({ name, type: 'secret_text' })),
  databases: interrupted ? [] : receipt.resources.d1.map(row => ({ name: row.name, uuid: row.id })),
  buckets: [...receipt.resources.r2.map(row => ({ name: row.name })), { name: `${plan.worker}-files-old` }],
  queues: receipt.resources.queues.map((row, index) => ({ queue_name: row.name, queue_id: row.id, consumers: index ? [] : [{ consumer_id: '5'.repeat(32), type: 'worker', script_name: plan.worker, settings: plan.queues[0].consumer, dead_letter_queue: plan.queues[0].deadLetterQueue }] })),
  namespaces: [{ id: receipt.durableObjects[0].id, script: plan.worker, class: 'BookingCoordinator', use_sqlite: true }],
 };
 state.queues.push({ queue_name: `${plan.worker}-jobs-old`, queue_id: '6'.repeat(32), consumers: [] });
 const envelope = (result, extra = {}) => Response.json({ success: true, result, ...extra });
 const listing = result => envelope(result, { result_info: { page: 1, total_count: result.length } });
 async function fetch(input, init = {}) {
  const url = new URL(input), method = init.method ?? 'GET';
  if (url.origin === receipt.origin) {
   assert.equal(url.pathname, '/health'); assert.equal(method, 'GET');
   requests.push({ method, path: '/health' });
   return Response.json({ ok: true, deployment: { sourceSha: receipt.source.sha, fingerprint: receipt.fingerprint, versionId: receipt.provider.versionId } });
  }
  assert.equal(url.origin, 'https://api.cloudflare.com');
  const prefix = `/client/v4/accounts/${receipt.accountId}`;
  assert(url.pathname.startsWith(prefix + '/'));
  assert.equal(init.headers.Authorization, 'Bearer synthetic-test-only-provider-token');
  const path = url.pathname.slice(prefix.length);
  requests.push({ method, path: path + url.search });
  const worker = `/workers/scripts/${plan.worker}`;
  if (method === 'POST' && path === `/d1/database/${receipt.resources.d1[0].id}/query`) {
   const { sql } = JSON.parse(init.body);
   assert.match(sql, /^SELECT /i, 'health cannot mutate the owner ledger');
   return envelope([{ success: true, results: db.prepare(sql).all() }]);
  }
  if (method === 'DELETE') {
   const consumer = /^\/queues\/([^/]+)\/consumers\/([^/]+)$/.exec(path);
   if (consumer) {
    const queue = state.queues.find(row => row.queue_id === consumer[1]);
    assert(queue?.consumers.some(row => row.consumer_id === consumer[2]));
    queue.consumers = queue.consumers.filter(row => row.consumer_id !== consumer[2]);
   } else if (path === worker) {
    assert.equal(url.search, '?force=true');
    assert(state.queues.filter(row => receipt.resources.queues.some(owned => owned.id === row.queue_id)).every(row => row.consumers.length === 0));
    state.present = false; state.namespaces = [];
   } else if (path.startsWith('/queues/')) state.queues = state.queues.filter(row => row.queue_id !== path.slice('/queues/'.length));
   else if (path.startsWith('/r2/buckets/')) state.buckets = state.buckets.filter(row => row.name !== path.slice('/r2/buckets/'.length));
   else if (path.startsWith('/d1/database/')) state.databases = state.databases.filter(row => row.uuid !== path.slice('/d1/database/'.length));
   else assert.fail(`unhandled deletion: ${path}`);
   return envelope(null);
  }
  assert.equal(method, 'GET');
  if (path === '/workers/subdomain') return envelope({ subdomain: 'fixture-account' });
  if (path === `${worker}/settings`) return state.present ? envelope({ bindings: state.bindings }) : Response.json({}, { status: 404 });
  if (path === `${worker}/deployments`) return envelope({ deployments: [{ id: receipt.provider.deploymentId, versions: [{ version_id: receipt.provider.versionId, percentage: 100 }] }] });
  if (path === `${worker}/versions/${receipt.provider.versionId}`) return envelope({ id: receipt.provider.versionId, resources: { script: { etag: receipt.provider.etag } } });
  if (path === `${worker}/subdomain`) return envelope({ enabled: true });
  if (path === `${worker}/secrets`) return envelope(state.secrets);
  if (path === `${worker}/schedules`) return envelope({ schedules: plan.crons.map(cron => ({ cron })) });
  if (path === '/workers/durable_objects/namespaces') return listing(state.namespaces);
  if (path === '/d1/database') return listing(state.databases);
  if (path === '/r2/buckets') return envelope({ buckets: state.buckets });
  if (path === '/queues') return listing(state.queues);
  for (const row of state.databases) if (path === `/d1/database/${row.uuid}`) return envelope(row);
  for (const row of state.buckets) if (path === `/r2/buckets/${row.name}`) return envelope(row);
  for (const row of state.queues) {
   if (path === `/queues/${row.queue_id}`) return envelope(row);
   if (path === `/queues/${row.queue_id}/consumers`) return envelope(row.consumers);
  }
  assert.fail(`unhandled provider request: ${path}`);
 }
 return { state, fetch, close: () => db.close() };
}
