import type { AppServices } from "../../src/core/app/services";
import type { AppBindings } from "../../src/core/app/bindings";
import { consumeJobs, runScheduledWork } from "../../src/core/app/background-work";
import { isWebhookJob } from "../../src/core/features/webhooks/delivery";

/** Advance only the injected delivery clock; never rewrite a production retry timestamp. */
export async function webhookFixtures(request: Request, services: AppServices, env: AppBindings) {
  const url = new URL(request.url);
  if (!["/__fixtures/webhooks/process", "/__fixtures/webhooks/scheduled", "/__fixtures/workflow-crm/process"].includes(url.pathname)) return undefined;
  const { now, id } = await request.json<{ now?: string; id?: string }>();
  const clock = now ? new Date(now) : new Date();
  const bodies: unknown[] = [], results: string[] = [];
  const queue: Queue = {
    async send(body) { bodies.push(body); },
    async sendBatch(messages) { bodies.push(...messages.map(message => message.body)); },
  };
  // Supply only a clock at the boundary; use the production producer, scheduler
  // and queue consumer rather than a test implementation of their decisions.
  const enqueue = services.webhooks.delivery.enqueue.bind(services.webhooks.delivery);
  const process = services.webhooks.delivery.process.bind(services.webhooks.delivery);
  services.webhooks.delivery.enqueue = queue => enqueue(queue, clock);
  services.webhooks.delivery.process = async value => { const result = await process(value, clock); results.push(result); return result; };
  if (url.pathname.endsWith("/scheduled")) await runScheduledWork({ ...env, JOBS: queue }, services);
  else if(url.pathname.includes("workflow-crm"))await services.workflowCrm.delivery.enqueueDue(queue);
  else if (id) await queue.send({ channel: "webhook", deliveryId: id });
  else await services.webhooks.delivery.enqueue(queue);
  const messages = bodies.filter(body=>isWebhookJob(body)||Boolean(body&&typeof body==="object"&&"channel" in body&&body.channel==="workflow-crm")).map((body, index) => ({ id: String(index), body, timestamp: clock, attempts: 1, ack() {}, retry() { throw new Error("Unexpected webhook queue retry"); } }));
  await consumeJobs({ queue: "synthetic-dial-queue", messages, ackAll() {}, retryAll() { throw new Error("Unexpected webhook batch retry"); } }, env, services);
  return Response.json({ results });
}
