import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main as deploy } from '../../scripts/deploy.mjs';
import { hash } from '../../modules/deploy-kit/validation.mjs';
import { renderConfig, bindingsFor } from '../../modules/deploy-kit/render.mjs';
import { providerEdge } from './provider-edge.mjs';

// A retained deployment receipt and provider responses are the network boundary.
// Every plan, health, inventory and teardown operation uses the product CLI.
export async function installation(t, { interrupted = false } = {}) {
 const root = await realpath(await mkdtemp(join(tmpdir(), 'dial-deployment-')));
 t.after(() => rm(root, { recursive: true, force: true }));
 const code = 'export default {};';
 const artifact = { version: 1, source: { sha: 'a'.repeat(40), tree: 'b'.repeat(40) }, run: { id: '130', attempt: '1' }, main: 'index.js', modules: [{ path: 'index.js', base64: Buffer.from(code).toString('base64'), sha256: hash(code) }], assets: [], migrations: [] };
 const prefix = 'rer-seedproof-dial', origin = `https://${prefix}.fixture-account.workers.dev`;
 const env = { RER_DIAL_SETUP: join(root, 'setup.json'), RER_DEPLOY_ARTIFACT: join(root, 'artifact.json'), RER_DEPLOY_PLAN: join(root, 'plan.json'), RER_DEPLOY_RECEIPT: join(root, 'receipt.json'), RER_DEPLOY_SOURCE_SHA: artifact.source.sha, RER_DEPLOY_RUN_ID: artifact.run.id, RER_DEPLOY_RUN_ATTEMPT: artifact.run.attempt, RER_DEPLOY_ARTIFACT_SHA256: hash(JSON.stringify(artifact)), CF_THROWAWAY_ACCOUNT_ID: '1'.repeat(32), CF_THROWAWAY_API_TOKEN: 'synthetic-test-only-provider-token' };
 await writeFile(env.RER_DIAL_SETUP, JSON.stringify({ version: 1, ownerEmail: 'owner@fixture.test', prefix, target: origin, mailProvider: 'sendgrid', mailFrom: 'no-reply@fixture.test' }));
 await writeFile(env.RER_DEPLOY_ARTIFACT, JSON.stringify(artifact));
 const requests = [], original = globalThis.fetch;
 globalThis.fetch = async () => { throw Error('planning-must-not-contact-provider'); };
 t.after(() => { globalThis.fetch = original; });
 const planned = await deploy(['plan'], env);
 const bytes = await readFile(env.RER_DEPLOY_PLAN), plan = JSON.parse(bytes);
 env.RER_DEPLOY_PLAN_SHA256 = hash(bytes);
 const resources = { d1: [{ binding: 'DB', name: `${prefix}-db`, id: '11111111-1111-4111-8111-111111111111' }], r2: [{ binding: 'FILES', name: `${prefix}-files` }], queues: [{ binding: 'JOBS', name: `${prefix}-jobs`, id: '2'.repeat(32) }, { binding: 'JOBS_DEAD', name: `${prefix}-jobs-dead`, id: '3'.repeat(32) }] };
 const config = renderConfig(plan, resources, env.CF_THROWAWAY_ACCOUNT_ID, artifact.source.sha, 'synthetic-fingerprint', 'index.js');
 const receipt = { version: 1, accountId: env.CF_THROWAWAY_ACCOUNT_ID, worker: prefix, origin, source: artifact.source, run: artifact.run, artifactSha256: env.RER_DEPLOY_ARTIFACT_SHA256, resources, durableObjects: [{ ...plan.durableObjects[0], id: '4'.repeat(32) }], provider: { versionId: '22222222-2222-4222-8222-222222222222', deploymentId: '33333333-3333-4333-8333-333333333333', etag: 'synthetic-etag' }, fingerprint: 'synthetic-fingerprint', config, configSha256: hash(config) };
 if (interrupted) { await rm(env.RER_DEPLOY_PLAN); delete env.RER_DEPLOY_PLAN; delete env.RER_DEPLOY_RECEIPT; }
 else await writeFile(env.RER_DEPLOY_RECEIPT, JSON.stringify(receipt), { mode: 0o600 });
 const edge = providerEdge({ receipt, plan, bindings: bindingsFor(config, resources, plan), requests, interrupted });
 globalThis.fetch = edge.fetch;
 t.after(() => edge.close());
 return { env, plan, planned, receipt, requests, ...edge };
}
