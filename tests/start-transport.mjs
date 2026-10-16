import { createRequire } from 'node:module';

// Use the installed Start transport's serializer, including its GET envelope.
const start = createRequire(import.meta.resolve('@tanstack/react-start'));
const { toJSONAsync } = createRequire(start.resolve('@tanstack/start-client-core/package.json'))('seroval');

export async function privateShellEndpoint(path, origin) {
  const endpoint = new URL(path, origin);
  endpoint.searchParams.set('payload', JSON.stringify(await toJSONAsync({ data: { path: '/app' } })));
  return endpoint;
}
