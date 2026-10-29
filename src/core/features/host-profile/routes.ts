import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { profileInputSchema as profileSchema } from "./input";
import { validate } from "../../shared/validation";
import { toPublicProfile } from "./public";

const handleSchema = z.object({ handle: z.string().regex(/^[a-z0-9-]+$/).max(80) });


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
