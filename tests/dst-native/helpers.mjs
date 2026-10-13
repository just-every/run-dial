import { localMagicLink, confirmAuthLink } from "../auth-client.mjs";
import assert from "node:assert/strict";

export const origin = process.env.DIAL_DST_NATIVE_ORIGIN ?? "http://127.0.0.1:15709";
assert.equal(new URL(origin).hostname, "127.0.0.1"); assert.equal(new URL(origin).port, "15709");
let cookie, connectingClient = 0;
export async function call(path, body, expected = 200, authenticated = false, method = body === undefined ? "GET" : "POST", extraHeaders = {}) {
  const client = connectingClient++;
  const response = await fetch(origin + path, { method, headers: { Origin: origin, "CF-Connecting-IP": `198.18.${Math.floor(client / 250)}.${client % 250 + 1}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(authenticated ? { cookie } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert.ok(allowed.includes(response.status), `${path}: expected${allowed.join("/")}, got${response.status}: ${await response.clone().text()}`);
  return response;
}
export const data = async (...args) => (await call(...args)).json();
export const snapshot = () => data("/__fixtures/status");
export async function authenticate(email) {
  await call("/api/auth/magic-links", { email }, 202);
  const link = await localMagicLink(origin);
  const signedIn = await confirmAuthLink(link.developmentLink);
  assert.equal(signedIn.status, 303); cookie = signedIn.headers.get("set-cookie").split(";")[0];
}
