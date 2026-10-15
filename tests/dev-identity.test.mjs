import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { signInAs } from "../modules/operator-auth/dev/sign-in-as.mjs";
import { bootstrapTestOwner } from "./auth-client.mjs";
import { contractTitle } from "./contract.mjs";
import { TEST_DEV_KEY, devKeyHeaders } from "./dev-key.mjs";

const port = 15804;
const origin = `http://127.0.0.1:${port}`;

test(contractTitle("OPER-005", "local dev identity signs in as the owner and a persona only behind the checkout's key, through any proxy, and never survives it"), async (context) => {
  const state = await mkdtemp(resolve(tmpdir(), "dial-dev-identity-"));
  const server = spawn(process.execPath, ["tests/runtime-server.mjs"], {
    cwd: new URL("../", import.meta.url), stdio: "pipe", detached: true,
    env: { ...process.env, OWNER_EMAIL: "operator@dial.test", SETUP_TOKEN: "dial-test-only-setup-token-at-least-32", MAIL_FROM: "no-reply@dial.test", DIAL_PORT: String(port),
      DIAL_PERSIST_STATE_DIR: resolve(state, "d1"), DIAL_DEV_VARS_DIR: resolve(state, "vars"), DIAL_INSPECTOR_PORT: "15805",
      RER_DEV_ORIGIN: origin, RER_DEV_KEY: TEST_DEV_KEY, RER_DEV_IDENTITY: "on" },
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; }); server.stderr.on("data", (chunk) => { output += chunk; });
  const proxy = createServer((incoming, outgoing) => {
    // A tunnel or local proxy: the Worker sees the loopback Host it expects, so nothing about the request says it is remote.
    const upstream = httpRequest({ host: "127.0.0.1", port, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, host: `127.0.0.1:${port}` } }, (reply) => { outgoing.writeHead(reply.statusCode, reply.headers); reply.pipe(outgoing); });
    incoming.pipe(upstream);
  });
  context.after(async () => { proxy.close(); try { process.kill(-server.pid, "SIGTERM"); } catch { /* already stopped */ } await rm(state, { recursive: true, force: true }); });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt >= 480) throw new Error(`The dev runtime did not start: ${output.slice(-4000)}`);
    try { if ((await fetch(`${origin}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((done) => setTimeout(done, 125));
  }
  await new Promise((done) => proxy.listen(0, "127.0.0.1", done));
  const forwarded = `http://127.0.0.1:${proxy.address().port}`;
  await bootstrapTestOwner(origin);

  const surfaces = ["/auth/dev/enter?as=owner", "/__dev/personas"];
  for (const base of [origin, forwarded]) {
    for (const path of surfaces) assert.equal((await fetch(base + path, { redirect: "manual" })).status, 404, `${base}${path} without the key`);
    for (const path of surfaces) assert.equal((await fetch(base + path, { redirect: "manual", headers: { "x-rer-dev-key": "wrong-key-wrong-key-wrong-key-wrong-key-wrong-key" } })).status, 404, `${path} with a wrong key`);
  }
  assert.equal((await fetch(forwarded + "/__dev/personas", { headers: devKeyHeaders })).status, 200, "the key, not the network, is what admits a caller");

  const personas = await (await fetch(origin + "/__dev/personas", { headers: devKeyHeaders })).json();
  assert.deepEqual(personas.map((persona) => persona.as), ["owner", "co-host", "signed-out"]);
  assert.equal(personas[1].email, "co-host@dev.localhost");

  const session = async (cookie) => fetch(origin + "/api/app/session", { headers: cookie ? { cookie } : {} });
  const owner = await signInAs({ origin, key: TEST_DEV_KEY, as: "owner" });
  const ownerSession = await session(owner.header);
  assert.equal(ownerSession.status, 200);
  assert.equal((await ownerSession.json()).operator.email, "operator@dial.test");
  const sessionOnly = owner.cookies.filter((cookie) => cookie.name.startsWith("operator_session_local_")).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  assert.equal((await session(sessionOnly)).status, 401, "a dev session without the key's cookie is refused");

  const vars = await readFile(resolve(state, "vars/.dev.vars"), "utf8");
  const secret = /^SESSION_SECRET=(.+)$/m.exec(vars)[1];
  const proof = createHmac("sha256", secret).update("local-cli\0sign-in").digest("hex");
  const native = await fetch(origin + "/auth/local/cli-session", { method: "POST", redirect: "manual", headers: { origin, "content-type": "application/json", "x-rer-local-cli": proof }, body: "{}" });
  assert.equal(native.status, 303);
  const entered = await fetch(origin + "/auth/dev/enter?as=co-host", { redirect: "manual", headers: { ...devKeyHeaders, cookie: native.headers.get("set-cookie").split(";")[0] } });
  if (entered.status !== 303) {
    const response = await fetch(origin + "/api/app/operators", { headers: { cookie: native.headers.get("set-cookie").split(";")[0] } });
    const operators = await response.json();
    console.info(JSON.stringify({ personaResponse: entered.status, createdDespiteRefusal: operators.operators?.some(operator => operator.email === "co-host@dev.localhost") }));
  }
  assert.equal(entered.status, 303, await entered.text());
  const persona = { header: entered.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  assert.equal((await (await session(persona.header)).json()).operator.email, "co-host@dev.localhost");
  const operators = await (await fetch(origin + "/api/app/operators", { headers: { cookie: persona.header } })).json();
  assert.deepEqual(operators.operators.map((operator) => operator.email).sort(), ["co-host@dev.localhost", "operator@dial.test"], "the persona is a real operator");
  const invited = await fetch(origin + "/api/app/operators", { method: "POST", headers: { cookie: persona.header, origin, "content-type": "application/json" }, body: JSON.stringify({ email: "invited@dial.test" }) });
  assert.equal(invited.status, 201, "a dev session can change data through the booking coordinator");

  const left = await fetch(origin + "/auth/dev/enter?as=signed-out", { redirect: "manual", headers: { cookie: persona.header } });
  assert.equal(left.status, 303);
  assert.equal((await session(persona.header)).status, 401, "signing out revokes the dev session");
});
