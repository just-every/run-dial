import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { erasureAuditCsv } from "./csv";
import { ErasureAuditQuery } from "./query";

const page = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
}).strict();

// Mounted behind the native owner-session boundary in createApp.
export const auditRoutes = new Hono<AppEnvironment>()
  .use("/api/app/audit/*", async (context, next) => {
    context.header("Cache-Control", "private, no-store");
    await next();
  })
  .get("/api/app/audit/erasures", validate("query", page), async context => {
    const { limit, offset } = context.req.valid("query");
    const result = await new ErasureAuditQuery(context.get("apiDatabase")).page(limit, offset);
    context.header("X-Total-Count", String(result.total));
    return context.json(result.entries);
  })
  .get("/api/app/audit/erasures.csv", context => new Response(
    erasureAuditCsv(new ErasureAuditQuery(context.get("apiDatabase")).all()),
    { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="dial-erasure-audit.csv"',
      "Cache-Control": "private, no-store",
    } },
  ));
