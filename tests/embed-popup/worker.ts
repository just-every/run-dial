import production, { BookingCoordinator } from "../embed-document-authorization/worker";
import type { AppBindings } from "../../src/core/app/bindings";

export { BookingCoordinator };
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname === "127.0.0.1" && url.pathname === "/__fixtures/popup" && request.method === "POST") {
      const { redirect } = await request.json<{ redirect: boolean }>();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM calendar_connection_calendars"),
        env.DB.prepare("DELETE FROM calendar_connections"),
        env.DB.prepare("UPDATE event_types SET location_type='in_person', location_label='Studio', location_value='Synthetic meeting room', locations_json=NULL, post_booking_redirect_json=? WHERE slug='intro'")
          .bind(redirect ? JSON.stringify({ url: "https://thanks.example.test/complete", fields: ["event", "start_time", "name", "utm_source", "booking_reference"] }) : null),
      ]);
      return new Response(null, { status: 204 });
    }
    return production.fetch(request, env, context);
  },
};
