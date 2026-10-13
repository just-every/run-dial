import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { request } from "@playwright/test";
import { capacityAudit } from "../tests/booking-axe/acceptance-capacity.mjs";
import { evidencePath } from "./evidence-path.mjs";

// HTTP only: Playwright APIRequestContext launches no Chromium or other browser.
const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752";
const client = await request.newContext();
const checks = [];
try {
  const bootstrap = await client.post(origin + "/auth/bootstrap", { headers: { Origin: origin }, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Capacity owner", returnTo: "/setup" }, maxRedirects: 0 });
  assert.equal(bootstrap.status(), 303);
  const fixture = await client.post(origin + "/__fixtures/setup", { data: {} });
  assert.equal(fixture.status(), 200);
  await capacityAudit({ request: client }, origin, await fixture.json(), checks);
} catch (error) {
  checks.push({ check: "capacity completion", passed: false, error: error.message }); throw error;
} finally {
  const environment = `Local workerd HTTP API; ${process.platform}/${process.arch}; Node ${process.version}; test-only calendar/mail adapters; 50 authenticated operator HTTP claims through native coordinator; no browser launched, live provider, or production capacity claim.`;
  await writeFile(evidencePath("capacity-audit.json"), JSON.stringify({ environment, checks }, null, 2));
  await writeFile(evidencePath("CAPACITY.md"), ["# Bounded local capacity audit", "", environment, "", "Command: `DIAL_ACCEPTANCE_CAPACITY=1 DIAL_EVIDENCE_DIR=<external evidence directory> nice -n 15 node --test --test-concurrency=1 tests/booking-axe.test.mjs`", "", ...checks.map(check => `- ${check.passed ? "PASS" : "FAIL"}: ${check.check}; ${JSON.stringify(check)}`)].join("\n") + "\n");
  await client.dispose();
}
