import { localMagicLink, confirmAuthLink } from "../auth-client.mjs";
import assert from "node:assert/strict";

export const origin = process.env.DIAL_AVAILABILITY_DIAGNOSTICS_ORIGIN ?? "http://127.0.0.1:15701";
assert.equal(new URL(origin).hostname, "127.0.0.1"); assert.equal(new URL(origin).port, "15701");
let session, connectingClient = 0;
export async function call(path, body, expected = 200, authenticated = false, method = body === undefined ? "GET" : "POST", headers = {}) {
  const client = connectingClient++;
  const response = await fetch(origin + path, { method, headers: { Origin: origin, "CF-Connecting-IP": `198.18.${Math.floor(client / 250)}.${client % 250 + 1}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(authenticated ? { cookie: session } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${path}: expected ${JSON.stringify(expected)}, got ${response.status}: ${await response.clone().text()}`); return response;
}
export const data = async (...args) => (await call(...args)).json();
export const snapshot = () => data("/__fixtures/diagnostics/state");
export const productRecords = (state) => Object.fromEntries(Object.entries(state).filter(([table]) => !table.startsWith("fixture_")).map(([table, rows]) => [table, [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))]));
export async function authenticate(email) {
  await call("/api/auth/magic-links", { email }, 202);
  const link = await localMagicLink(origin), signedIn = await confirmAuthLink(link.developmentLink);
  assert.equal(signedIn.status, 303); session = signedIn.headers.get("set-cookie").split(";")[0];
}
export async function authenticateViaSyntheticMail(email) {
  const before = (await snapshot()).fixture_mail;
  await call("/api/auth/magic-links", { email }, 202);
  const messages = (await snapshot()).fixture_mail.filter((row) => !before.some((prior) => prior.key === row.key));
  assert.equal(messages.length, 1);
  const message = JSON.parse(messages[0].message_json);
  assert.equal(message.to, email); assert.equal(message.subject, "Your sign-in link for Dial");
  const link = message.text.match(/http:\/\/127\.0\.0\.1:15701\/auth\/confirm\?token=[^\s]+/)?.[0];
  assert.ok(link, "task-owned synthetic sign-in mail contains the real native verification link");
  const signedIn = await confirmAuthLink(link);
  assert.equal(signedIn.status, 303); session = signedIn.headers.get("set-cookie").split(";")[0];
}
export const control = (failure, delayMs = 0) => call("/__fixtures/control", { kind: "busy", failure, delayMs }, 204);
export const setBusy = (intervals = []) => call("/__fixtures/diagnostics/busy", { intervals }, 204);
export const privateBusy = (startAt, endAt) => ({ startAt, endAt, summary: "Secret external offsite", providerEventId: "private-provider-event-identity", attendeeEmail: "private-external-attendee@dial.test" });
