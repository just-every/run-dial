import { Hono } from "hono";
import type { AppEnvironment } from "../../app/context";
import { faceTypes } from "./public-look";

/** BRAND-002 (ct C3): the brand files beside the avatar, under PROFILE-003's delivery rules: the type fixed from the
 * file's signature, inline, nosniff. A mark may be SVG, so every file is sandboxed: opened on its own it runs nothing.
 * A face carries the CORS header a booking page needs to load it from another origin (an embed's host or a mapped
 * hostname). Mount before the avatar's /media/* route. */
export const brandFileRoutes = new Hono<AppEnvironment>()
  .get("/media/brand/:file", async (context) => {
    const name = context.req.param("file");
    const file = /^[a-f0-9]{64}\.[a-z0-9]+$/.test(name) ? await context.get("services").siteLook.publicFile(name) : null;
    if (!file) return context.notFound();
    return new Response(file.object.body, { headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // The name is the content's own hash, so the bytes behind it never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      ...(faceTypes.includes(file.contentType) ? { "Access-Control-Allow-Origin": "*" } : {}),
    } });
  });
