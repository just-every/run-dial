import { evidencePath, evidenceDirectory } from "./evidence-path.mjs";
import { seedDemoWorkspace, localMagicLink, confirmAuthLink, bootstrapTestOwner } from "../tests/auth-client.mjs";
import { TEST_DEV_KEY } from "../tests/dev-key.mjs";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const port = 15700;
const origin = `http://127.0.0.1:${port}`;
const persist = await mkdtemp(resolve(tmpdir(), "dial-rendering-"));
const evidence = { clause: "BASE-ACCESS-002", runtime: "emitted workerd", responses: [], browser: {}, checks: [] };
let server;
let browser;
try {
  await run(["exec", "wrangler", "d1", "migrations", "apply", "dial-local", "--local", "--persist-to", persist, "--config", "dist/server/wrangler.json"]);
  server = spawn("pnpm", ["exec", "wrangler", "dev", "--config", "dist/server/wrangler.json", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "15739", "--persist-to", persist, "--var", "OWNER_EMAIL:operator@dial.test", "--var", "SETUP_TOKEN:dial-test-only-setup-token-at-least-32", "--var", "MAIL_FROM:no-reply@dial.test", "--var", "MAIL_PROVIDER:development", "--var", `RER_DEV_KEY:${TEST_DEV_KEY}`, "--var", "ENVIRONMENT:development", "--var", `APP_URL:${origin}`, "--var", "SESSION_SECRET:rendering-test-only-local-session-secret"], { stdio: "pipe", detached: true, env: { ...process.env, CI: "1" } });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt > 160) throw new Error(output.slice(-6000));
    try { if ((await fetch(origin + "/health")).ok) break; } catch { /* starting */ }
    await new Promise((done) => setTimeout(done, 125));
  }
  const session = await signIn();
  await seedDemoWorkspace(origin, session);
  for (const cookie of ["", "operator_session_local=forged", session]) {
    await record("api", cookie, "/api/app/profile", cookie === session ? 200 : 401);
    await record("document", cookie, "/app", cookie === session ? 200 : 302);
  }
  const original = await (await fetch(origin + "/api/app/profile", { headers: { cookie: session } })).json();
  let html = await (await fetch(origin + "/book/maya-chen")).text();
  assert.match(html, /Maya Chen/);
  assert.match(html, /Meet your host/);
  const changed = { ...original, biography: "Current D1 rendering probe" };
  delete changed.id; delete changed.createdAt; delete changed.updatedAt;
  assert.equal((await fetch(origin + "/api/app/profile", { method: "PATCH", headers: { cookie: session, "content-type": "application/json" }, body: JSON.stringify(changed) })).status, 200);
  html = await (await fetch(origin + "/book/maya-chen")).text();
  assert.match(html, /Current D1 rendering probe/);
  await fetch(origin + "/api/app/profile", { method: "PATCH", headers: { cookie: session, "content-type": "application/json" }, body: JSON.stringify(original) });
  evidence.checks.push("changed-D1 initial HTML", "native Hono HTTP authority");

  const resolver = (await readdir("dist/server/assets")).find((name) => name.includes("server-fn-resolver"));
  assert.ok(resolver);
  const manifest = await readFile("dist/server/assets/" + resolver, "utf8");
  const functionId = /"([a-f0-9]+)": \{\s*functionName: "loadPrivateShell_createServerFn_handler"/.exec(manifest)?.[1];
  assert.ok(functionId);
  for (const cookie of ["", "operator_session_local=forged", session]) {
    const response = await fetch(`${origin}/_serverFn/${functionId}`, { headers: { cookie, "x-tsr-serverFn": "true", "sec-fetch-site": "same-origin", origin, referer: origin + "/app" }, redirect: "manual" });
    const body = await response.text();
    evidence.responses.push({ transport: "generated GET", session: cookie === session ? "valid" : cookie ? "forged" : "missing", status: response.status, headers: safeHeaders(response.headers), body });
    if (cookie === session) { assert.match(body, /Maya Chen/); assert.match(body, /operator@dial.test/); }
    else { assert.doesNotMatch(body, /Maya Chen|operator@dial.test/); assert.match(body, /signin|redirect|session/i); }
  }
  await fetch(origin + "/api/auth/sign-out", { method: "POST", headers: { cookie: session, origin } });
  await record("revoked API", session, "/api/app/profile", 401);
  await record("revoked document", session, "/app", 302);
  const revokedFunction = await fetch(`${origin}/_serverFn/${functionId}`, { headers: { cookie: session, "x-tsr-serverFn": "true", "sec-fetch-site": "same-origin", origin, referer: origin + "/app" } });
  const revokedBody = await revokedFunction.text();
  assert.match(revokedBody, /signin|redirect|session/i); assert.doesNotMatch(revokedBody, /Maya Chen|operator@dial.test/);
  evidence.responses.push({ transport: "revoked generated GET", status: revokedFunction.status, body: revokedBody });

  for (const path of ["/missing-document", "/assets/missing.js", "/@vite/client", "/src/router.tsx", "/book/no-such-host"]) {
    await record("public 404", "", path, 404);
    await record("navigation 404", "", path, 404, { "sec-fetch-mode": "navigate" });
  }
  assert.equal(await new Promise((done, reject) => { const request = httpRequest(origin + "/", { headers: { host: "unsupported.test" } }, (response) => { response.resume(); done(response.statusCode); }); request.on("error", reject); request.end(); }), 404);
  const clientFiles = await readdir("dist/client/assets");
  for (const name of clientFiles.filter((name) => name.endsWith(".js"))) {
    const source = await readFile("dist/client/assets/" + name, "utf8");
    assert.doesNotMatch(source, /cloudflare:workers|rendering-test-only-local-session-secret|CREATE TABLE|access_token_ciphertext/);
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  page.setDefaultTimeout(15_000);
  const errors = [], failed = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => failed.push(request.url()));
  await page.goto(origin);
  await page.getByRole("link", { name: /View Maya Chen/ }).waitFor();
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("link", { name: /View Maya Chen/ }).click();
  await page.getByRole("heading", { name: "Maya Chen", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  await page.screenshot({ path: evidencePath("rendering-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: evidencePath("rendering-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1024 });
  console.log("Public SSR/hydration navigation passed; checking private navigation.");
  const browserSession = await signIn();
  await page.context().addCookies([{ name: "operator_session_local", value: browserSession.split("=")[1], url: origin }]);
  const privateResponse = await page.goto(origin + "/app");
  console.log("Private document", privateResponse.status(), page.url());
  await writeFile(evidencePath("private-document.html"), await page.content());
  await page.screenshot({ path: evidencePath("private-document.png"), fullPage: true });
  await page.getByRole("link", { name: "Event types", exact: true }).first().click();
  await page.getByRole("heading", { name: "Event types", exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  evidence.browser = { errors, failed, publicClientNavigation: true, viewport: [1440, 390] };
  console.log("BASE-ACCESS-002 emitted Worker rendering and transport checks passed.");
} finally {
  await browser?.close();
  if (server?.exitCode === null) { try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); } }
  await rm(persist, { recursive: true, force: true });
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(evidencePath("rendering.json"), JSON.stringify(evidence, null, 2) + "\n");
}
async function signIn() {
  await bootstrapTestOwner(origin);
  await fetch(origin + "/api/auth/magic-links", { method: "POST", headers: { Origin: origin, "content-type": "application/json" }, body: JSON.stringify({ email: "operator@dial.test" }) });
  const { developmentLink } = await localMagicLink(origin);
  const response = await confirmAuthLink(developmentLink);
  return response.headers.get("set-cookie").split(";")[0];
}
async function record(transport, cookie, path, expected, headers = {}) {
  const response = await fetch(origin + path, { headers: { cookie, ...headers }, redirect: "manual" });
  const body = await response.text();
  assert.equal(response.status, expected, `${transport} ${path}: ${body.slice(0, 500)}`);
  if (expected === 302) assert.match(response.headers.get("location"), /^\/signin\?next=/);
  evidence.responses.push({ transport, session: !cookie ? "missing" : cookie === "operator_session_local=forged" ? "forged" : "native", path, status: response.status, headers: safeHeaders(response.headers), body: body.slice(0, 1200) });
}
function safeHeaders(headers) { return Object.fromEntries([...headers].filter(([name]) => name !== "set-cookie")); }
function run(args) { return new Promise((done, reject) => { const child = spawn("pnpm", args, { stdio: "pipe", env: { ...process.env, CI: "1" } }); let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; }); child.on("exit", (code) => code === 0 ? done() : reject(new Error(output.slice(-6000)))); child.on("error", reject); }); }
