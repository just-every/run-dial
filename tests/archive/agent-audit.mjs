import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { captures, operators, runtime, request, token } from './auth.mjs';

// Produce audit facts through the installed native door and an owner's policy,
// rather than manufacturing audit rows or changing the archive service's policy.
export async function agentUse(binding) {
  const compiled = await build({ stdin: {
    contents: `export { createServices } from './src/core/app/services.ts'; export { dialAgentDoor } from './src/agent-door/index.server.ts'; export { autonomousPolicy } from './modules/agent-door/conformance/crypto.mjs';`,
    resolveDir: process.cwd(), loader: 'ts',
  }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const { createServices, dialAgentDoor, autonomousPolicy } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text + "\n//# sourceURL=dial-archive-agent-fixture\n").toString('base64')}`);
  const services = createServices(binding, runtime, {});
  const auth = await operators(binding);
  await auth.requestMagicLink(request('/api/auth/magic-links', {}), 'owner@example.test');
  const mail = (await captures(binding)).find(row => row.message.to.includes('owner@example.test')).message;
  const signedIn = await auth.handle(request('/auth/confirm', { token: token(mail) }));
  assert.equal(signedIn.status, 303);
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];
  const { door } = dialAgentDoor({ DB: binding }, runtime, services);
  const policy = await door.handle(new Request(runtime.APP_URL + '/agents/api/policy', {
    method: 'PUT', headers: { host: '127.0.0.1:8787', origin: runtime.APP_URL, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ document: autonomousPolicy() }),
  }));
  assert.equal(policy.status, 200, await policy.text());
  const who = { person: { id: 'owner' }, agent: { id: 'synthetic-dial-1', name: 'Scheduling coordinator', specialist: 'scheduling' }, scopes: ['dial:read'], clientId: 'synthetic-dial-2' };
  for (let index = 0; index < 16; index++) {
    const result = await door.invoke('dial.profile.get', {}, who);
    assert.equal(result.outcome, 'done', JSON.stringify(result));
  }
  return (await binding.prepare('SELECT * FROM agent_door_audit ORDER BY sequence').all()).results.map(row => ({ ...row }));
}
