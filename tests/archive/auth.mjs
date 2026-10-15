import { build } from 'esbuild';
import { createD1DevelopmentOutbox } from '../../modules/mail/src/development/index.mjs';

export const runtime = {
  ENVIRONMENT: 'development', APP_URL: 'http://127.0.0.1:8787', OWNER_EMAIL: 'second@example.test',
  SESSION_SECRET: 'restored-session-secret-at-least-32-characters',
  SETUP_TOKEN: 'restored-setup-token-at-least-32-characters',
  MAIL_PROVIDER: 'development', MAIL_FROM: 'mail@example.test',
};
export function request(path, body, cookie) {
  return new Request(runtime.APP_URL + path, {
    method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { host: '127.0.0.1:8787', origin: runtime.APP_URL, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export async function operators(binding) {
  const compiled = await build({ entryPoints: [new URL('../../src/core/features/operators/service.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' });
  const { OperatorsService } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  return new OperatorsService(binding, runtime, { async send(message) {
    await createD1DevelopmentOutbox({ db: binding }).put(message);
    return { status: 'accepted', provider: 'test', providerMessageId: `test-${message.deliveryId}` };
  } });
}
export async function captures(binding) { return createD1DevelopmentOutbox({ db: binding }).list(); }
export function token(message) { return new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'); }
