import { createApp } from '../../src/core/app/hono.ts';
import { defaultEventTypeInput } from '../../src/core/features/event-types/defaults.ts';
import { createServices } from '../../src/core/app/services.ts';
import { parseRuntimeEnvironment } from '../../src/core/shared/runtime-env.ts';
import { captureMail } from '../mail-capture.ts';
const app = createApp(undefined, env => createServices(env.DB, parseRuntimeEnvironment(env), env.ASSETS, { mail: captureMail(env.DB) }));
app.get('/api/app/__fixture/defaults', context => context.json(defaultEventTypeInput()));
export default { async fetch(envelope, env, context) {
  const { url, ...init } = await envelope.json();
  return app.fetch(new Request(url, init), { ...env,
    ASSETS: { fetch: async () => new Response('Document renderer reached') },
    JOBS: { send: async () => {} },
  }, context);
} };
