/** Faults at Google's HTTP edge; production adapters and delivery remain unchanged. */
export async function googleDuplicateEdge(db: D1Database, application: D1Database, url: URL, init: RequestInit) {
  const id = /\/events\/([^/]+)$/.exec(url.pathname)?.[1];
  if (!id) return;
  const row = await db.prepare("SELECT payload FROM wire_events WHERE id=?").bind(id).first<{ payload: string }>();
  if (!row) return;
  const event = JSON.parse(row.payload);
  const headers = new Headers(init.headers), method = init.method ?? "GET";
  if (method === "GET") {
    const control = await db.prepare("SELECT value FROM wire_controls WHERE name=?").bind(`google-recovery-read:${id}`).first<{ value: string }>();
    if (control?.value) {
      await db.prepare("DELETE FROM wire_controls WHERE name=?").bind(`google-recovery-read:${id}`).run();
      if (control.value === "facts") {
        event.summary = "Changed outside Dial";
        event.etag = '"synthetic-dial-changed"';
        await db.prepare("UPDATE wire_events SET payload=? WHERE id=?").bind(JSON.stringify(event), id).run();
      } else {
        const key = event.extendedProperties.private["dial-idempotency-key"];
        if (control.value === "archive") await application.prepare("UPDATE delivery_outbox SET payload_json=json_set(payload_json,'$.archiveHistorical',1) WHERE idempotency_key=?").bind(key).run();
        if (control.value === "supersede") await application.prepare(`INSERT INTO delivery_outbox
          (id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at)
          SELECT id || '-new',kind,idempotency_key || ':new',booking_id,occurrence_id,payload_json,'pending',0,next_attempt_at,'2999-01-01T00:00:00.000Z',updated_at
          FROM delivery_outbox WHERE idempotency_key=?`).bind(key).run();
        if (control.value === "claim") await application.prepare("UPDATE delivery_outbox SET attempts=attempts+1 WHERE idempotency_key=?").bind(key).run();
      }
    }
    if (headers.has("if-match") && headers.get("if-match") !== event.etag) return Response.json({}, { status: 412 });
    return Response.json(event);
  }
  if (method !== "DELETE") return;
  const conflict = await db.prepare("SELECT value FROM wire_controls WHERE name=?").bind(`google-recovery-delete-conflict:${id}`).first();
  if (conflict?.value || headers.get("if-match") !== event.etag) return Response.json({}, { status: 412 });
  await db.prepare("UPDATE wire_events SET payload=json_set(payload,'$.status','cancelled') WHERE id=?").bind(id).run();
  const lost = await db.prepare("SELECT value FROM wire_controls WHERE name=?").bind(`google-recovery-delete-lost:${id}`).first();
  if (lost?.value) {
    await db.prepare("DELETE FROM wire_controls WHERE name=?").bind(`google-recovery-delete-lost:${id}`).run();
    throw new Error("Google removed the duplicate before its response was lost");
  }
  const unverifiable = await db.prepare("SELECT value FROM wire_controls WHERE name=?").bind(`google-recovery-verify:${id}`).first();
  if (unverifiable?.value) await db.prepare("INSERT OR REPLACE INTO wire_controls VALUES(?,?)").bind(`google-list-mode:${event.extendedProperties.private["dial-booking-id"]}`, "paginated").run();
  return new Response(null, { status: 204 });
}
