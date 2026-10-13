import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { ianaTimeZoneSchema } from "../../shared/scheduling";
import { validate } from "../../shared/validation";
import { toPublicProfile } from "./public";

const handleSchema = z.object({ handle: z.string().regex(/^[a-z0-9-]+$/).max(80) });
const profileSchema = z.object({
  handle: z.string().regex(/^[a-z0-9-]+$/).max(80),
  name: z.string().min(1).max(120),
  title: z.string().min(1).max(180),
  biography: z.string().min(1).max(2000),
  timezone: ianaTimeZoneSchema,
  focusAreas: z.array(z.object({ label: z.string().min(1).max(40) })).max(6),
  socialProof: z.array(z.object({ quote: z.string().min(1).max(280), attribution: z.string().min(1).max(120) })).max(3),
});

export const hostProfileRoutes = new Hono<AppEnvironment>()
    .get("/api/public/profiles/:handle", validate("param", handleSchema), async (context) => {
      const profile = await context.get("services").hostProfile.getPublicProfile(context.req.valid("param").handle);
      if (!profile) return apiError(context, 404, "profile_not_found", "The requested public profile does not exist.");
      return context.json({ profile: toPublicProfile(profile), eventTypes: await context.get("services").eventTypes.listPublicListedEventTypes() });
    })
    .get("/api/public/home/profile", async (context) => {
      const profile = await context.get("services").hostProfile.getProfile();
      return profile
        ? context.json({ profile: toPublicProfile(profile), eventTypes: await context.get("services").eventTypes.listPublicListedEventTypes() })
        : apiError(context, 404, "profile_not_found", "The public profile has not been configured.");
    })
    .get("/api/app/profile", async (context) => {
      const profile = await context.get("services").hostProfile.getProfile();
      return context.json(profile ?? null);
    })
    .patch("/api/app/profile", validate("json", profileSchema), async (context) => context.json(await context.get("services").hostProfile.saveProfile(context.req.valid("json"))));
