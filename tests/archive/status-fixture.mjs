import assert from 'node:assert/strict';
import { createOperatorAuth, createAuthHandler } from '../../modules/operator-auth/index.mjs';
import { schemaModel } from '../../scripts/archive/schema.mjs';
import { sqliteBinding } from './fixture.mjs';
import { hostedRoute } from './hosted-route.mjs';

export async function statusFixture(origin = 'http://127.0.0.1:15491') {
 const model = await schemaModel(), db = sqliteBinding(model.db);
 const env = { DB: db, APP_URL: origin, SESSION_SECRET: 'synthetic-status-session-secret-at-least-32', SETUP_TOKEN: 'synthetic-status-bootstrap-token-at-least-32', OWNER_EMAIL: 'owner@example.test',
  FILES: { async list() { throw Error('Status must not read files'); }, async get() { throw Error('Status must not read files'); } } };
 const auth = createOperatorAuth({ db, config: { ...env, origin, local: true, review: { enabled: true, operatorEmail: env.OWNER_EMAIL } }, clientIp: () => '127.0.0.1' });
 const bootstrap = await createAuthHandler(auth)(new Request(origin + '/auth/bootstrap', { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'application/json' }, body: JSON.stringify({ token: env.SETUP_TOKEN, displayName: 'Owner' }) }));
 assert.equal(bootstrap.status, 303);
 const cookie = bootstrap.headers.get('set-cookie').split(';')[0], hostedExport = await hostedRoute(model);
 return { ...model, cookie, origin, handle: request => hostedExport(request, env, { auth }),
  request(path = '/api/portability/status', init = {}) { return new Request(origin + path, { ...init, headers: { host: new URL(origin).host, cookie, ...init.headers } }); },
  writer() { const id = crypto.randomUUID(); model.db.prepare("INSERT INTO dial_portability_admission VALUES(?,'writer',NULL)").run(id); return id; },
  exportLease(expires = Date.now() + 60_000) { const id = crypto.randomUUID(); model.db.prepare("INSERT INTO dial_portability_admission VALUES(?,'export',?)").run(id, expires); return id; },
 };
}
