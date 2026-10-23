import { isNoticeHost,noticeWire } from './notice-wire';
import { accountingHosts, accountingWire } from "./accounting-wire";
import { initializeStripeWire, stripeHosts, stripeWire } from "./stripe-wire";
/** Contract-shaped provider wire fixtures; production Google and Base mail adapters consume these. */
export function wireTransport(db: D1Database): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? "GET";
    if(isNoticeHost(url.hostname))return noticeWire(db,url,init);
    if (url.hostname === "oauth2.googleapis.com") return googleToken(db, url, method, String(init.body ?? ""));
    if (accountingHosts.includes(url.hostname)) return accountingWire(db,url,method,init);
    if (stripeHosts.includes(url.hostname)) return stripeWire(db, url, method, init);
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    await db.prepare("INSERT INTO wire_calls(url,method,body,headers) VALUES(?,?,?,?)").bind(url.toString(), method, body ? JSON.stringify(body) : null, JSON.stringify(Object.fromEntries(new Headers(init.headers)))).run();
    if (new Headers(init.headers).get("authorization") !== `Bearer ${url.hostname === "api.sendgrid.com" ? "wire-mail-key" : "synthetic-access"}`) throw new Error("Unexpected authorization");
    if (url.hostname === "api.sendgrid.com") {
      if (url.pathname === "/v3/verified_senders") {
        const control = await db.prepare("SELECT value FROM wire_controls WHERE name='mail-health-failure'").first();
        return control?.value ? Response.json({ errors: [{ message: "Permission denied" }] }, { status: 403 }) : Response.json({ results: [{ from_email: "no-reply@dial.test", verified: true }] });
      }
      if (url.pathname === "/v3/mail/send" && method === "POST") {
        // One definite throttle for a named recipient: production records it as transient and retries on a later pass.
        const recipients = ((body?.personalizations ?? []) as Array<{ to: Array<{ email: string }> }>).flatMap(item => item.to.map(to => to.email));
        for (const email of recipients) {
          const throttle = `mail-rate-limited:${email}`;
          if (await db.prepare("SELECT value FROM wire_controls WHERE name=? AND value").bind(throttle).first()) {
            await db.prepare("DELETE FROM wire_controls WHERE name=?").bind(throttle).run();
            return Response.json({ errors: [{ message: "Too many requests" }] }, { status: 429 });
          }
        }
        const rejected = await db.prepare("SELECT value FROM wire_controls WHERE name='mail-rejected'").first();
        if (rejected?.value) {
          await db.prepare("DELETE FROM wire_controls WHERE name='mail-rejected'").run();
          // The legacy plain-mail regression uses one real HTTP rejection to exercise production freeze and explicit retry.
          return Response.json({ errors: [{ message: "The sender was rejected for this delivery." }] }, { status: 403 });
        }
        const control = await db.prepare("SELECT value FROM wire_controls WHERE name='mail-ambiguous'").first();
        if (control?.value) throw new Error("Wire acceptance followed by response loss");
        return new Response(null, { status: 202 }); // SendGrid may accept without a receipt ID.
      }
      throw new Error("Unexpected SendGrid request");
    }
    if (url.hostname !== "www.googleapis.com") throw new Error("Unexpected provider hostname");
    const descriptor = { id: "synthetic-calendar", accessRole: "owner", primary: true, conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] } };
    const readStatus = await control(db, "google-read-status");
    if (readStatus && (url.pathname.includes("/users/me/calendarList") || url.pathname.endsWith("/freeBusy"))) return Response.json({ error: { code: Number(readStatus), message: "Private provider diagnostic must not be persisted" } }, { status: Number(readStatus) });
    if (url.pathname.includes("/users/me/calendarList")) return Response.json(url.pathname.endsWith("calendarList") ? { items: [descriptor] } : descriptor);
    if (url.pathname.endsWith("/events/watch")) {
      const status = await control(db, "google-watch-status");
      if (status) return Response.json({ error: { code: Number(status) } }, { status: Number(status) });
      return Response.json({ resourceId: "wire-resource", expiration: String(Date.now() + 7 * 86400000) });
    }
    if (url.pathname.endsWith("/channels/stop")) return new Response(null, { status: 204 });
    const events = (await db.prepare("SELECT payload FROM wire_events").all<{ payload: string }>()).results.map(row => JSON.parse(row.payload));
    // A conflict calendar free/busy cannot read (unshared or deleted): Google answers 200 with the calendar's errors.
    if (url.pathname.endsWith("/freeBusy") && await control(db, "google-busy-error")) return Response.json({ calendars: { "synthetic-calendar": { errors: [{ domain: "global", reason: "notFound" }], busy: [] } } });
    if (url.pathname.endsWith("/freeBusy")) return Response.json({ calendars: { "synthetic-calendar": { busy: events.filter(event => event.status !== "cancelled" && event.transparency !== "transparent").map(event => ({ start: event.start.dateTime, end: event.end.dateTime })) } } });
    const match = /\/events(?:\/([^/]+))?$/.exec(url.pathname);
    if (!match) throw new Error("Unexpected Google request");
    const id = match[1];
    if (method === "GET" && id) {
      const status = await control(db, `google-get-status:${id}`);
      if (status) return Response.json({ error: { code: Number(status), message: "Private provider diagnostic must not be persisted" } }, { status: Number(status) });
      const event = events.find(item => item.id === id);
      return event ? Response.json(event) : Response.json({ error: { code: 404 } }, { status: 404 });
    }
    if (method === "GET") {
      if (url.searchParams.has("syncToken") && await control(db, "google-invalid-cursor")) {
        await db.prepare("DELETE FROM wire_controls WHERE name='google-invalid-cursor'").run();
        return Response.json({ error: { code: 410 } }, { status: 410 });
      }
      const booking = url.searchParams.get("privateExtendedProperty")?.split("=")[1];
      const mode = booking && await control(db, `google-list-mode:${booking}`);
      if (mode === "paginated") return Response.json({ kind: "calendar#events", items: [], nextPageToken: "unread-page" });
      if (mode === "malformed") return Response.json({ kind: "calendar#events", items: "not-a-list" });
      return Response.json({ kind: "calendar#events", items: events.filter(event => (!booking || event.extendedProperties.private["dial-booking-id"] === booking) && (url.searchParams.get("showDeleted") !== "false" || event.status !== "cancelled")), nextSyncToken: "wire-cursor" });
    }
    const existing = id ? events.find(event => event.id === id) : undefined;
    if (method === "PATCH" && (!existing || new Headers(init.headers).get("if-match") !== existing.etag)) return Response.json({ error: { code: 412 } }, { status: 412 });
    if (!["PATCH", "POST"].includes(method) || !body) throw new Error("Unexpected Google mutation");
    const failure = await control(db, "google-mutation-status");
    if (failure) return Response.json({ error: { code: Number(failure), message: "Private provider diagnostic must not be persisted" } }, { status: Number(failure) });
    if (method === "POST" && events.some(event => event.id === body.id)) return Response.json({ error: { code: 409 } }, { status: 409 });
    if (method === "POST" && (typeof body.id !== "string" || !/^[a-v0-9]{5,1024}$/.test(body.id))) throw new Error("Invalid Google caller-supplied event ID");
    const conferenceState = await control(db, "google-conference") || "success";
    const event = { status: "confirmed", ...existing, ...body, id: id ?? body.id, etag: `"${crypto.randomUUID()}"`, updated: new Date().toISOString(),
      ...(body.conferenceData ? { conferenceData: { createRequest: { ...(body.conferenceData as { createRequest: object }).createRequest, status: { statusCode: conferenceState } }, ...(conferenceState === "success" ? { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/aaa-bbbb-ccc" }] } : {}) } } : {}) };
    await db.prepare("INSERT INTO wire_events(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(event.id, JSON.stringify(event)).run();
    if (await control(db, "google-lost-response")) {
      await db.prepare("DELETE FROM wire_controls WHERE name='google-lost-response'").run();
      throw new Error("Google committed the mutation before the response was lost");
    }
    return Response.json(event);
  };
}
/** Google's OAuth token endpoint: the consent code from the wire's authorization step and its refresh token. */
async function googleToken(db: D1Database, url: URL, method: string, body: string) {
  const form = new URLSearchParams(body);
  await db.prepare("INSERT INTO wire_calls(url,method,body,headers) VALUES(?,?,?,?)").bind(url.toString(), method, JSON.stringify({ grant_type: form.get("grant_type") }), "{}").run();
  if (url.pathname !== "/token" || method !== "POST" || form.get("client_id") !== "wire-client" || form.get("client_secret") !== "wire-secret") throw new Error("Unexpected Google token request");
  // Two-minute access tokens, so the adapter refreshes during a journey as it does hourly against Google.
  if (form.get("grant_type") === "authorization_code" && form.get("code") === "wire-consent") return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 120, token_type: "Bearer" });
  const refused = await db.prepare("SELECT value FROM wire_controls WHERE name='google-refresh-refused' AND value").first();
  if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === "synthetic-refresh" && !refused) return Response.json({ access_token: "synthetic-access", expires_in: 120, token_type: "Bearer" });
  return Response.json({ error: "invalid_grant" }, { status: 400 });
}
export async function initializeWire(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS wire_calls(id INTEGER PRIMARY KEY,url TEXT,method TEXT,body TEXT,headers TEXT,at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_events(id TEXT PRIMARY KEY,payload TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS wire_controls(name TEXT PRIMARY KEY,value INTEGER)"),
  ]);
  await initializeStripeWire(db);
}
async function control(db: D1Database, name: string) {
  return (await db.prepare("SELECT value FROM wire_controls WHERE name=?").bind(name).first<{ value: string | number }>())?.value;
}
