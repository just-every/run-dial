import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { anonymousMagicLinkRequest } from "./anonymous-signin";

const requestMagicLinkSchema = z.object({ email: z.string().email().max(320) });

export const operatorRoutes = new Hono<AppEnvironment>()
    .post("/api/auth/magic-links", validate("json", requestMagicLinkSchema), async (context) => {
      const operators = context.get("services").operators;
      await anonymousMagicLinkRequest(
        () => operators.requestMagicLink(context.req.raw, context.req.valid("json").email),
        () => operators.signInMailConfigured,
      );
      return context.json({ status: "check_your_email" }, 202);
    })
    .get("/api/auth/verify", (context) => context.redirect(`/auth/confirm${new URL(context.req.url).search}`, 303))
    .post("/api/auth/sign-out", async (context) => {
      context.header("Set-Cookie", await context.get("services").operators.signOut(context.req.raw));
      return context.body(null, 204);
    })
    .get("/api/app/session", async (context) => context.json({ operator: context.get("session") }));
