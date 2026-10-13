import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";

const invitation = z.object({ email: z.string().trim().toLowerCase().email().max(320) }).strict();
const target = z.object({ id: z.string().min(1).max(128) });
export const operatorManagementRoutes = new Hono<AppEnvironment>()
  .get("/api/app/operators", async (context) => {
    const operators = await context.get("services").operatorManagement.list(context.req.raw);
    if (!operators) return apiError(context, 503, "operator_setup_missing", "Setup must register the original operator before operator access can be managed.");
    return context.json({ operators, currentOperatorId: context.get("session").id });
  })
  .post("/api/app/operators", validate("json", invitation), async (context) => {
    const services = context.get("services");
    const result = await services.operatorManagement.invite(context.req.raw, context.req.valid("json").email);
    return context.json(result, 201);
  })
  .post("/api/app/operators/:id/remove", validate("param", target), async (context) => {
    await context.get("services").operatorManagement.removeWithinNotificationGate(context.req.raw, context.req.valid("param").id);
    return context.body(null, 204);
  });
