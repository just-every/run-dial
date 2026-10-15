import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
/** Owner-side tooling obtains a real native session without manufacturing mail. */
export async function localOwnerCookie(origin, secret) {
  const proof = createHmac("sha256", secret).update("local-cli\0sign-in").digest("hex");
  const native = await fetch(origin + "/auth/local/cli-session", { method: "POST", redirect: "manual", headers: { origin, "content-type": "application/json", "x-rer-local-cli": proof }, body: "{}" });
  assert.equal(native.status, 303);
  return native.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
/** A second real local operator proves that a job ID grants no authority. */
export async function anotherHostedOwner(origin, { openUrl, secret, ownerGrant }) {
  const key = new URLSearchParams(new URL(openUrl).hash.slice(1)).get("rer-dev");
  const cookie = await localOwnerCookie(origin, secret);
  const entered = await fetch(origin + "/auth/dev/enter?as=co-host", { redirect: "manual", headers: { cookie, "x-rer-dev-key": key } });
  assert.equal(entered.status, 303);
  const token = await ownerGrant("co-host@dev.localhost");
  const confirmed = await fetch(origin + "/auth/owner-signin", { method: "POST", redirect: "manual", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token }) });
  assert.equal(confirmed.status, 303);
  const other = confirmed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await fetch(origin + "/auth/session", { headers: { cookie: other } });
  assert.equal(session.status, 200);
  const identity = await session.json();
  assert.equal(identity.kind, "native");
  assert.equal(identity.operator.email, "co-host@dev.localhost");
  return other;
}
