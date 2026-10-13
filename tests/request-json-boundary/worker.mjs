import { HTTPException } from 'hono/http-exception';
import { createApp } from '../../src/core/app/hono.ts';
import { createServices } from '../../src/core/app/services.ts';
import { defaultEventTypeInput } from '../../src/core/features/event-types/defaults.ts';

let mailCalls = 0;
let queueCalls = 0;
const assets = { fetch: async () => new Response(null, { status: 404 }) };

export default {
  async fetch(envelope, env, context) {
    // Test transport preserves the real request's Host and Origin across the proxy.
    const { url, ...init } = await envelope.json();
    const request = new Request(url, init);
    const services = createServices(env.DB, env, assets, { mail: {
      async send() { mailCalls++; throw new Error('Unexpected mail call'); },
      async checkConnection() { throw new Error('Unexpected mail check'); },
    } });
    const path = new URL(url).pathname;
    if (path === '/__fixture/seed') {
      await services.hostProfile.saveProfile({ name: 'Boundary Host', handle: 'boundary-host', title: 'Host', biography: '', timezone: 'UTC', focusAreas: [], socialProof: [] });
      const event = await services.eventTypes.createEventType({ ...defaultEventTypeInput(), title: 'Boundary event', slug: 'boundary-event' });
      await env.DB.prepare("UPDATE event_types SET status='published',request_only=1 WHERE id=?").bind(event.id).run();
      return Response.json({ id: event.id });
    }
    if (path === '/__fixture/effects') return Response.json({ mailCalls, queueCalls });
    const app = createApp(undefined, () => services);
    app.get('/api/app/__fixture/error/:kind', context => {
      const marker = 'synthetic-private-error-value';
      switch (context.req.param('kind')) {
        case 'syntax': throw new SyntaxError(marker);
        case 'status': throw Object.assign(new Error(marker), { status: 400 });
        case 'http': throw new HTTPException(503, { message: marker, res: new Response(marker) });
        case 'client': throw new HTTPException(400, { message: marker, res: new Response(marker, { headers: { 'x-private': marker } }) });
      }
      throw new Error('Unknown test fault');
    });
    return app.fetch(request, { ...env, ASSETS: assets, JOBS: { async send() { queueCalls++; throw new Error('Unexpected queue call'); } } }, context);
  },
};
