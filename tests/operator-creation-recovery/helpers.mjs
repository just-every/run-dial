import { localMagicLink, confirmAuthLink } from "../auth-client.mjs";
import assert from "node:assert/strict";

export const origin = process.env.DIAL_OPERATOR_CREATION_RECOVERY_ORIGIN ?? "http://127.0.0.1:15708";
assert.equal(new URL(origin).hostname, "127.0.0.1"); assert.equal(new URL(origin).port, "15708");
const sessions = new Map(); let connectingClient = 0;
export async function call(path, body, expected = 200, email, method = body === undefined ? "GET" : "POST", extraHeaders = {}) {
  const client = connectingClient++;
  const response = await fetch(origin + path, { method, headers: { Origin: origin, "CF-Connecting-IP": `198.18.${Math.floor(client / 250)}.${client % 250 + 1}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(email ? { cookie: sessions.get(email) } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${path}: expected${JSON.stringify(expected)}, got${response.status}: ${await response.clone().text()}`); return response;
}
export const data = async (...args) => (await call(...args)).json();
export const snapshot = () => data("/__fixtures/recovery/state");
export const create = (body, expected, email, headers) => data("/api/app/bookings", body, expected, email, "POST", headers);
export async function authenticate(email) {
  await call("/api/auth/magic-links", { email }, 202);
  const link = await localMagicLink(origin);
  const signedIn = await confirmAuthLink(link.developmentLink);
  assert.equal(signedIn.status, 303); sessions.set(email, signedIn.headers.get("set-cookie").split(";")[0]);
}
export const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
export const effects = (state) => Object.fromEntries(["bookings", "booking_occurrences", "booking_history", "booking_answers", "booking_manage_tokens", "delivery_outbox", "operator_creation_receipts", "operator_creation_tombstones", "availability_requests", "fixture_events", "fixture_mail"].map((table) => [table, state[table]]));
export async function errorCode(response, code) { assert.equal((await response.json()).error.code, code); }
