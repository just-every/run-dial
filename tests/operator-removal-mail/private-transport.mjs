import assert from "node:assert/strict";
import { privateShellEndpoint } from "../start-transport.mjs";

// Exercise the compiler-generated HTTP endpoint, not the handler as a local call.
export async function verifyPrivateTransport({ origin, cookie }) {
  const { path } = await (await fetch(origin + "/__removal/private-function")).json();
  assert.ok(path.startsWith("/_serverFn/"), `Expected the actual generated function URL, received ${path}`);
  const endpoint = await privateShellEndpoint(path, origin);
  const headers = { "x-tsr-serverFn": "true", "sec-fetch-site": "same-origin", origin, referer: origin + "/app" };
  for (const [label, session] of [["missing", ""], ["forged", "operator_session_local=forged"], ["active", cookie]]) {
    const response = await fetch(endpoint, { headers: { ...headers, ...(session ? { cookie: session } : {}) }, redirect: "manual" });
    const body = await response.text();
    if (label === "active") {
      assert.equal(response.status, 200); assert.match(body, /Morgan Bell/); assert.match(body, /operator@dial.test/);
    } else {
      assert.doesNotMatch(body, /Morgan Bell|operator@dial.test|former-operator@example.test/, `${label} session must expose no private shell data`);
      assert.match(body, /signin/, `${label} session must receive the native sign-in redirect`);
    }
  }
  const signedOut = await fetch(origin + "/api/auth/sign-out", { method: "POST", headers: { cookie, origin }, redirect: "manual" });
  assert.ok(signedOut.ok);
  const revoked = await fetch(endpoint, { headers: { ...headers, cookie }, redirect: "manual" });
  const revokedBody = await revoked.text();
  assert.doesNotMatch(revokedBody, /Morgan Bell|operator@dial.test/); assert.match(revokedBody, /signin/);
  assert.equal((await fetch(origin + "/api/app/session", { headers: { cookie } })).status, 401);
}
