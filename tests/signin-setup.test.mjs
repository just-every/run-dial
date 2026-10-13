import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { contract } from "./contract.mjs";
import { render } from "./signin-setup/render.mjs";

const privateValues = {
  SETUP_TOKEN: "test-only-first-operator-setup-value",
  SESSION_SECRET: "test-only-first-operator-session-value",
  OWNER_EMAIL: "setup-owner@example.test",
};
const modes = [
  { name: "local", ENVIRONMENT: "development", APP_URL: "http://127.0.0.1:8787", MAIL_PROVIDER: "development", local: true },
  { name: "deployed", ENVIRONMENT: "production", APP_URL: "https://dial.example.test", MAIL_PROVIDER: "sendgrid", local: false },
  { name: "deployed with development mail configured", ENVIRONMENT: "production", APP_URL: "https://dial.example.test", MAIL_PROVIDER: "development", local: false },
];
const migrationRoot = new URL("../migrations/core/", import.meta.url);
const schema = (await Promise.all((await readdir(migrationRoot)).sort().filter(name => name.endsWith(".sql")).map(name => readFile(new URL(name, migrationRoot), "utf8")))).join("\n");

async function page(mode, { claimed = false, configured = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(schema);
    if (claimed) sqlite.exec("INSERT INTO oa_bootstrap (singleton, claim_id, claimed_at) VALUES (1, 'existing-owner-claim', 100)");
    const DB = { prepare: sql => ({ first: async () => sqlite.prepare(sql).get() ?? null }) };
    return await render({ ...privateValues, ...mode, DB, SETUP_TOKEN: configured ? privateValues.SETUP_TOKEN : undefined });
  } finally { sqlite.close(); }
}

function assertPrivacy({ html, options }, mode) {
  for (const value of Object.values(privateValues)) {
    assert.equal(html.includes(value), false, "rendered sign-in page must not disclose configured private values");
    assert.equal(JSON.stringify(options).includes(value), false, "serialized options must not disclose configured private values");
  }
  assert.equal(html.includes('href="/__dev/outbox"'), mode.local, "only the local mode may offer its outbox");
}

for (const mode of modes) {
  contract("AUTH-001", `${mode.name} first-operator UI explains the actual Base-derived setup token source`, async () => {
    const result = await page(mode);
    assert.equal(result.options.local, mode.local);
    assert.equal(result.options.setup, true);
    assert.equal(result.html.includes("Set up the first operator"), true);
    assert.equal(result.html.includes(result.options.setupInstructions), true, "retain the published Base instructions");
    const instructions = result.html.match(/<details\b[^>]*>.*?<p\b[^>]*>(.*?)<\/p>/s)?.[1].replace(/<!--.*?-->/gs, "");
    assert.ok(instructions?.includes("SETUP_TOKEN"), "displayed setup instructions must name SETUP_TOKEN");
    if (mode.local) assert.ok(instructions.includes(".dev.vars"), "local setup must identify .dev.vars");
    else {
      assert.ok(/SETUP_TOKEN.*value supplied.*deploy step/.test(instructions), "deployed setup must identify the value supplied to the deploy step");
      assert.equal(instructions.includes(".dev.vars"), false, "deployed setup must not point to a local file");
    }
    assert.ok(/<form[^>]*action="\/auth\/bootstrap"/.test(result.html), "retain the native bootstrap action");
    assert.ok(/<input(?=[^>]*name="token")(?=[^>]*type="password")[^>]*>/.test(result.html), "setup input remains a password field");
    assertPrivacy(result, mode);
  });
}

for (const state of [{ name: "durably claimed", claimed: true }, { name: "unconfigured", configured: false }]) {
  contract("AUTH-001", `${state.name} first-operator UI hides setup through the existing server guard in both modes`, async () => {
    for (const mode of modes) {
      const result = await page(mode, state);
      assert.equal(result.options.setup, false);
      for (const hidden of ["Set up the first operator", "SETUP_TOKEN", 'action="/auth/bootstrap"', 'name="token"']) {
        assert.equal(result.html.includes(hidden), false, "setup instructions and controls must be absent");
      }
      assertPrivacy(result, mode);
    }
  });
}
