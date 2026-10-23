import { operatorNotificationCommand } from "../../src/core/platform/operator-notification-boundary";
import { captureMail } from "../mail-capture";
import { controlClock } from "./clock";
import { issuedDevelopmentLink } from "../development-auth";
import { ensureTestOperator, registerTestSetup } from "../auth-fixture";
import start from "@tanstack/react-start/server-entry";
import { createWorker, BookingCoordinator } from "../../src/core/app/worker";
import { createServices } from "../../src/core/app/services";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
export { BookingCoordinator };
const production = createWorker();
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    if (url.pathname === "/__test/clock") return controlClock(request);
    const services = createServices(env.DB, { ...parseRuntimeEnvironment(env), ENVIRONMENT: "development", MAIL_PROVIDER: "development", APP_URL: url.origin, MAIL_FROM: "noreply@dial.test" }, { fetch: (input: Request) => start.fetch(input) } as Fetcher, { operatorNotifications: operatorNotificationCommand(env.BOOKING_COORDINATOR), mail: captureMail(env.DB) });
    if (url.pathname === "/__test/setup" && request.method === "POST") {
      const operator = await ensureTestOperator(env.DB, "setup@example.test");
      await registerTestSetup(env.DB, operator.id);
      return Response.json(operator);
    }
    if (url.pathname === "/__test/signin" && request.method === "POST") {
      const { email } = await request.json() as { email: string };
      const entry = await env.DB.prepare("SELECT status FROM oa_operators WHERE email=?").bind(email).first<{ status: string }>();
      const link = await issuedDevelopmentLink(env.DB, email, () => entry?.status === "invited"
        ? services.operatorManagement.invite(request, email)
        : services.operators.requestMagicLink(request, email));
      return Response.json({ link });
    }
    if (url.pathname === "/__test/state") return Response.json({
      operators: (await env.DB.prepare("SELECT id, email, removed_at FROM operators ORDER BY email").all()).results,
      setup: (await env.DB.prepare("SELECT operator_id FROM operator_setup_identity").all()).results,
      sessions: (await env.DB.prepare("SELECT operator_id, revoked_at FROM oa_sessions").all()).results,
      history: (await env.DB.prepare("SELECT created_by_operator_id AS operator_id,value FROM blocked_address_rules WHERE kind='domain'").all()).results,
    });
    return production.fetch(request, env, context);
  },
};
