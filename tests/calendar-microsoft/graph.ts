/** Synthetic Graph HTTP edge. No application service or repository is replaced. */
export class SyntheticGraph {
  calls: { path: string; method: string; body: Record<string, unknown>; ifMatch: string | null }[] = [];
  events = new Map<string, Record<string, unknown>>();
  subscriptions = new Set<string>();
  deleted: string[] = [];
  refusedRefresh = false;
  unreadable = false;
  loseCreateResponse = false;
  private sequence = 0;
  private revision = 0;
  readonly request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET", headers = new Headers(init?.headers);
    const text = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "";
    const body = text.startsWith("{") ? JSON.parse(text) as Record<string, unknown> : Object.fromEntries(new URLSearchParams(text));
    this.calls.push({ path: url.pathname + url.search, method, body, ifMatch: headers.get("if-match") });
    const json = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.hostname === "login.microsoftonline.com" && url.pathname.endsWith("/token")) {
      if (body.grant_type === "refresh_token" && this.refusedRefresh) return json({ error: "invalid_grant" }, 400);
      return json({ access_token: "synthetic-dial-1600", refresh_token: "synthetic-dial-1601", expires_in: 3600 });
    }
    if (url.hostname !== "graph.microsoft.com" || headers.get("authorization") !== "Bearer synthetic-dial-1600") return json({ error: "synthetic unauthorized" }, 401);
    const descriptor = (id: string) => ({ id, canEdit: id === "synthetic-dial-1602", isDefaultCalendar: id === "synthetic-dial-1602", owner: { address: "synthetic-dial-1603@example.test" }, allowedOnlineMeetingProviders: ["teamsForBusiness"] });
    if (url.pathname === "/v1.0/me/calendars") return json({ value: [descriptor("synthetic-dial-1602"), descriptor("synthetic-dial-1604")] });
    if (/\/calendars\/[^/]+$/.test(url.pathname)) return this.unreadable ? json({}, 403) : json(descriptor(decodeURIComponent(url.pathname.split("/").at(-1)!)));
    if (url.pathname.endsWith("/getSchedule")) return json({ value: [{ scheduleId: "synthetic-dial-1603@example.test", scheduleItems: [], ...(this.unreadable ? { error: { responseCode: "ErrorAccessDenied" } } : {}) }] });
    if (url.pathname.endsWith("/calendarView")) return json({ value: [{ id: "synthetic-dial-1605", subject: "Private synthetic appointment", attendees: ["private@example.test"], start: { dateTime: "2030-06-03T10:00:00", timeZone: "UTC" }, end: { dateTime: "2030-06-03T10:30:00", timeZone: "UTC" }, showAs: "busy", isCancelled: false }] });
    if (url.pathname.endsWith("/calendarView/delta")) return json({ value: this.deleted.map(id => ({ id, "@removed": { reason: "deleted" } })), "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/synthetic-dial-1602/calendarView/delta?$deltatoken=synthetic-dial-1606" });
    if (url.pathname === "/v1.0/subscriptions" && method === "POST") {
      const id = `synthetic-dial-subscription-${++this.sequence}`; this.subscriptions.add(id);
      return json({ id, expirationDateTime: body.expirationDateTime });
    }
    if (url.pathname.startsWith("/v1.0/subscriptions/") && method === "DELETE") { this.subscriptions.delete(url.pathname.split("/").at(-1)!); return new Response(null, { status: 204 }); }
    if (url.pathname.endsWith("/events") && method === "GET") {
      const filter = url.searchParams.get("$filter") ?? "";
      return json({ value: [...this.events.values()].filter(event => !filter || Array.isArray(event.singleValueExtendedProperties) && event.singleValueExtendedProperties.some(property => property.id.endsWith("Name DialBookingId") && property.value === filter.match(/ep\/value eq '([^']+)'/)?.[1])) });
    }
    if (url.pathname.endsWith("/events") && method === "POST") {
      const id = `synthetic-dial-event-${++this.sequence}`;
      const event = this.saved(id, body); this.events.set(id, event);
      if (this.loseCreateResponse) { this.loseCreateResponse = false; throw new TypeError("Synthetic lost response after Graph accepted"); }
      return json(event, 201);
    }
    if (/\/events\/[^/]+$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!), event = this.events.get(id);
      if (!event) return json({}, 404);
      if (method === "GET") return json(event);
      if (headers.get("if-match") !== event["@odata.etag"]) return json({}, 412);
      if (method === "DELETE") { this.events.delete(id); this.deleted.push(id); return new Response(null, { status: 204 }); }
      if (method === "PATCH") { const saved = this.saved(id, { ...event, ...body }); this.events.set(id, saved); return json(saved); }
    }
    throw new Error(`Unexpected synthetic Graph HTTP request ${method} ${url.pathname}`);
  };
  private saved(id: string, body: Record<string, unknown>) {
    return { ...body, id, "@odata.etag": `synthetic-dial-etag-${++this.revision}`, lastModifiedDateTime: new Date(Date.parse("2030-01-01T00:00:00Z") + this.revision * 1000).toISOString(),
      ...(body.isOnlineMeeting ? { onlineMeeting: { joinUrl: `https://teams.example.test/${id}` } } : {}) };
  }
}
