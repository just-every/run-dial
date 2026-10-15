import { createApp } from '../../src/core/app/hono.ts';
import { createServices } from '../../src/core/app/services.ts';
import { defaultEventTypeInput } from '../../src/core/features/event-types/defaults.ts';
import { DeliveryRepository } from '../../src/core/features/delivery/repository.ts';
import { admitMailSource } from '../mail-source.mjs';
export { BookingCoordinator } from '../../src/core/app/booking-coordinator.ts';

const assets = { fetch: async () => new Response(null, { status: 404 }) };
export default {
  async fetch(envelope, env, context) {
    const { url, ...init } = await envelope.json();
    const request = new Request(url, init);
    const services = createServices(env.DB, env, assets);
    const path = new URL(url).pathname;
    if (path === '/__fixture/process') {
      const { outboxId, now } = await request.json();
      return Response.json({ result: await services.delivery.process({ outboxId }, new Date(now)) });
    }
    if (path === '/__fixture/seed') {
      await services.hostProfile.saveProfile({ name: 'Mail Host', handle: 'mail-host', title: 'Host', biography: '', timezone: 'UTC', focusAreas: [], socialProof: [] });
      const event = await services.eventTypes.createEventType({ ...defaultEventTypeInput(), title: 'Conversation', slug: 'conversation', locationType: 'phone', locationValue: '+15555550123', availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] });
      return Response.json(event);
    }
    if (path === '/__fixture/mail') {
      const message = await request.json();
      await admitMailSource(env.DB, new DeliveryRepository(env.DB, 'sendgrid'), message);
      await env.DB.prepare("INSERT INTO base_mail_dispatch VALUES(?,?,'accepted',NULL,?)").bind(message.idempotencyKey, 'fixture-fingerprint', new Date().toISOString()).run();
      return new Response(null, { status: 204 });
    }
    const app = createApp(undefined, () => services);
    return app.fetch(request, { ...env, ASSETS: assets, JOBS: { async send() {} } }, context);
  },
};
