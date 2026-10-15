import production, { BookingCoordinator } from "../mail-runtime.worker";
import type { AppBindings } from "../../src/core/app/bindings";
export { BookingCoordinator };

/** Test diagnostics only. Every admission/session/editor request uses the product Worker. */
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    if (new URL(request.url).hostname !== "127.0.0.1") return new Response(null, { status: 404 });
    if (new URL(request.url).pathname === "/__test/admission") {
      if (request.method === "POST") {
        const { action } = await request.json() as { action: string };
        if (action === "fail-session") await env.DB.exec("CREATE TRIGGER test_fail_session BEFORE INSERT ON oa_sessions BEGIN SELECT RAISE(ABORT,'injected_failure'); END;");
        else if (action === "allow-session") await env.DB.exec("DROP TRIGGER test_fail_session;");
        else if (action === "expire-session") await env.DB.prepare("UPDATE oa_sessions SET expires_at=0").run();
        else if (action === "retire-owner") await env.DB.exec("DROP TRIGGER oa_preserve_last_owner_delete; DELETE FROM oa_sessions; DELETE FROM oa_bootstrap; DELETE FROM oc_owner_claims WHERE completed=0; DELETE FROM operator_setup_identity; DELETE FROM oa_operators; DELETE FROM operators;");
        else return new Response(null, { status: 400 });
      }
      const tables = ["oa_operators", "oa_bootstrap", "oa_sessions", "oa_limits", "oc_owner_claims", "operators", "operator_setup_identity", "public_rate_events"];
      const counts: Record<string, number> = {};
      for (const table of tables) counts[table] = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
      const limits = (await env.DB.prepare("SELECT count FROM oa_limits ORDER BY key").all<{ count: number }>()).results;
      return Response.json({ counts, limits: limits.map(row => row.count) });
    }
    return production.fetch(request, env, context);
  },
};
