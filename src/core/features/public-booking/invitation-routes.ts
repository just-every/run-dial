import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";

const tokenSchema = z.object({ token: z.string().min(1).max(512) });
export const invitationManageRoutes = new Hono<AppEnvironment>()
  .get("/api/public/manage/invite/:token", validate("param", tokenSchema), async context => {
    const result = await context.get("services").invitationManage.access(context.req.valid("param").token);
    if (result.kind === "available") return context.json({ available: true });
    return unavailable(context, result.kind);
  })
  .post("/api/public/manage/invite/:token/email", validate("param", tokenSchema), validate("json", z.object({}).strict()), async context => {
    const result = await context.get("services").invitationManage.emailReplacement(context.req.valid("param").token);
    if (result === "accepted") return context.json({ accepted: true }, 202);
    return unavailable(context, result);
  })
  .get("/manage/invite/:token", validate("param", tokenSchema), async context => {
    const result = await context.get("services").invitationManage.access(context.req.valid("param").token);
    return context.get("services").spaSurface.serve(context.req.raw, result.kind === "available" ? 200 : result.kind === "expired" ? 410 : 404, { blockFraming: true });
  });

function unavailable(context: Context<AppEnvironment>, kind: "not_found" | "expired") {
  return kind === "expired"
    ? apiError(context, 410, "invitation_link_expired", "This invitation link is no longer available.")
    : apiError(context, 404, "invitation_link_not_found", "This invitation link is not valid.");
}
