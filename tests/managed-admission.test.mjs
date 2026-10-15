import { contract } from './contract.mjs';
import assert from 'node:assert/strict';
import { admissionRuntime, sessionCookie, setupToken } from './managed-admission/runtime.mjs';

contract('AUTH-006', 'signed admission verifies before authority writes, commits one native owner, and stays consumed after restart and retirement', async t => {
  const app = await admissionRuntime(); t.after(() => app.close());
  assert.equal((await app.call('/auth/bootstrap', { token: setupToken })).status, 403);
  const empty = await app.state();
  const assertEmpty = async () => assert.deepEqual(await app.state(), empty, 'a refused claim changes no native or product rows');
  const now = Math.floor(Date.now() / 1000);
  const signed = app.token().split('.');
  const damagedSignature = Buffer.from(signed[2], 'base64url'); damagedSignature[0] ^= 1;
  const invalid = [signed.slice(0, 2).join('.') + '.' + damagedSignature.toString('base64url'),
    app.token({ email: 'other@dial.test' }), app.token({ aud: 'https://elsewhere.invalid' }), app.token({ iss: 'https://elsewhere.invalid' }),
    app.token({ installationId: 'another-installation' }), app.token({ iat: now - 120, exp: now - 1 }),
    app.token({ iat: now + 120, exp: now + 180 }), app.token({}, { kid: 'unknown' }), app.token({}, { alg: 'none' }),
    app.token().replace(/.$/, '='), 'malformed',
  ];
  for (const token of invalid) { assert.equal((await app.call('/auth/owner-claim', { token })).status, 403); await assertEmpty(); }
  assert.equal((await app.call('/auth/owner-claim', { token: app.token() }, { origin: 'https://elsewhere.invalid' })).status, 403); await assertEmpty();
  assert.equal((await app.call('/auth/owner-claim?token=forbidden')).status, 400); await assertEmpty();
  await app.control('fail-session');
  assert.equal((await app.call('/auth/owner-claim', { token: app.token(), returnTo: '/app' })).status, 409); await assertEmpty();
  await app.control('allow-session');
  const token = app.token();
  const results = await Promise.all([token, app.token()].map(token => app.call('/auth/owner-claim', { token, returnTo: '/app' })));
  assert.deepEqual(results.map(r => r.status).sort(), [303, 409]);
  const cookie = sessionCookie(results.find(r => r.status === 303));
  const state = await app.state();
  const { oa_limits: limitRows, ...identityCounts } = state.counts;
  assert.deepEqual(identityCounts, { oa_operators: 1, oa_bootstrap: 1, oa_sessions: 1, oc_owner_claims: 1, operators: 1, operator_setup_identity: 1 });
  assert.equal(limitRows, state.limits.length);
  assert.ok(state.limits.length > 0 && state.limits.every(count => count === 1), 'the concurrent loser rolls back every rate counter');
  assert.equal((await app.call('/auth/session', undefined, { cookie })).status, 200);
  assert.equal((await app.call('/api/app/operators', undefined, { cookie })).status, 200);
  const editor = await app.call('/api/editor/config', undefined, { cookie });
  assert.equal(editor.status, 200); assert.match(editor.headers.get('cache-control'), /no-store, private/);
  const grant = await editor.json(); assert.ok(Number.isFinite(grant.expiresAt) && grant.expiresAt > Date.now());
  assert.equal((await app.call('/api/editor/config')).status, 403);
  const afterReads = await app.state();
  assert.equal((await app.call('/auth/owner-claim', { token })).status, 409); assert.deepEqual(await app.state(), afterReads);
  await app.restart();
  assert.equal((await app.call('/auth/session', undefined, { cookie })).status, 200);
  assert.equal((await app.call('/auth/owner-claim', { token: app.token() })).status, 409);
  const afterRestart = await app.state();
  assert.deepEqual(afterRestart.counts.oc_owner_claims, 1);
  assert.deepEqual(afterRestart.counts.oa_sessions, 1);
  assert.deepEqual(afterRestart.limits, state.limits);
  await app.control('retire-owner');
  const retired = await app.state();
  assert.equal((await app.call('/auth/owner-claim', { token: app.token() })).status, 409);
  assert.deepEqual(await app.state(), retired, 'permanent claim ledger refuses reinitialization after owner records are retired');
});

contract('AUTH-006', 'local CLI setup token remains a native session path without hosted claim bindings', async t => {
  const app = await admissionRuntime({ managed: false }); t.after(() => app.close());
  assert.equal((await app.call('/auth/owner-claim')).status, 404);
  const setup = { token: setupToken, displayName: 'Dial Owner', returnTo: '/app' };
  const response = await app.call('/auth/bootstrap', setup);
  assert.equal(response.status, 303);
  assert.equal((await app.call('/auth/session', undefined, { cookie: sessionCookie(response) })).status, 200);
  assert.equal((await app.call('/auth/bootstrap', setup)).status, 409);
});
