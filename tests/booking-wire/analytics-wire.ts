/** Synthetic advertising APIs at the HTTP edge; production constructs every request. */
export const analyticsHosts = ["googleads.googleapis.com", "api.linkedin.com"];
async function initialize(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS analytics_wire_uploads(id INTEGER PRIMARY KEY,provider TEXT,event_id TEXT,body TEXT,UNIQUE(provider,event_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS analytics_wire_controls(name TEXT PRIMARY KEY,value TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS analytics_wire_requests(id INTEGER PRIMARY KEY,provider TEXT,body TEXT)")
  ]);
}
export async function analyticsWire(db: D1Database, url: URL, init: RequestInit) {
  await initialize(db);
  const google = url.hostname === "googleads.googleapis.com", provider = google ? "google_ads" : "linkedin";
  const body = JSON.parse(String(init.body ?? "{}"));
  if (init.method !== "POST" || (google ? !/^\/v\d+\/customers\/\d+:uploadClickConversions$/.test(url.pathname) : url.pathname !== "/rest/conversionEvents")) throw new Error("Unexpected advertising API request");
  if (new Headers(init.headers).get("authorization") !== `Bearer synthetic-dial-${google ? 900 : 901}`) return Response.json({error:"invalid_token"},{status:401});
  if (google && new Headers(init.headers).get("developer-token") !== "synthetic-dial-902") throw new Error("Unexpected advertising developer token");
  const row = await db.prepare("SELECT value FROM analytics_wire_controls WHERE name=?").bind(`${provider}-failure`).first<{value:string}>();
  await db.prepare("INSERT INTO analytics_wire_requests(provider,body) VALUES(?,?)").bind(provider,JSON.stringify(body)).run();
  if (row?.value === "401") return Response.json({error:"invalid_token"},{status:401});
  if (row?.value === "429") { await db.prepare("DELETE FROM analytics_wire_controls WHERE name=?").bind(`${provider}-failure`).run(); return Response.json({error:"rate_limited"},{status:429,headers:{"retry-after":"1"}}); }
  if (row?.value === "partial") return Response.json({partialFailureError:{code:3,message:"Synthetic conversion refused"},results:[]});
  const conversion = google ? body.conversions[0] : body;
  const eventId = google ? conversion.orderId : conversion.eventId;
  if (!eventId) throw new Error("Missing stable advertising conversion identity");
  await db.prepare("INSERT INTO analytics_wire_uploads(provider,event_id,body) VALUES(?,?,?) ON CONFLICT(provider,event_id) DO NOTHING").bind(provider,eventId,JSON.stringify(body)).run();
  if (row?.value === "lost") { await db.prepare("DELETE FROM analytics_wire_controls WHERE name=?").bind(`${provider}-failure`).run(); throw new Error("Advertising API accepted before response loss"); }
  return google ? Response.json({results:[{gclid:conversion.gclid,conversionAction:conversion.conversionAction,conversionDateTime:conversion.conversionDateTime}]}) : new Response(null,{status:201,headers:{"x-restli-id":"synthetic-dial-903"}});
}
export async function analyticsFixtures(url: URL, request: Request, db: D1Database, edge: D1Database) {
  await initialize(edge);
  if (url.pathname.endsWith("/state")) {
    const tables = ["analytics_settings","analytics_connections","analytics_deliveries"];
    const application = Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.prepare(`SELECT * FROM ${table}`).all()).results])));
    return Response.json({...application,uploads:(await edge.prepare("SELECT * FROM analytics_wire_uploads ORDER BY id").all()).results,requests:(await edge.prepare("SELECT * FROM analytics_wire_requests ORDER BY id").all()).results});
  }
  if (url.pathname.endsWith("/control")) {
    const {name,value}=await request.json<{name:string;value:string}>();
    await edge.prepare("INSERT INTO analytics_wire_controls VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").bind(name,value).run();
    return new Response(null,{status:204});
  }
  if (url.pathname.endsWith("/due")) {
    const {id}=await request.json<{id:string}>();
    await db.prepare("UPDATE analytics_deliveries SET next_attempt_at='2000-01-01T00:00:00.000Z',updated_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
    return new Response(null,{status:204});
  }
  return new Response(null,{status:404});
}
