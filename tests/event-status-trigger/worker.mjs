import { createApp } from '../../src/core/app/hono.ts';
import { EventTypesRepository } from '../../src/core/features/event-types/repository.ts';
import { defaultEventTypeInput } from '../../src/core/features/event-types/defaults.ts';

const app = createApp();
app.get('/api/app/__fixture/defaults', context => context.json(defaultEventTypeInput()));
app.post('/api/app/__fixture/status', async context => {
  const { id, status } = await context.req.json();
  const record = await new EventTypesRepository(context.env.DB).setStatus(id, status);
  return context.json(record ?? null);
});

export default {
  async fetch(envelope, env, context) {
    // Only the test transport unwraps requests; production Hono and native auth run unchanged.
    const { url, ...init } = await envelope.json();
    return app.fetch(new Request(url, init), {
      ...env,
      ASSETS: { fetch() { throw new Error('Unexpected document request'); } },
      JOBS: { send() { throw new Error('Unexpected queued delivery'); } },
    }, context);
  },
};
