import review from "../review/worker";
export { BookingCoordinator } from "../review/worker";
import type { AppBindings } from "../../src/core/app/bindings";
import favicon from "../../src/core/features/public-booking/ui/favicon.svg?raw";

export default {
  ...review,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response(null, { status: 404 });
    // Native auth documents can ask for the browser's fallback icon; keep this fixture on Dial's one icon source.
    if (url.pathname === "/favicon.ico" && request.method === "GET") return new Response(favicon, { headers: { "Content-Type": "image/svg+xml" } });
    if (url.pathname === "/__host/reset" && request.method === "POST") {
      const existing = await env.DB.prepare("SELECT count(*) AS count FROM oa_operators").first<{ count: number }>();
      if (existing?.count) return new Response("Fixture requires fresh native state", { status: 409 });
      await env.DB.batch([
        env.DB.prepare("CREATE TABLE IF NOT EXISTS fixture_controls (kind TEXT PRIMARY KEY, failure INTEGER NOT NULL DEFAULT 0, delay_ms INTEGER NOT NULL DEFAULT 0)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS fixture_events (booking_id TEXT PRIMARY KEY, event_json TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS fixture_mail (key TEXT PRIMARY KEY, message_json TEXT NOT NULL, sent_at TEXT NOT NULL)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS fixture_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, happened_at TEXT NOT NULL)"),
      ]);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__host/reports") return Response.json((await env.DB.prepare("SELECT event_type_id,canonical_url,accepted_at,created_at,updated_at FROM host_link_copy_reports ORDER BY id").all()).results);
    if (url.pathname === "/__host/imported" && request.method === "POST") {
      await env.DB.batch([
        env.DB.prepare("UPDATE calendar_connections SET status='unhealthy',unhealthy_code='reauthorization_required'"),
        env.DB.prepare("UPDATE provider_connection_health SET status='unhealthy',unhealthy_code=CASE WHEN provider='google_calendar' THEN 'reauthorization_required' ELSE 'mail_check_required' END"),
      ]);
      return new Response(null, { status: 204 });
    }
    return review.fetch(request, env, context);
  },
};
