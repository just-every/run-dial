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

/** Read the real Base viewer, without adding any application-only test route. */
export async function readLocalOutbox(origin) {
  const response = await fetch(origin + "/__dev/outbox", { headers: devKeyHeaders });
  assert.equal(response.status, 200, "local outbox is reachable");
  const html = await response.text();
  return [...html.matchAll(/href="(\/__dev\/outbox\?message=[^"]+)"/g)].map(match => match[1].replaceAll("&amp;", "&"));
}
export async function localMagicLink(origin) {
  const messages = await readLocalOutbox(origin);
  assert.ok(messages.length, "a sign-in message reached the local outbox");
  for (const path of messages) {
    const detail = await fetch(origin + path, { headers: devKeyHeaders });
    assert.equal(detail.status, 200);
    const html = await detail.text();
    const link = /href="([^"]*\/auth\/confirm\?token=[^"]+)"/.exec(html)?.[1];
    if (link) return { developmentLink: link.replaceAll("&amp;", "&") };
  }
  assert.fail("the outbox contains a sign-in link");
}
export async function seedDemoWorkspace(origin, cookie) {
  const { build } = await import("esbuild");
  const output = await build({ entryPoints: [new URL("../sample-data/dial-demo.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
  const { demoProfile, demoEventType } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
  const headers = { origin, cookie, "content-type": "application/json" };
  assert.equal((await fetch(origin + "/api/app/profile", { method: "PATCH", headers, body: JSON.stringify(demoProfile) })).status, 200);
  assert.equal((await fetch(origin + "/api/app/event-types", { method: "POST", headers, body: JSON.stringify(demoEventType) })).status, 201);
}
