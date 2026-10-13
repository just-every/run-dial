import assert from "node:assert/strict";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

async function load(source) {
  const result = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { Hono, hostProfileRoutes, HostProfileRepository, HostProfileService, readProfile } = await load(`
export { Hono } from "hono";
export { hostProfileRoutes } from "./src/core/features/host-profile/routes";
export { HostProfileRepository } from "./src/core/features/host-profile/repository";
export { HostProfileService } from "./src/core/features/host-profile/service";
export { readProfile } from "./src/core/features/host-profile/read-profile";
`);

contract("PROFILE-001", "authenticated singleton route represents an absent persisted host with successful null", async () => {
  let persisted;
  const binding = { prepare: () => ({}), batch: async () => [{ results: persisted ? [persisted] : [] }, { results: [] }, { results: [] }] };
  const hostProfile = new HostProfileService(new HostProfileRepository(binding));
  const app = new Hono().use("*", async (context, next) => { context.set("services", { hostProfile, eventTypes: { listPublicListedEventTypes: async () => [] } }); await next(); }).route("/", hostProfileRoutes);
  const absent = await app.request("/api/app/profile");
  assert.equal(absent.status, 200, "absence of the authenticated singleton is ordinary setup state");
  assert.equal(await absent.json(), null, "no sample profile is synthesized");
  for (const path of ["/api/public/profiles/unknown", "/api/public/home/profile"]) assert.equal((await app.request(path)).status, 404, "unconfigured public profiles remain unavailable");
  persisted = { id: "host-id", handle: "owner", name: "Owner", title: "Host", biography: "Own content", timezone: "Australia/Brisbane", createdAt: "2026-10-08", updatedAt: "2026-10-08" };
  const configured = await app.request("/api/app/profile");
  assert.equal(configured.status, 200);
  assert.deepEqual(await configured.json(), { ...persisted, focusAreas: [], socialProof: [] });
  assert.equal((await app.request("/api/public/profiles/unknown")).status, 404);
});

contract("PROFILE-001", "profile reader distinguishes successful null from denied, failed and interrupted reads", async () => {
  assert.equal(await readProfile(Response.json(null)), null);
  const configured = { handle: "owner", timezone: "Australia/Brisbane" };
  assert.deepEqual(await readProfile(Response.json(configured)), configured);
  for (const [status, code, message] of [[401, "session_required", "A valid operator session is required."], [404, "profile_not_configured", "Obsolete missing-profile response."], [500, "database_unavailable", "Profile database unavailable."]]) {
    await assert.rejects(() => readProfile(Response.json({ error: { code, message } }, { status })), { message });
  }
  await assert.rejects(() => readProfile({ ok: true, json: async () => { throw new Error("Network interrupted"); } }), /Network interrupted/);
});
