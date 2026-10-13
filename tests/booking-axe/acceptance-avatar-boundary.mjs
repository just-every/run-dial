import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function avatarBoundaryEvidence(browser, owner, origin, checks) {
  const anonymous = await browser.newContext();
  const bytes = await readFile("tests/avatar/jpeg.jpg");
  const manifest = JSON.parse(await readFile("seed.json", "utf8"));
  const headers = { Origin: origin, "Content-Type": "image/jpeg" };
  const status = async (check, response, expected) => {
    checks.push({ check, passed: response.status() === expected, status: response.status(), expected });
    assert.equal(response.status(), expected, check);
  };
  try {
    await status("Avatar anonymous upload", await anonymous.request.put(origin + "/api/app/profile/avatar", { headers, data: bytes }), 401);
    await status("Avatar oversized upload", await owner.request.put(origin + "/api/app/profile/avatar", { headers, data: Buffer.alloc(manifest.limits.maxUploadBytes + 1) }), 413);
    await status("Avatar GIF upload", await owner.request.put(origin + "/api/app/profile/avatar", { headers: { ...headers, "Content-Type": "image/gif" }, data: Buffer.from("GIF89a") }), 415);
    await status("Avatar declared PNG with JPEG bytes", await owner.request.put(origin + "/api/app/profile/avatar", { headers: { ...headers, "Content-Type": "image/png" }, data: bytes }), 415);
    const uploaded = await owner.request.put(origin + "/api/app/profile/avatar", { headers, data: bytes });
    await status("Avatar valid upload", uploaded, 200);
    const profile = await uploaded.json();
    const media = await anonymous.request.get(origin + "/media/" + profile.avatarKey);
    await status("Avatar anonymous media GET", media, 200);
    assert.equal(media.headers()["content-type"], "image/jpeg"); assert.equal(media.headers()["content-disposition"], "inline");
    assert.equal(media.headers()["x-content-type-options"], "nosniff"); assert.equal(media.headers()["set-cookie"], undefined);
    assert.deepEqual(await media.body(), bytes);
    checks.push({ check: "Avatar native public media bytes, content type, inline, nosniff and no Set-Cookie", passed: true });
    assert.equal((await owner.request.post(origin + "/__fixtures/avatar-objects")).status(), 200);
    await status("Non-avatar R2 object media GET", await anonymous.request.get(origin + "/media/private/audit-non-avatar"), 404);
    await status("Avatar remove", await owner.request.delete(origin + "/api/app/profile/avatar", { headers: { Origin: origin } }), 200);
    await status("Removed avatar media GET", await anonymous.request.get(origin + "/media/" + profile.avatarKey), 404);
    const objects = await (await owner.request.get(origin + "/__fixtures/avatar-objects")).json();
    assert.ok(!objects.keys.includes(profile.avatarKey), "removed avatar original object is actually gone from native R2");
    assert.ok(objects.keys.includes("private/audit-non-avatar"), "unrelated R2 object is preserved");
    checks.push({ check: "Removed avatar R2 object gone; unrelated private object preserved", passed: true });
  } finally { await anonymous.close(); }
}
