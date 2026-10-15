import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { contract } from './contract.mjs';
import { schemaModel } from '../scripts/archive/schema.mjs';
import { sqliteBinding } from './archive/fixture.mjs';
import { createOperatorAuth, createAuthHandler } from '../modules/operator-auth/index.mjs';
import { ownerSigninDigest } from '../modules/operator-auth/owner-signin-grant.mjs';
import { createArchive } from './archive/artifact.mjs';
import { testPlatform } from './archive/fixture.mjs';

contract('AUTH-006', 'deployment owner grants survive link scanners, admit once, and refuse stale authority', async () => {
 const model = await schemaModel(), db = model.db, origin = 'https://dial.example.test';
 const output = await build({ entryPoints: ['src/core/features/operators/rate-correlation.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
 const { operatorRateCorrelation } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
 const binding = sqliteBinding(db);
 const auth = createOperatorAuth({ db: binding, hooks: { rateCorrelation: operatorRateCorrelation(binding) }, config: { origin, OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: 'synthetic-test-session-secret-at-least-32-characters', SETUP_TOKEN: 'synthetic-test-setup-token-at-least-32-characters' }, clientIp: () => '192.0.2.1' });
 const handle = createAuthHandler(auth);
 const request = (path, init = {}) => new Request(origin + path, { ...init, headers: { host: new URL(origin).host, ...init.headers } });
 const post = token => request('/auth/owner-signin', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
 try {
  const boot = await handle(request('/auth/bootstrap', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'synthetic-test-setup-token-at-least-32-characters', displayName: 'Dial owner' }) }));
  assert.equal(boot.status, 303);
  const owner = db.prepare('SELECT id,version FROM oa_operators').get();
  const mint = async (overrides = {}) => {
   const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
   const grant = { id: crypto.randomUUID(), version: owner.version, expires: Date.now() + 900000, ...overrides };
   db.prepare('INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(grant.id, await ownerSigninDigest(token), owner.id, grant.version, Date.now(), grant.expires);
   return { ...grant, token };
  };
  const grant = await mint(), before = db.prepare('SELECT count(*) AS n FROM oa_sessions').get().n;
  for (const method of ['GET', 'HEAD']) {
   const preview = await handle(request('/auth/owner-signin?token=' + grant.token, { method }));
   assert.equal(preview.status, 200);
   assert.equal(preview.headers.get('set-cookie'), null);
  }
  assert.equal(db.prepare('SELECT consumed_at FROM oa_owner_signins WHERE id=?').get(grant.id).consumed_at, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM oa_sessions').get().n, before);
  const foreign = post(grant.token); foreign.headers.set('origin', 'https://elsewhere.example');
  assert.equal((await handle(foreign)).status, 403);
  const confirmed = await handle(post(grant.token));
  assert.equal(confirmed.status, 303);
  const sessionRequest = request('/auth/session', { headers: { cookie: confirmed.headers.get('set-cookie').split(';')[0] } });
  const session = await (await handle(sessionRequest)).json();
  assert.equal(session.operator.id, owner.id); assert.equal(session.kind, 'native');
  assert.ok(db.prepare('SELECT consumed_at FROM oa_owner_signins WHERE id=?').get(grant.id).consumed_at);
  assert.equal(db.prepare("SELECT actor_id FROM oa_auth_audit WHERE action='owner:signin-link' AND value=?").get(grant.id).actor_id, owner.id);
  assert.ok(db.prepare('SELECT consumed_at FROM oa_step_up_challenges WHERE session_id=?').get(session.id).consumed_at);
  assert.ok(db.prepare("SELECT count(*) AS n FROM rer_erasure_rates r JOIN oa_limits l ON l.key=r.rate_key WHERE r.entity='operator' AND r.subject=? AND r.rate_table='oa_limits'").get(owner.id).n > 0, 'owner grant confirmation counters remain attributable for operator erasure');
  assert.equal((await handle(post(grant.token))).status, 400);
  assert.equal((await handle(request('/auth/owner-signin?token=' + grant.token))).status, 400);
  db.prepare('UPDATE oa_operators SET display_name=? WHERE id=?').run('Owner /auth/owner-signin?token=' + grant.token, owner.id);
  const archive = await createArchive(testPlatform(db));
  assert.ok(!archive.tables.some(table => table.name === 'oa_owner_signins'));
  assert.ok(!JSON.stringify(archive).includes(grant.token));
  assert.ok(!archive.tables.some(table => table.name === 'oa_auth_audit'));
  for (const overrides of [{ expires: Date.now() - 1 }, { expires: Date.now() + 1800000 }, { version: owner.version + 1 }]) {
   const stale = await mint(overrides);
   assert.equal((await handle(post(stale.token))).status, 400);
  }
  const inactive = await mint();
  db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('second-owner','other@example.test','Other owner','owner','active',?)").run(Date.now());
  db.prepare("UPDATE oa_operators SET status='inactive' WHERE id=?").run(owner.id);
  assert.equal((await handle(post(inactive.token))).status, 400);
 } finally { db.close(); }
});
