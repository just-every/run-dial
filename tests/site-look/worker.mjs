import { createApp } from '../../src/core/app/hono.ts';
const assets = { fetch: async () => new Response(null, { status: 404 }) };
export default {
  async fetch(envelope, env, context) {
    const { url, ...init } = await envelope.json();
    return createApp().fetch(new Request(url, init), { ...env, ASSETS: assets, JOBS: { async send() { throw new Error('Unexpected queue effect'); } } }, context);
  },
};
