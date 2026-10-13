import { headerFixture } from '../erasure/header-fixture';
import worker from '../booking-wire/worker';
export { BookingCoordinator } from '../booking-wire/worker';
import { createServices } from '../../src/core/app/services';
import { parseRuntimeEnvironment } from '../../src/core/shared/runtime-env';
import { GoogleCalendarAdapter } from '../../src/core/platform/calendar/google';
import type { AppBindings } from '../../src/core/app/bindings';
import { wireTransport } from '../booking-wire/transport';

type HeldDelivery = { held: boolean; release: () => void; delivery: Promise<string> };
const deliveries = new Map<string, HeldDelivery>();
let queueCalls = 0;

export default {
  async fetch(request: Request, env: AppBindings & { PROVIDER_DB?: D1Database }, ctx: ExecutionContext) {
    const url = new URL(request.url), path = url.pathname;
    if (path === '/__fixtures/import-header' && request.method === 'POST') {
      const { email } = await request.json<{ email: string }>();
      return Response.json(await headerFixture(env.DB, email));
    }
    if (path === '/__edge/start') {
      const { id, outboxId, point, responseStatus } = await request.json<{ id: string; outboxId: string; point: 'upsert' | 'lookup'; responseStatus?: number }>();
      if (deliveries.has(id)) throw new Error('Duplicate held delivery');
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const held: HeldDelivery = { held: false, release, delivery: Promise.resolve('not_started') };
      const wire = wireTransport(env.PROVIDER_DB ?? env.DB);
      const transport: typeof fetch = async (input, init) => {
        const providerUrl = new URL(String(input)), method = init?.method ?? 'GET';
        const upsert = point === 'upsert' && providerUrl.pathname.endsWith('/events') && method === 'POST';
        const lookup = point === 'lookup' && providerUrl.pathname.endsWith('/events') && method === 'GET' && providerUrl.searchParams.has('privateExtendedProperty');
        if (upsert) { held.held = true; await gate; }
        // Keep the already-read provider snapshot while other native deliveries run.
        const result = await wire(input, init);
        if (lookup) {
          held.held = true;
          await gate;
          if (responseStatus) return Response.json({ error: { code: responseStatus, message: 'Private provider diagnostic' } }, { status: responseStatus });
        }
        return result;
      };
      // Simulate an interrupted coordinator's still-live request only at the paid edge.
      const services = createServices(env.DB, parseRuntimeEnvironment(env), env.ASSETS, {
        calendar: new GoogleCalendarAdapter({ clientId: 'wire-client', clientSecret: 'wire-secret' }, transport),
      });
      held.delivery = services.delivery.processUnknown({ outboxId });
      deliveries.set(id, held);
      ctx.waitUntil(held.delivery);
      return Response.json({ started: true });
    }
    if (path === '/__edge/status') return Response.json({ held: deliveries.get(url.searchParams.get('id')!)?.held ?? false });
    if (path === '/__edge/release') {
      const { id } = await request.json<{ id: string }>(), held = deliveries.get(id);
      if (!held) throw new Error('Unknown held delivery');
      held.release();
      return Response.json({ result: await held.delivery });
    }
    if (path === '/__edge/close') {
      for (const held of deliveries.values()) held.release();
      await Promise.allSettled([...deliveries.values()].map(held => held.delivery));
      return Response.json({ closed: true });
    }
    if (path === '/__queue-count') return Response.json({ queueCalls });
    return worker.fetch(request, { ...env, JOBS: { ...env.JOBS, send: async (...args: Parameters<typeof env.JOBS.send>) => { queueCalls++; return env.JOBS.send(...args); } } }, ctx);
  },
};
