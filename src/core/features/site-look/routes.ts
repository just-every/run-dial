import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { SiteLookError, type LookChange } from "./service";

const readSchema = z.object({ url: z.string().trim().min(1).max(500) }).strict();
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase()).nullable().optional();
const changeSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable().optional(),
  line: z.string().trim().min(1).max(280).nullable().optional(),
  background: colour,
  ink: colour,
  accent: colour,
  buttonInk: colour,
  mark: z.enum(["site", "none"]).optional(),
  face: z.enum(["site", "plain"]).optional(),
  look: z.enum(["site", "plain"]).optional(),
}).strict().refine((change) => Object.keys(change).length > 0);

async function answer(context: Context<AppEnvironment>, work: () => Promise<unknown>) {
  try { return context.json(await work()); }
  catch (error) {
    if (error instanceof SiteLookError) return apiError(context, error.status, error.code, error.message);
    throw error;
  }
}

/** BRAND-001: the stored look, a read on request, the owner's changes value by value, and back to plain. */
export const siteLookRoutes = new Hono<AppEnvironment>()
  .get("/api/app/site-look", (context) => answer(context, () => context.get("services").siteLook.state()))
  .post("/api/app/site-look/read", validate("json", readSchema), (context) => answer(context, () => context.get("services").siteLook.read(context.req.valid("json").url)))
  .put("/api/app/site-look", validate("json", changeSchema), (context) => answer(context, () => context.get("services").siteLook.change(context.req.valid("json") as LookChange)))
  .delete("/api/app/site-look", (context) => answer(context, () => context.get("services").siteLook.clear()));
