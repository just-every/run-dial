import { Hono } from "hono";
import type { AppEnvironment } from "../../app/context";

/** PROFILE-003 (ct C3): the read mark and face are public files beside the avatar, under the same delivery rules:
 * their declared type, inline, nosniff. A mark may be SVG, so the file itself is sandboxed: opened on its own it
 * runs nothing. Mount before the avatar's /media/* route. */
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
    } });
  });
