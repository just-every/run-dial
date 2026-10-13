import { createApp } from '../../src/core/app/hono.ts';
import { storageControl, storageEdge } from './storage-edge.mjs';
const assets = { fetch: async () => new Response(null, { status: 404 }) };
export default {
  async fetch(envelope, env, context) {
    const { url, bytes, ...init } = await envelope.json();
    const controlled = await storageControl(new URL(url).pathname, init.body ? JSON.parse(init.body) : {});
    if (controlled) return controlled;
    if (bytes) init.body = Uint8Array.from(atob(bytes), char => char.charCodeAt(0));
    const files = storageEdge(env.FILES);
    return createApp().fetch(new Request(url, init), { ...env, FILES: files, ASSETS: assets, JOBS: { async send() { throw new Error('Unexpected queue effect'); } } }, context);
  },
};
