import type { AppServices } from "../../src/core/app/services";
import type { AppBindings } from "../../src/core/app/bindings";

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
