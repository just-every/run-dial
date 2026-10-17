import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { ianaTimeZoneSchema } from "../../shared/scheduling";
import { validate } from "../../shared/validation";
import { normaliseEmbedOrigin } from "./service";
import { embedBootstrap } from "./embed-bootstrap";

const embedParamsSchema = z.object({ handle: z.string().regex(/^[a-z0-9-]+$/).max(80), slug: z.string().regex(/^[a-z0-9-]+$/).max(80) });
const originsSchema = z.object({
  allowedOrigins: z.array(z.string().min(1).max(300)).max(30).transform((values, context) => {
    const origins = values.map((value, index) => {
      const normalised = normaliseEmbedOrigin(value);
      if (!normalised) context.addIssue({ code: "custom", path: ["allowedOrigins", index], message: "Use an exact HTTPS origin, or a loopback HTTP origin for local development." });
      return normalised;
    });
    if (origins.some((origin) => !origin)) return z.NEVER;
    if (new Set(origins).size !== origins.length) context.addIssue({ code: "custom", path: ["allowedOrigins"], message: "Allowed origins must be unique." });
    return origins as string[];
  }),
});
const parentSchema = z.object({ parent: z.string().min(1).max(300).optional() });
const selectionEmbedQuerySchema = parentSchema.extend({ nonce: z.string().min(1).max(200).optional(), startAt: z.string().datetime({ offset: true }).optional(), inviteeTimezone: ianaTimeZoneSchema.optional() });
const confirmedEmbedQuerySchema = parentSchema.extend({ token: z.string().min(1).max(512).optional() });

export const embedRoutes = new Hono<AppEnvironment>()
  .get("/api/app/embed-settings", async (context) => context.json({ allowedOrigins: await context.get("services").embeds.listAllowedOrigins() }))
  .put("/api/app/embed-settings", validate("json", originsSchema), async (context) => {
    return context.json({ allowedOrigins: await context.get("services").embeds.replaceAllowedOrigins(context.req.valid("json").allowedOrigins) });
  })
  .get("/embed/dial.js", (context) => {
    context.header("Content-Type", "application/javascript; charset=utf-8");
    context.header("Cache-Control", "public, max-age=300");
    return context.body(embedBootstrap);
  })
  .get("/embed/manage/:token", validate("param", z.object({ token: z.string().min(1).max(512) })), validate("query", parentSchema), async (context) => {
    const parentOrigin = await allowedManageEmbedParent(context, context.req.valid("query").parent ?? "");
    if (!parentOrigin) return blockedEmbedSurface(context);
    const booking = await context.get("services").bookings.getManageBooking(context.req.valid("param").token);
    return booking.kind === "found" ? embeddedSurface(context, parentOrigin) : embeddedRecoverySurface(context, parentOrigin, booking.kind === "expired" ? 410 : 404);
  })
  .get("/embed/:handle/:slug", validate("param", embedParamsSchema), validate("query", parentSchema), async (context) => {
    const { handle, slug } = context.req.valid("param");
    return publicEmbedSurface(context, handle, slug, context.req.valid("query").parent ?? "");
  })
  .get("/embed/:handle/:slug/details", validate("param", embedParamsSchema), validate("query", selectionEmbedQuerySchema), async (context) => {
    const { handle, slug } = context.req.valid("param");
    const query = context.req.valid("query");
    return publicEmbedDetailsSurface(context, handle, slug, query);
  })
  .get("/embed/:handle/:slug/confirmed", validate("param", embedParamsSchema), validate("query", confirmedEmbedQuerySchema), async (context) => {
    const { handle, slug } = context.req.valid("param");
    const query = context.req.valid("query");
    return publicEmbedConfirmationSurface(context, handle, slug, query);
  })
  .get("/embed/:handle/:slug/request", validate("param", embedParamsSchema), validate("query", parentSchema), async (context) => publicEmbedSurface(context, context.req.valid("param").handle, context.req.valid("param").slug, context.req.valid("query").parent ?? ""))
  .get("/embed/*", (context) => blockedEmbedSurface(context));

async function publicEmbedSurface(context: Context<AppEnvironment>, handle: string, slug: string, parent: string) {
  const parentOrigin = await allowedEmbedParent(context, handle, slug, parent);
  return parentOrigin ? embeddedSurface(context, parentOrigin) : blockedEmbedSurface(context);
}

async function publicEmbedDetailsSurface(context: Context<AppEnvironment>, handle: string, slug: string, query: z.infer<typeof selectionEmbedQuerySchema>) {
  const parentOrigin = await allowedEmbedParent(context, handle, slug, query.parent ?? "");
  if (!parentOrigin) return blockedEmbedSurface(context);
  if (!query.nonce || !query.startAt || !query.inviteeTimezone) return embeddedRecoverySurface(context, parentOrigin, 404);
  const selection = await context.get("services").bookings.getPublicSelection({ handle, slug, nonce: query.nonce, startAt: query.startAt, inviteeTimezone: query.inviteeTimezone });
  return selection.kind === "found" ? embeddedSurface(context, parentOrigin) : embeddedRecoverySurface(context, parentOrigin, selection.kind === "expired" ? 410 : 404);
}

async function publicEmbedConfirmationSurface(context: Context<AppEnvironment>, handle: string, slug: string, query: z.infer<typeof confirmedEmbedQuerySchema>) {
  const parentOrigin = await allowedEmbedParent(context, handle, slug, query.parent ?? "");
  if (!parentOrigin) return blockedEmbedSurface(context);
  if (!query.token) return embeddedRecoverySurface(context, parentOrigin, 404);
  const booking = await context.get("services").bookings.getManageBooking(query.token);
  return booking.kind === "found" ? embeddedSurface(context, parentOrigin) : embeddedRecoverySurface(context, parentOrigin, booking.kind === "expired" ? 410 : 404);
}

async function allowedEmbedParent(context: Context<AppEnvironment>, handle: string, slug: string, parent: string) {
  const parentOrigin = normaliseEmbedOrigin(parent);
  return parentOrigin && await context.get("services").embeds.canEmbed(handle, slug, parentOrigin) ? parentOrigin : undefined;
}

async function allowedManageEmbedParent(context: Context<AppEnvironment>, parent: string) {
  const parentOrigin = normaliseEmbedOrigin(parent);
  return parentOrigin && await context.get("services").embeds.isOriginAllowed(parentOrigin) ? parentOrigin : undefined;
}

function embeddedSurface(context: Context<AppEnvironment>, parentOrigin: string) {
  return context.get("services").spaSurface.serve(context.req.raw, 200, { frameAncestors: [parentOrigin] });
}

function embeddedRecoverySurface(context: Context<AppEnvironment>, parentOrigin: string, status: 404 | 410) {
  return context.get("services").spaSurface.serve(context.req.raw, status, { frameAncestors: [parentOrigin] });
}

function blockedEmbedSurface(context: Parameters<typeof apiError>[0]) {
  return context.get("services").spaSurface.serve(context.req.raw, 404, { blockFraming: true });
}
