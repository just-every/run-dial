import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evidencePath } from "../scripts/evidence-path.mjs";
import { startWebhookRuntime } from "./booking-wire/webhook-runtime.mjs";
import { confirmationBrandJourney } from "./booking-wire/correspondence-journey.mjs";

// This fixture supplies an already stored workspace mark. All configuration,
// bookings, asset reads and provider effects below use Dial's native doors.
test("workspace branding reaches built-in and edited confirmations once with frozen retries and plain look", async t => {
  const statePath = await mkdtemp(resolve(tmpdir(), "dial-mail-brand-"));
  const listener = createServer();
  await new Promise(done => listener.listen(0, "127.0.0.1", done));
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  const origin = `http://127.0.0.1:${port}`;
  let runtime;
  t.after(async () => { try { await runtime?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  runtime = await startWebhookRuntime({ state: statePath, port, origin });
  const mark = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48" viewBox="0 0 160 48"><rect width="160" height="48" rx="8" fill="#275b83"/><path d="M16 35 28 12l12 23h-8l-4-9-4 9z" fill="#ffffff"/></svg>';
  const markKey = `brand/${createHash("sha256").update(mark).digest("hex")}.svg`;
  const bucket = await runtime.getR2Bucket("FILES");
  await bucket.put(markKey, mark, { httpMetadata: { contentType: "image/svg+xml" } });
  const db = await runtime.getD1Database("DB");
  const colours = { background: "#ffffff", ink: "#1d1c1a", accent: "#275b83", buttonInk: "#ffffff" };
  await db.prepare("INSERT INTO site_looks(id,website_url,read_at,name,mark_asset,mark_source,colours_json,look,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'site',?,?)")
    .bind("synthetic-dial-901", "https://studio.example.test", "2026-01-01T12:00:00.000Z", "Synthetic Studio", markKey, "https://studio.example.test/mark.svg", JSON.stringify({ read: colours, used: colours, adjusted: [] }), "2026-01-01T12:00:00.000Z", "2026-01-01T12:00:00.000Z").run();
  let cookie;
  async function call(path, body, expected = 200, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(origin + path, { method, headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual" });
    assert.equal(response.status, expected, `${method} ${path.replace(/\/manage\/[^/?]+/gu, "/manage/[redacted]")}: ${response.status}`);
    return response;
  }
  const data = async (...args) => (await call(...args)).json();
  await data("/wire/init", {});
  const boot = await call("/auth/bootstrap", { token: "dial-test-only-setup-token-at-least-32", displayName: "Synthetic Dial Owner", returnTo: "/app" }, 303);
  cookie = boot.headers.get("set-cookie").split(";")[0];
  await data("/__fixtures/setup", {});
  const state = () => data("/wire/state");
  const deliver = async () => { await data("/__fixtures/deliver", {}); await data("/__fixtures/deliver", {}); };
  const checks = [];
  const proof = await confirmationBrandJourney({ data, call, state, deliver, future: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), checks, origin });
  for (const mail of proof) await writeFile(evidencePath(`confirmation-${mail.mode}-${mail.role}.html`), mail.html.replace(/(\/manage\/|\/api\/public\/manage\/)[^/?\s"'<>]+/gu, "$1[redacted]"));
  await writeFile(evidencePath("confirmation-mark.svg"), mark);
  await writeFile(evidencePath("booking-mail-branding.json"), JSON.stringify({ checks, scope: "Native booking and owner routes on local D1 and R2, synthetic SendGrid HTTP edge" }, null, 2));
});
