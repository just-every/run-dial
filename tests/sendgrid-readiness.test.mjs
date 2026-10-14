import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { build } from "esbuild";

const compiled = await build({ entryPoints: [new URL("../src/core/platform/mail/base-mail.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", write: false });
const { BaseMailSender } = await import(`data:text/javascript,${encodeURIComponent(compiled.outputFiles[0].text)}`);
const senderUrl = "https://api.sendgrid.com/v3/verified_senders";
const domainUrl = (offset = 0) => `https://api.sendgrid.com/v3/whitelabel/domains?limit=100&offset=${offset}`;
const config = { MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "synthetic-readiness-key", MAIL_FROM: "noreply@business.example" };
const validDomain = { domain: "business.example", valid: true };
const fullPage = Array.from({ length: 100 }, (_, index) => ({ domain: `unrelated-${index}.example`, valid: true }));

function probe(replies, overrides = {}) {
  const calls = [];
  const sender = new BaseMailSender(undefined, { ...config, ...overrides }, async (url, init) => {
    calls.push(url);
    assert.equal(init.method ?? "GET", "GET", "readiness must never dispatch mail");
    assert.ok(url === senderUrl || /^https:\/\/api\.sendgrid\.com\/v3\/whitelabel\/domains\?limit=100&offset=\d+$/.test(url));
    assert.equal(init.headers.authorization, `Bearer ${config.MAIL_API_KEY}`);
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
    const reply = replies[calls.length - 1];
    assert.notEqual(reply, undefined, "no extra request or transport retry");
    return typeof reply === "function" ? reply(url, init) : Response.json(reply);
  });
  return { sender, calls };
}
const fails = (code, retryable = false) => (error) => error.code === code && error.retryable === retryable;

test("NOTIFY-006 exact verified Single Sender returns before reading authenticated domains", async () => {
  const { sender, calls } = probe([{ results: [{ from_email: "NoReply@Business.Example", verified: true }] }]);
  assert.ok((await sender.checkConnection()).checkedAt);
  assert.deepEqual(calls, [senderUrl]);
});

test("NOTIFY-006 authenticated domain authorizes a no-reply sender absent from Single Sender results", async () => {
  for (const from of ["noreply@business.example", "No-Reply@BUSINESS.EXAMPLE"]) {
    const { sender, calls } = probe([{ results: [{ from_email: "another@business.example", verified: true }] }, [{ ...validDomain, domain: "Business.Example", id: 123, subdomain: "em123" }]], { MAIL_FROM: from });
    assert.ok((await sender.checkConnection()).checkedAt);
    assert.deepEqual(calls, [senderUrl, domainUrl()]);
  }
});

test("NOTIFY-006 authenticated-domain lookup follows documented limit/offset pages", async () => {
  const { sender, calls } = probe([{ results: [] }, fullPage, [validDomain]]);
  assert.ok((await sender.checkConnection()).checkedAt);
  assert.deepEqual(calls, [senderUrl, domainUrl(), domainUrl(100)]);
});

test("NOTIFY-006 domain lookup reaches the 3000th domain and stops at the account bound", async () => {
  for (const match of [false, true]) {
    const pages = Array.from({ length: 30 }, () => [...fullPage]);
    if (match) pages[29][99] = validDomain;
    const { sender, calls } = probe([{ results: [] }, ...pages]);
    if (match) assert.ok((await sender.checkConnection()).checkedAt);
    else await assert.rejects(sender.checkConnection(), fails("forbidden"));
    assert.deepEqual(calls, [senderUrl, ...Array.from({ length: 30 }, (_, index) => domainUrl(index * 100))]);
  }
});

test("NOTIFY-006 empty, unverified, unrelated and suffix domains cannot authorize a sender", async () => {
  for (const domains of [[], [{ ...validDomain, valid: false }], [{ domain: "unrelated.example", valid: true }], [{ domain: "sub.business.example", valid: true }], [{ domain: "example", valid: true }], [{ domain: "notbusiness.example", valid: true }], [{ domain: "business.example.attacker.example", valid: true }], [{ domain: "business.example.", valid: true }]]) {
    const { sender, calls } = probe([{ results: [{ from_email: config.MAIL_FROM, verified: false }] }, domains]);
    await assert.rejects(sender.checkConnection(), fails("forbidden"));
    assert.deepEqual(calls, [senderUrl, domainUrl()]);
  }
});

test("NOTIFY-006 malformed authenticated-domain responses fail closed", async () => {
  for (const domains of [null, {}, { results: [validDomain] }, [null], [{}], [{ domain: 123, valid: true }], [{ ...validDomain, valid: "true" }], [{ ...validDomain, valid: 1 }], [validDomain, null], [...fullPage, validDomain]]) {
    const { sender, calls } = probe([{ results: [] }, domains]);
    await assert.rejects(sender.checkConnection(), fails("invalid_provider_response"));
    assert.deepEqual(calls, [senderUrl, domainUrl()]);
  }
});

test("NOTIFY-006 malformed Single Sender responses never fall through to domain approval", async () => {
  for (const senders of [null, {}, [], { results: {} }, { results: [null] }, { results: [{ from_email: config.MAIL_FROM, verified: "true" }] }]) {
    const { sender, calls } = probe([senders]);
    await assert.rejects(sender.checkConnection(), fails("invalid_provider_response"));
    assert.deepEqual(calls, [senderUrl]);
  }
});

test("NOTIFY-006 missing configuration and non-no-reply addresses fail before provider calls", async () => {
  for (const overrides of [{ MAIL_API_KEY: undefined }, { MAIL_FROM: undefined }, { MAIL_FROM: "person@business.example" }, { MAIL_FROM: "noreply@a@business.example" }]) {
    const { sender, calls } = probe([], overrides);
    await assert.rejects(sender.checkConnection(), fails(overrides.MAIL_FROM ? "invalid_delivery_payload" : "missing_configuration"));
    assert.deepEqual(calls, []);
  }
});

for (const stage of ["single-sender", "domain", "second-page"]) {
  const prefix = stage === "single-sender" ? [] : stage === "domain" ? [{ results: [] }] : [{ results: [] }, fullPage];
  test(`NOTIFY-006 ${stage} HTTP errors preserve typed refusal without retries`, async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const { sender, calls } = probe([...prefix, () => new Response(null, { status })]);
      await assert.rejects(sender.checkConnection(), fails(status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "provider_unavailable", status >= 500));
      assert.equal(calls.length, prefix.length + 1);
    }
  });
  test(`NOTIFY-006 ${stage} invalid JSON and transport failures fail closed`, async () => {
    for (const reply of [() => new Response("not JSON"), () => { throw new Error("synthetic network failure"); }]) {
      const { sender, calls } = probe([...prefix, reply]);
      await assert.rejects(sender.checkConnection(), fails("provider_unavailable", true));
      assert.equal(calls.length, prefix.length + 1);
    }
  });
  for (const bodyStalled of [false, true]) {
    test(`NOTIFY-006 ${stage} stalled ${bodyStalled ? "body" : "request"} has a ten-second total deadline`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let signal;
      const { sender, calls } = probe([...prefix, (_url, init) => {
        signal = init.signal;
        return bodyStalled ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {});
      }]);
      const rejected = assert.rejects(sender.checkConnection(), fails("provider_timeout", true));
      await setImmediate();
      assert.ok(signal);
      t.mock.timers.tick(10_000);
      await rejected;
      assert.equal(signal.aborted, true);
      assert.equal(calls.length, prefix.length + 1);
    });
  }
}

test("NOTIFY-006 pagination shares one total deadline across successful reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let releaseSenders;
  let releaseDomains;
  let domainSignal;
  const { sender, calls } = probe([
    () => new Promise((resolve) => { releaseSenders = () => resolve(Response.json({ results: [] })); }),
    (_url, init) => new Promise((resolve) => { domainSignal = init.signal; releaseDomains = () => resolve(Response.json(fullPage)); }),
  ]);
  const rejected = assert.rejects(sender.checkConnection(), fails("provider_timeout", true));
  t.mock.timers.tick(6_000);
  releaseSenders();
  await setImmediate();
  assert.ok(domainSignal);
  t.mock.timers.tick(4_000);
  await rejected;
  assert.equal(domainSignal.aborted, true);
  releaseDomains();
  await setImmediate();
  assert.deepEqual(calls, [senderUrl, domainUrl()], "a late response cannot resume pagination after timeout");
});
