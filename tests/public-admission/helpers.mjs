import assert from "node:assert/strict";

export const origin = process.env.DIAL_PUBLIC_ADMISSION_ORIGIN ?? "http://127.0.0.1:15704";
assert.equal(new URL(origin).hostname, "127.0.0.1"); assert.equal(new URL(origin).port, "15704");
export async function call(path, body, expected = 200, headers = {}, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`); return response;
}
export const data = async (...args) => (await call(...args)).json();
export const state = () => data("/__fixtures/admission/state");
export const product = () => data("/__fixtures/status");
export const reset = () => call("/__fixtures/admission/reset", {}, 204);
export const expire = () => call("/__fixtures/admission/expire", { now: Date.now() + 3600001 }, 204);
export const admit = async (input) => (await data("/__fixtures/admission/admit", input)).results;
export const counts = (results) => results.reduce((total, result) => ({ ...total, [result.kind]: (total[result.kind] ?? 0) + 1 }), {});
