import assert from "node:assert/strict";
import { devKeyHeaders } from "./dev-key.mjs";
/** Real client protocol: scanners only read; explicit same-origin POST redeems. */
export async function confirmAuthLink(link) {
  const url = new URL(link);
  const preview = await fetch(link, { redirect: "manual" });
  assert.equal(preview.headers.get("set-cookie"), null, "GET never creates a session");
  const head = await fetch(link, { method: "HEAD", redirect: "manual" });
  assert.equal(head.headers.get("set-cookie"), null, "HEAD never creates a session");
  return fetch(`${url.origin}/auth/confirm`, { method: "POST", redirect: "manual", headers: { Origin: url.origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: url.searchParams.get("token") }) });
}
export async function bootstrapTestOwner(origin) {
  const response = await fetch(`${origin}/auth/bootstrap`, { method: "POST", redirect: "manual", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ token: "dial-test-only-setup-token-at-least-32", displayName: "Test operator", returnTo: "/app" }) });
  assert.ok([303,409].includes(response.status), `Test bootstrap: ${response.status}: ${await response.clone().text()}`);
}

/** Messages from a test-owned mail adapter, never an application outbox. */
export async function readTestMail(origin) {
  const response = await fetch(origin + "/__test/mail", { headers: devKeyHeaders });
  if (response.ok) return (await response.json()).map(row => row.message);
  assert.equal(response.status, 404);
  const fixture = await fetch(origin + "/__fixtures/status");
  assert.equal(fixture.status, 200, "test provider storage is reachable");
  return (await fixture.json()).fixture_mail.sort((a, b) => b.sent_at.localeCompare(a.sent_at)).map(row => JSON.parse(row.message_json));
}
export async function localMagicLink(origin) {
  const messages = await readTestMail(origin);
  const link = messages.map(message => message.text?.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)?.[0]).find(Boolean);
  assert.ok(link, "a sign-in message reached the test mail adapter");
  return { developmentLink: link };
}
export async function seedDemoWorkspace(origin, cookie) {
  const { build } = await import("esbuild");
  const output = await build({ entryPoints: [new URL("../sample-data/dial-demo.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
  const { demoProfile, demoEventType } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
  const headers = { origin, cookie, "content-type": "application/json" };
  assert.equal((await fetch(origin + "/api/app/profile", { method: "PATCH", headers, body: JSON.stringify(demoProfile) })).status, 200);
  assert.equal((await fetch(origin + "/api/app/event-types", { method: "POST", headers, body: JSON.stringify(demoEventType) })).status, 201);
}
