import { Hono } from "hono";
import type { AppEnvironment } from "../../app/context";
import { apiError, discardRequestBody } from "../../shared/http";
import { avatarMaxBytes, avatarTypes, matchesAvatarType, readAvatarBody } from "./avatar-validation";

export const avatarRoutes = new Hono<AppEnvironment>()
  .put("/api/app/profile/avatar", async (context) => {
    const type = context.req.header("Content-Type") ?? "";
    if (!avatarTypes.includes(type)) { await discardRequestBody(context.req.raw); return apiError(context, 415, "avatar_type_invalid", "Choose a JPEG, PNG, WebP or AVIF image."); }
    const length = context.req.header("Content-Length");
    if (length && (!/^\d+$/.test(length) || Number(length) > avatarMaxBytes)) { await discardRequestBody(context.req.raw); return apiError(context, 413, "avatar_too_large", "The avatar must be at most 5 MiB."); }
    const bytes = await readAvatarBody(context.req.raw);
    if (!bytes) return apiError(context, 413, "avatar_too_large", "The avatar must be at most 5 MiB.");
    if (!matchesAvatarType(bytes, type)) return apiError(context, 415, "avatar_type_invalid", "The image bytes must match the declared image type.");
    await context.get("services").avatarStorage.cleanup();
    const repository = context.get("services").avatarStorage.repository;
    const profile = await repository.get();
    if (!profile) return apiError(context, 409, "profile_required", "Save host details before uploading an avatar.");
    const key = `avatars/${crypto.randomUUID()}`;
    const uploadId = await context.get("services").avatarStorage.put(key, bytes, type);
    let changed;
    try { changed = await repository.setAvatar(profile.avatarKey ?? null, key, type, uploadId); }
    catch (error) { await context.get("services").avatarStorage.delete(key); throw error; }
    if (!changed) {
      await context.get("services").avatarStorage.delete(key);
      return apiError(context, 409, "avatar_changed", "The avatar changed during this upload. Reload and try again.");
    }
    if (profile.avatarKey) await context.get("services").avatarStorage.delete(profile.avatarKey);
    return context.json(await repository.get());
  })
  .delete("/api/app/profile/avatar", async (context) => {
    await context.get("services").avatarStorage.cleanup();
    const repository = context.get("services").avatarStorage.repository;
    const profile = await repository.get();
    if (!profile) return apiError(context, 409, "profile_required", "Save host details before removing an avatar.");
    if (!await repository.setAvatar(profile.avatarKey ?? null, null, null)) return apiError(context, 409, "avatar_changed", "The avatar changed. Reload and try again.");
    if (profile.avatarKey) await context.get("services").avatarStorage.delete(profile.avatarKey);
    return context.json(await repository.get());
  })
  .get("/media/*", async (context) => {
    const key = context.req.path.slice("/media/".length);
    if (!/^avatars\/[a-f0-9-]{36}$/.test(key)) return context.notFound();
    const profile = await context.get("services").avatarStorage.repository.get();
    if (!profile || profile.avatarKey !== key || !profile.avatarContentType || !avatarTypes.includes(profile.avatarContentType)) return context.notFound();
    const object = await context.get("services").avatarStorage.get(key);
    if (!object || object.httpMetadata?.contentType !== profile.avatarContentType) return context.notFound();
    return new Response(object.body, { headers: {
      "Content-Type": profile.avatarContentType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    } });
  });
