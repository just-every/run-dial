import type { AppServices } from "../../src/core/app/services";

/** Advance only the injected delivery clock; never rewrite a production retry timestamp. */
export async function webhookFixtures(request: Request, services: AppServices) {
  const url = new URL(request.url);
  if (url.pathname !== "/__fixtures/webhooks/process") return undefined;
  const { now, id } = await request.json<{ now?: string; id?: string }>();
  const clock = now ? new Date(now) : new Date();
  const ids = id ? [id] : await services.webhooks.delivery.due(clock);
  return Response.json({ results: await Promise.all(ids.map(value => services.webhooks.delivery.process(value, clock))) });
}
