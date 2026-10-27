const hosts = ["login.microsoftonline.com", "graph.microsoft.com"];
export const isMicrosoftHost = (hostname: string) => hosts.includes(hostname);
const control = async (db: D1Database, name: string) => (await db.prepare("SELECT value FROM wire_controls WHERE name=?").bind(name).first<{ value: string }>())?.value;
/** Contract-shaped Graph fixtures. Only the provider edge is synthetic. */
export async function microsoftWire(db: D1Database, url: URL, init: RequestInit) {
  const method = init.method ?? "GET";
  if (url.hostname === "login.microsoftonline.com") {
    const form = new URLSearchParams(String(init.body ?? ""));
    await db.prepare("INSERT INTO wire_calls(url,method,body,headers) VALUES(?,?,?,?)").bind(url.toString(), method, JSON.stringify({ grant_type: form.get("grant_type") }), "{}").run();
    if (url.pathname !== "/common/oauth2/v2.0/token" || method !== "POST" || form.get("client_id") !== "synthetic-dial-801-client" || form.get("client_secret") !== "synthetic-dial-802-secret") throw new Error("Unexpected Microsoft token request");
    const grant = form.get("grant_type"), code = form.get("code"), refresh = form.get("refresh_token");
    if (grant === "authorization_code" && code?.startsWith("synthetic-dial-810-")) return Response.json({ access_token: `synthetic-dial-811-${crypto.randomUUID()}`, refresh_token: `synthetic-dial-812-${crypto.randomUUID()}`, expires_in: 120, token_type: "Bearer" });
    if (grant === "refresh_token" && refresh?.startsWith("synthetic-dial-812-") && !(await control(db, "microsoft-refresh-refused"))) return Response.json({ access_token: `synthetic-dial-811-${crypto.randomUUID()}`, expires_in: 120, token_type: "Bearer" });
    return Response.json({ error: "invalid_grant", error_description: "Private Microsoft diagnostic" }, { status: 400 });
  }
  if (!new Headers(init.headers).get("authorization")?.startsWith("Bearer synthetic-dial-811-")) throw new Error("Unexpected Microsoft authorization");
  const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
  await db.prepare("INSERT INTO wire_calls(url,method,body,headers) VALUES(?,?,?,?)").bind(url.toString(), method, body ? JSON.stringify(body) : null, JSON.stringify(Object.fromEntries(new Headers(init.headers)))).run();
  const primary = await control(db, "microsoft-primary"), secondary = await control(db, "microsoft-secondary");
  const calendars = [primary, secondary].filter(Boolean).map(id => ({ id, canEdit: true, isDefaultCalendar: id === primary, owner: { address: "synthetic-dial-821-mailbox@example.test" } }));
  if (url.pathname === "/v1.0/me/calendars") return Response.json({ value: calendars });
  if (url.pathname === "/v1.0/me/calendar/getSchedule") {
    if (await control(db, "microsoft-busy-error")) return Response.json({ value: [{ scheduleId: "synthetic-dial-821-mailbox@example.test", error: { responseCode: "ErrorMailRecipientNotFound", message: "Private diagnostic" } }] });
    return Response.json({ value: [{ scheduleId: "synthetic-dial-821-mailbox@example.test", scheduleItems: await busyEvents(db) }] });
  }
  if (url.pathname === "/v1.0/subscriptions" && method === "POST") return Response.json({ id: `synthetic-dial-830-${crypto.randomUUID()}`, expirationDateTime: body?.expirationDateTime });
  if (url.pathname.startsWith("/v1.0/subscriptions/") && method === "DELETE") return new Response(null, { status: 204 });
  const match = /^\/v1.0\/me\/calendars\/([^/]+)(?:\/(calendarView|events)(?:\/(.*))?)?$/.exec(url.pathname);
  if (!match || !calendars.some(calendar => calendar.id === decodeURIComponent(match[1]))) throw new Error("Unexpected Microsoft calendar request");
  if (!match[2]) return Response.json(calendars.find(calendar => calendar.id === decodeURIComponent(match[1])));
  const events = (await db.prepare("SELECT payload FROM wire_events WHERE id LIKE 'synthetic-dial-84%'").all<{ payload: string }>()).results.map(row => JSON.parse(row.payload) as Record<string, unknown>);
  if (match[2] === "calendarView" && match[3] === "delta") return Response.json({ value: events, "@odata.deltaLink": `${url.origin}${url.pathname}?deltatoken=synthetic-dial-831-cursor` });
  if (match[2] === "calendarView") return Response.json({ value: await busyEvents(db) });
  const id = match[3] ? decodeURIComponent(match[3]) : undefined;
  if (method === "GET" && id) return events.find(event => event.id === id && !event["@removed"]) ? Response.json(events.find(event => event.id === id)) : Response.json({ error: { code: "ErrorItemNotFound" } }, { status: 404 });
  if (method === "GET") {
    const filter = url.searchParams.get("$filter");
    const booking = filter && /ep\/value eq '([^']+)'/.exec(filter)?.[1];
    return Response.json({ value: events.filter(event => !event["@removed"] && (!booking || (event.singleValueExtendedProperties as Array<{ value: string }>).some(value => value.value === booking))) });
  }
  const existing = events.find(event => event.id === id);
  if (method === "DELETE" && existing) {
    await db.prepare("UPDATE wire_events SET payload=? WHERE id=?").bind(JSON.stringify({ id, "@removed": { reason: "deleted" } }), id).run();
    return new Response(null, { status: 204 });
  }
  if (!["POST", "PATCH"].includes(method) || !body) throw new Error("Unexpected Microsoft event mutation");
  if (method === "PATCH" && (!existing || new Headers(init.headers).get("if-match") !== existing["@odata.etag"])) return Response.json({ error: { code: "ErrorIrresolvableConflict" } }, { status: 412 });
  const duplicate = method === "POST" && events.find(event => event.transactionId === body.transactionId && !event["@removed"]);
  const event = duplicate || { ...existing, ...body, id: id ?? `synthetic-dial-840-${crypto.randomUUID()}`, iCalUId: existing?.iCalUId ?? `synthetic-dial-841-${crypto.randomUUID()}`, lastModifiedDateTime: new Date().toISOString(), "@odata.etag": `"${crypto.randomUUID()}"`, start: utcTime(body.start), end: utcTime(body.end) };
  await db.prepare("INSERT INTO wire_events(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(event.id, JSON.stringify(event)).run();
  if (await control(db, "microsoft-lost-response")) { await db.prepare("DELETE FROM wire_controls WHERE name='microsoft-lost-response'").run(); throw new Error("Microsoft committed the event before response loss"); }
  return Response.json(event);
}
async function busyEvents(db: D1Database) {
  const start = await control(db, "microsoft-busy-start"), end = await control(db, "microsoft-busy-end");
  return start && end ? [{ subject: "Private appointment subject must not leave Graph", location: "Private appointment location", status: "busy", showAs: "busy", start: { dateTime: start, timeZone: "UTC" }, end: { dateTime: end, timeZone: "UTC" } }] : [];
}
function utcTime(value: unknown) { return value && typeof value === "object" && "dateTime" in value ? { dateTime: String(value.dateTime), timeZone: "UTC" } : value; }
