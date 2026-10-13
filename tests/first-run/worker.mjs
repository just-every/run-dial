import { createApp } from '../../src/core/app/hono.ts';
import { defaultEventTypeInput } from '../../src/core/features/event-types/defaults.ts';
const app = createApp();
app.get('/api/app/__fixture/defaults', context => context.json(defaultEventTypeInput()));
export default { async fetch(envelope, env, context) {
  const { url, ...init } = await envelope.json();
  return app.fetch(new Request(url, init), { ...env,
    ASSETS: { fetch: async () => new Response('Document renderer reached') },
    JOBS: { send: async () => {} },
  }, context);
} };
