import type { AppServices } from "../../src/core/app/services";
import type { AppBindings } from "../../src/core/app/bindings";

/** Only the clock and Queue transport are controlled; invoke the Worker's real exports. */
export async function pollReminderCron(request: Request, env: AppBindings, worker: {
  scheduled(controller: ScheduledController, env: AppBindings): Promise<void>;
  queue(batch: MessageBatch<unknown>, env: AppBindings): Promise<void>;
}) {
  const { now } = await request.json<{now:string}>();
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) return new Response(null,{status:400});
  const WallDate = Date;
  const jobs: unknown[] = [];
  const bindings = { ...env, JOBS: {
    async send(body: unknown) { jobs.push(body); },
    async sendBatch(messages: MessageSendRequest[]) { jobs.push(...messages.map(message => message.body)); },
  } as Queue };
  let acknowledged = 0;
  try {
    globalThis.Date = class extends WallDate {
      constructor(value?: string | number) { super(value === undefined ? timestamp : value); }
      static now() { return timestamp; }
    } as DateConstructor;
    await worker.scheduled({ scheduledTime:timestamp,cron:"* * * * *",noRetry() {} },bindings);
    // Deliver every message the producer actually dispatched, without selecting outbox rows here.
    for (let index = 0; index < jobs.length; index += 10) {
      await worker.queue({ queue:"dial-booking-wire-jobs", messages:jobs.slice(index,index+10).map((body,offset) => ({
        id:String(index+offset),timestamp:new Date(),body,attempts:1,
        ack() { acknowledged += 1; }, retry() { throw new Error("Unexpected Queue retry"); },
      })), ackAll() { throw new Error("Unexpected batch acknowledgment"); }, retryAll() { throw new Error("Unexpected batch retry"); } },bindings);
    }
    return Response.json({ enqueued:jobs.length,acknowledged });
  } finally { globalThis.Date = WallDate; }
}

export async function pollReminderFixture(request: Request, env: AppBindings, services: AppServices) {
  const { action, now, id } = await request.json<{action:string;now:string;id?:string}>();
  const clock = new Date(now);
  if (!Number.isFinite(clock.getTime())) return new Response(null,{status:400});
  if (action === "sweep") return Response.json(await services.polls.repository.reminders.sweep(clock));
  if (action === "deliver") return Response.json(await services.delivery.processDue(100,clock));
  if (action === "expire") {
    await env.DB.prepare("UPDATE meeting_polls SET closes_at=? WHERE id=?").bind(now,id).run();
    return Response.json({expired:true});
  }
  if (action === "restore-closed") {
    await env.DB.batch([
      env.DB.prepare("UPDATE meeting_polls SET state='closed' WHERE id=?").bind(id),
      env.DB.prepare("DELETE FROM poll_vote_tokens WHERE participant_id IN(SELECT id FROM poll_participants WHERE poll_id=?)").bind(id),
      env.DB.prepare("UPDATE delivery_outbox SET state='failed',payload_json=json_set(payload_json,'$.archiveHistorical',json('true')) WHERE json_extract(payload_json,'$.pollId')=?").bind(id),
    ]);
    return Response.json({restored:true});
  }
  return new Response(null,{status:404});
}
