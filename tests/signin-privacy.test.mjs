import assert from "node:assert/strict";
import { after, before } from "node:test";
import { contract } from "./contract.mjs";
import { closeImplementation, code, deployed, endpoints, expectedBody, failingSender, fixture, local, unknown, wire } from "./signin-privacy/fixture.mjs";

let originalFetch;
before(() => { originalFetch = globalThis.fetch; globalThis.fetch = async () => assert.fail("sign-in privacy test attempted network access"); });
after(async () => { globalThis.fetch = originalFetch; await closeImplementation(); });

for (const path of endpoints) {
  for (const runtime of [local, deployed]) {
    contract("AUTH-001", `${path} retains normal ${runtime.ENVIRONMENT} native responses for admitted and unknown addresses`, async () => {
      const delivery = failingSender("accepted");
      const f = await fixture(runtime, runtime === deployed ? delivery.sender : undefined);
      try {
        const before = f.sessions();
        const absent = await wire(await f.send(path, { email: unknown }));
        const known = await wire(await f.send(path, { email: runtime.OWNER_EMAIL }));
        assert.equal(known.status, 202);
        assert.deepEqual(known.body, expectedBody(path, runtime));
        assert.deepEqual(known, absent);
        assert.equal(known.headers["set-cookie"], undefined);
        assert.equal(f.sessions(), before);
        assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM oa_tokens WHERE revoked_at IS NULL").get().n, 1);
        assert.equal(delivery.tokens.length, runtime === deployed ? 1 : 0);
        assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM rer_mail_development_outbox").get().n, runtime === local ? 1 : 0);
      } finally { f.close(); }
    });

    for (const result of ["throw", "rejected", "uncertain", "rate_limited", "missing", ...(runtime === deployed ? ["development"] : [])]) {
      contract("AUTH-001", `${path} conceals membership for ${runtime.ENVIRONMENT} ${result} delivery and preserves native revocation`, async () => {
        const delivery = failingSender(result);
        const f = await fixture(runtime, delivery.sender);
        try {
          const before = f.sessions();
          const absent = await wire(await f.send(path, { email: unknown }));
          assert.equal(delivery.tokens.length, 0);
          const known = await wire(await f.send(path, { email: runtime.OWNER_EMAIL }));
          assert.equal(delivery.tokens.length, 1, "exactly one provider invocation; no retry");
          assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM oa_tokens").get().n, 1);
          assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM oa_tokens WHERE revoked_at IS NOT NULL AND consumed_at IS NULL").get().n, 1);
          assert.equal(f.sessions(), before);
          assert.equal(known.headers["set-cookie"], undefined);
          const confirm = await f.send("/auth/confirm", { token: delivery.tokens[0] });
          assert.equal(confirm.status, 400);
          assert.equal(confirm.headers.get("set-cookie"), null);
          assert.equal(f.sessions(), before);
          assert.equal(delivery.tokens.length, 1);
          assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM rer_mail_development_outbox").get().n, 0);
          assert.equal(known.status, 202);
          assert.deepEqual(known.body, expectedBody(path, runtime));
          assert.deepEqual(known, absent, "anonymous status, body and headers must not disclose membership");
        } finally { f.close(); }
      });
    }
  }

  contract("AUTH-001", `${path} keeps uniform missing sender and from configuration failures`, async () => {
    for (const runtime of [{ ...deployed, MAIL_API_KEY: undefined }, { ...deployed, MAIL_FROM: undefined }, { ...local, MAIL_FROM: undefined }]) {
      const f = await fixture(runtime);
      try {
        const before = f.sessions();
        const responses = [];
        for (const email of [unknown, runtime.OWNER_EMAIL]) responses.push(await wire(await f.send(path, { email })));
        assert.deepEqual(responses[0], responses[1]);
        assert.equal(responses[0].status, 503);
        assert.equal(code(responses[0]), "mail_unavailable");
        assert.equal(responses[0].headers["set-cookie"], undefined);
        assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM oa_tokens").get().n, 0);
        assert.equal(f.sessions(), before);
      } finally { f.close(); }
    }
  });

  contract("AUTH-001", `${path} preserves origin, host, method, validation and client IP admission errors`, async () => {
    const delivery = failingSender("uncertain");
    const f = await fixture(deployed, delivery.sender);
    try {
      for (const [options, status, error] of [
        [{ headers: { origin: null } }, 403, "invalid_origin"],
        [{ headers: { origin: "https://other.example.test" } }, 403, "origin_not_allowed"],
        [{ headers: { "sec-fetch-site": "cross-site" } }, 403, "invalid_origin"],
        [{ headers: { host: "other.example.test" } }, 403, "invalid_host"],
        [{ headers: { "cf-connecting-ip": null } }, 503, "client_ip_unavailable"],
      ]) {
        for (const email of [unknown, deployed.OWNER_EMAIL]) {
          const response = await wire(await f.send(path, { email }, options));
          assert.equal(response.status, status); assert.equal(code(response), error);
        }
      }
      const invalid = await wire(await f.send(path, { email: "invalid" }));
      assert.equal(invalid.status, 400);
      assert.equal(code(invalid), path.startsWith("/api/") ? "invalid_request" : "invalid_email");
      assert.equal((await f.send(path)).status, path.startsWith("/api/") ? 404 : 405);
      assert.equal(delivery.tokens.length, 0);
      assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM oa_tokens").get().n, 0);
      assert.equal(f.sessions(), 1);
    } finally { f.close(); }
  });

  contract("AUTH-001", `${path} preserves native address rate limits after anonymous delivery failure`, async () => {
    const delivery = failingSender("uncertain");
    const f = await fixture(deployed, delivery.sender);
    try {
      for (let attempt = 0; attempt < 5; attempt++) for (const email of [unknown, deployed.OWNER_EMAIL]) await f.send(path, { email });
      const absent = await wire(await f.send(path, { email: unknown }));
      const known = await wire(await f.send(path, { email: deployed.OWNER_EMAIL }));
      assert.equal(known.status, 429); assert.equal(code(known), "rate_limited");
      assert.deepEqual(known, absent); assert.equal(delivery.tokens.length, 5);
      assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM oa_tokens WHERE revoked_at IS NULL").get().n, 0);
      assert.equal(f.sessions(), 1);
    } finally { f.close(); }
  });

  contract("AUTH-001", `${path} does not normalize unrelated native database failures`, async () => {
    const delivery = failingSender("accepted");
    const f = await fixture(deployed, delivery.sender);
    try {
      f.sqlite.exec("DROP TABLE oa_limits");
      for (const email of [unknown, deployed.OWNER_EMAIL]) {
        const response = await wire(await f.send(path, { email }));
        assert.equal(response.status, 503);
        assert.equal(code(response), path.startsWith("/api/") ? "runtime_unavailable" : "auth_unavailable");
        assert.equal(response.headers["set-cookie"], undefined);
      }
      assert.equal(delivery.tokens.length, 0); assert.equal(f.sessions(), 1);
    } finally { f.close(); }
  });
}

contract("AUTH-001", "inherited Base delivery fault remains internal while revoking the failed native token", async () => {
  const delivery = failingSender("uncertain");
  const f = await fixture(deployed, delivery.sender);
  try {
    const request = f.request("/auth/magic-link", {});
    assert.deepEqual(await f.operators.auth.requestMagicLink(request, { email: unknown }), { status: "accepted" });
    assert.equal(delivery.tokens.length, 0);
    await assert.rejects(f.operators.auth.requestMagicLink(request, { email: deployed.OWNER_EMAIL }), error => error.code === "mail_unavailable" && error.status === 503);
    assert.equal(delivery.tokens.length, 1);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM oa_tokens WHERE revoked_at IS NOT NULL").get().n, 1);
    assert.equal(f.sessions(), 1);
  } finally { f.close(); }
});
