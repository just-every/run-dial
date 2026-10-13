import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["src/core/features/calendar-connection/service.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { CalendarConnectionService } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
test("Google setup publishes only exact canonical callback and binding presence for every installation", () => {
  for (const APP_URL of ["https://first.example.test", "https://second.example.test/", "http://127.0.0.1:15752"]) {
    const runtime = { APP_URL, SESSION_SECRET: "test-only-secret".repeat(3), GOOGLE_OAUTH_CLIENT_ID: "private-client", GOOGLE_OAUTH_CLIENT_SECRET: "private-secret", CALENDAR_WEBHOOK_SECRET: "test-webhook-secret".repeat(3) };
    const service = new CalendarConnectionService({}, runtime);
    assert.deepEqual(service.setupGuide(), { redirectUri: new URL("/api/calendar/oauth/callback", APP_URL).href, configured: true });
    assert.doesNotMatch(JSON.stringify(service.setupGuide()), /private-client|private-secret|test-webhook/);
    for (const key of ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "CALENDAR_WEBHOOK_SECRET"]) assert.equal(new CalendarConnectionService({}, { ...runtime, [key]: undefined }).setupGuide().configured, false);
  }
});
