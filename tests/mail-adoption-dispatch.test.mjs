import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

const compiled = await build({ entryPoints: ["src/core/platform/mail/base-mail.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { BaseMailSender } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const config = { MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "test-only", MAIL_FROM: "no-reply@example.test" };
const message = { idempotencyKey: "retained-command", to: "private@example.test", subject: "Private subject", text: "Private body", html: "<p>Private body</p>" };
// Persisted Dial envelopes predate provider serialization. Empty provider headers
// must not force a new fingerprint or clear an existing dispatch decision.
const priorEnvelope = { deliveryId: "retained-command", from: "no-reply@example.test", to: ["private@example.test"], subject: "Private subject", text: "Private body", html: "<p>Private body</p>" };
const priorHash = createHash("sha256").update(JSON.stringify(priorEnvelope)).digest("hex");

async function fixture(state) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(await readFile(new URL("../migrations/core/0017_base_mail_dispatch.sql", import.meta.url), "utf8"));
  sqlite.prepare("INSERT INTO base_mail_dispatch VALUES(?,?,?,?,?)").run(message.idempotencyKey, priorHash, state, null, "before-adoption");
  const prepare = (sql, values = []) => ({
    bind: (...args) => prepare(sql, args),
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return sqlite.prepare(sql).run(...values); },
  });
  return { sqlite, db: { prepare } };
}

contract("NOTIFY-005", "mail adoption preserves prior accepted, rejected and ambiguous dispatches without resending or exposing message bodies", async () => {
  for (const [state, code] of [["accepted", null], ["rejected", "permanent_delivery_failure"], ["uncertain", "mail_outcome_unknown"], ["invoking", "mail_outcome_unknown"]]) {
    const { sqlite, db } = await fixture(state);
    try {
      const before = sqlite.prepare("SELECT * FROM base_mail_dispatch").get();
      const sender = new BaseMailSender(db, config, () => assert.fail("retained dispatch made a provider request"));
      if (code) await assert.rejects(sender.send(message), error => error.code === code && error.retryable === false);
      else assert.deepEqual(await sender.send(message), { providerMessageId: null });
      assert.deepEqual(sqlite.prepare("SELECT * FROM base_mail_dispatch").get(), before);
      await assert.rejects(sender.send({ ...message, text: "Changed body" }), error => error.code === "invalid_delivery_payload" && !error.retryable);
      assert.doesNotMatch(JSON.stringify(before), /private@example|Private subject|Private body/);
    } finally { sqlite.close(); }
  }
});

contract("NOTIFY-005", "only a matching prior rate-limited dispatch retries once with both SendGrid body parts and no empty headers", async () => {
  const { sqlite, db } = await fixture("rate_limited");
  try {
    let calls = 0;
    const sender = new BaseMailSender(db, config, async (_url, init) => {
      calls++;
      const payload = JSON.parse(init.body);
      assert.equal(Object.hasOwn(payload, "headers"), false);
      assert.deepEqual(payload.content, [{ type: "text/plain", value: message.text }, { type: "text/html", value: message.html }]);
      return new Response(null, { status: 202 });
    });
    await assert.rejects(sender.send({ ...message, text: "Changed body" }), error => error.code === "invalid_delivery_payload" && !error.retryable);
    assert.equal(calls, 0);
    assert.deepEqual(await sender.send(message), { providerMessageId: null });
    assert.deepEqual(await sender.send(message), { providerMessageId: null });
    assert.equal(calls, 1);
    const row = sqlite.prepare("SELECT * FROM base_mail_dispatch").get();
    assert.equal(row.payload_hash, priorHash);
    assert.equal(row.state, "accepted");
    assert.doesNotMatch(JSON.stringify(row), /private@example|Private subject|Private body/);
  } finally { sqlite.close(); }
});
