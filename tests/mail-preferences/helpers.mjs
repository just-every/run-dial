import { localMagicLink, confirmAuthLink } from "../auth-client.mjs";
import assert from "node:assert/strict";

export const origin = process.env.DIAL_MAIL_PREFERENCES_ORIGIN ?? "http://127.0.0.1:15706";
assert.equal(new URL(origin).hostname, "127.0.0.1"); assert.equal(new URL(origin).port, "15706");
const sessions = new Map(); let connectingClient = 0;
export async function call(path, body, expected = 200, operatorEmail, method = body === undefined ? "GET" : "POST", extraHeaders = {}) {
  const client = connectingClient++;
  const response = await fetch(origin + path, { method, headers: { Origin: origin, "CF-Connecting-IP": `198.18.${Math.floor(client / 250)}.${client % 250 + 1}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(operatorEmail ? { cookie: sessions.get(operatorEmail) } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`); return response;
}
export const data = async (...args) => (await call(...args)).json();
export const snapshot = () => data("/__fixtures/status");
export const preferences = (email) => data("/api/app/mail/preferences", undefined, 200, email);
export const setMuted = (email, bookingMailMuted) => data("/api/app/mail/preferences", { bookingMailMuted }, 200, email, "PUT");
export async function authenticate(email) {
  await call("/api/auth/magic-links", { email }, 202);
  const link = await localMagicLink(origin);
  const signedIn = await confirmAuthLink(link.developmentLink);
  assert.equal(signedIn.status, 303); sessions.set(email, signedIn.headers.get("set-cookie").split(";")[0]);
}
export const payload = (row) => JSON.parse(row.payload_json);
export const sentKeys = (state) => new Set(state.fixture_mail.map((row) => row.key));
export function providerId(state, outboxId) {
  return state.delivery_attempts.filter((row) => row.outbox_id === outboxId).sort((left, right) => left.attempt_number - right.attempt_number).at(-1)?.provider_message_id;
}
export const processOne = (id) => data("/__fixtures/deliver", { id });
export const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
export const control = (kind, failure = false) => call("/__fixtures/control", { kind, failure }, 204);
export async function due(id) { await call("/__fixtures/due", { id }, 204); await processOne(id); }
