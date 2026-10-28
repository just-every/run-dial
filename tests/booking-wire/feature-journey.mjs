import { analyticsJourney } from "./analytics-journey.mjs";
import { pollJourney } from "./poll-journey.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { guestJourney } from "./guest-journey.mjs";
import { approvalJourney } from "./approval-journey.mjs";
import { approvalAccessJourney } from "./approval-access-journey.mjs";

// Each feature gets a fresh production Worker and an independent registration; only providers are synthetic.
const origin = process.env.DIAL_REVIEW_ORIGIN, feature = process.argv[2], checks = [];
const journeys = { analytics: analyticsJourney, guests: guestJourney, approval: approvalJourney, "approval-access": approvalAccessJourney };
assert.ok(Object.hasOwn(journeys, feature));
let cookie;
async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual" });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${path.replace(/\/manage\/[^/?]+/gu, "/manage/[redacted]")}: ${response.status}`);
  return response;
}
const data = async (...args) => (await call(...args)).json();
const state = () => data("/wire/state");
const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
const boot = await call("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Synthetic Dial Owner", returnTo: "/app" }, 303);
cookie = boot.headers.get("set-cookie").split(";")[0];
await data("/__fixtures/setup", {});
await data("/wire/control", { name: "google-conference", value: "success" });
const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
await journeys[feature]({ data, call, state, deliver, future, checks });
if(feature==="guests")await pollJourney({data,call,state,deliver,future,checks});
await writeFile(evidencePath(`${feature}-wire.json`), JSON.stringify({ checks, scope: "Production routes and services on native local D1; calendar and mail synthetic at the HTTP edge" }, null, 2));
console.log(`${feature} public-door journey passed.`);
