import { CalendarConnectionRepository, CalendarConnectionService } from '../../src/core/features/calendar-connection/index.ts';
import { DeliveryRepository, ProviderDeliveryService } from '../../src/core/features/delivery/index.ts';
import { captureAuthMail, captureMail } from '../mail-capture.ts';
import { OperatorsService } from '../../src/core/features/operators/service.ts';

export default {
  async fetch(envelope, env) {
    // Preserve Host/Origin exactly across Miniflare's HTTP proxy, which rewrites Host.
    // This envelope exists only in the test worker; the real auth guards still run.
    const { url, ...init } = await envelope.json();
    const request = new Request(url, init);
    const service = new OperatorsService(env.DB, env, captureAuthMail(env.DB));
    const path = new URL(request.url).pathname;
    try {
      if (path === '/test/mail-check') {
        const calendar = new CalendarConnectionService(new CalendarConnectionRepository(env.DB), env);
        const delivery = new ProviderDeliveryService(new DeliveryRepository(env.DB, 'development'), calendar, captureMail(env.DB), undefined, env.SESSION_SECRET);
        return Response.json(await delivery.checkMailConnection());
      }
      if (path === '/api/auth/magic-links') return Response.json(await service.requestMagicLink(request, (await request.json()).email));
      if (path === '/test/invite') return Response.json(await service.auth.invite(request, await request.json()));
      if (path === '/test/cancel') return Response.json(await service.auth.cancelInvitation(request, (await request.json()).id));
      if (path === '/test/status') {
        const input = await request.json();
        return Response.json(await service.auth.setOperatorStatus(request, input.id, input.status));
      }
      if (path === '/test/session') return Response.json(await service.authenticate(request) ?? null);
      return service.handle(request);
    } catch (error) {
      if (typeof error.status === 'number' && typeof error.code === 'string') return Response.json({ code: error.code }, { status: error.status });
      throw error;
    }
  },
};
