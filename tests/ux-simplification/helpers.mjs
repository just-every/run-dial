import { localMagicLink, confirmAuthLink } from "../auth-client.mjs";
import assert from "node:assert/strict";

export const origin = process.env.DIAL_UX_SIMPLIFICATION_ORIGIN ?? "http://127.0.0.1:15707";
assert.equal(new URL(origin).hostname, "127.0.0.1"); assert.equal(new URL(origin).port, "15707");
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
export const rules = async () => (await data("/api/app/blocked-addresses", undefined, 200, true)).rules;
export const add = (kind, value) => data("/api/app/blocked-addresses", { kind, value }, 201, true);
export const remove = (id) => call(`/api/app/blocked-addresses/${id}`, undefined, 204, true, "DELETE");
export async function authenticate(email) {
  await call("/api/auth/magic-links", { email }, 202);
  const link = await localMagicLink(origin);
  const signedIn = await confirmAuthLink(link.developmentLink);
  assert.equal(signedIn.status, 303); cookie = signedIn.headers.get("set-cookie").split(";")[0];
}
export const sideEffects = (value) => Object.fromEntries(Object.entries(value).filter(([table]) => table !== "fixture_activity"));
export async function neutral(response, code) {
  const error = (await response.json()).error;
  assert.equal(error.code, code); assert.doesNotMatch(error.message, /block|domain|address|rule/i); return error.message;
}
