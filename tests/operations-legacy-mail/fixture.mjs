import assert from "node:assert/strict";
import { checkDoctor } from "../operations-command/fixture.mjs";
import { build } from "esbuild";

const root = new URL("../../", import.meta.url);
const compiled = await build({
  stdin: {
    contents: 'export { createAuthenticationMail } from "./src/core/platform/mail/base-mail.ts"; export { parseRuntimeEnvironment } from "./src/core/shared/runtime-env.ts";',
    resolveDir: root.pathname,
  },
  bundle: true, write: false, platform: "node", format: "esm",
});
const native = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
export const { parseRuntimeEnvironment } = native;
const { createAuthenticationMail } = native;

export const foundation = {
  ENVIRONMENT: "production", APP_URL: "https://legacy-mail.example.test",
  SESSION_SECRET: "legacy-mail-fixture-session-".repeat(2),
};
export const legacy = {
  ...foundation, RESEND_API_KEY: "legacy-mail-fixture-key",
  RESEND_FROM_EMAIL: "noreply@legacy-mail.example.test",
  RESEND_WEBHOOK_SECRET: "legacy-mail-fixture-webhook",
};
export const explicit = {
  ...legacy, OWNER_EMAIL: "operator@legacy-mail.example.test",
  SETUP_TOKEN: "legacy-mail-fixture-setup-".repeat(2), MAIL_PROVIDER: "sendgrid",
  MAIL_API_KEY: "explicit-mail-fixture-key", MAIL_FROM: "no-reply@legacy-mail.example.test",
};

export function nativeMail(env) {
  const runtime = parseRuntimeEnvironment(env);
  let databaseCalls = 0;
  let networkCalls = 0;
  const db = {
    prepare() { databaseCalls++; throw new Error("Unexpected database access"); },
    batch() { databaseCalls++; throw new Error("Unexpected database access"); },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { networkCalls++; throw new Error("Unexpected provider access"); };
  try {
    const sender = createAuthenticationMail(db, runtime);
    if (sender === undefined) return "absent";
    assert.equal(typeof sender.send, "function");
    return "accepted";
  } catch (error) {
    assert.ok(["invalid_api_key", "api_key_required"].includes(error.code), "only a native credential rejection is expected");
    return error.code;
  } finally {
    globalThis.fetch = originalFetch;
    assert.equal(databaseCalls, 0, "mail construction makes no database call");
    assert.equal(networkCalls, 0, "mail construction makes no provider call");
  }
}

export function checkOperations(env, valid, mailConfigured = true) {
  checkDoctor(env, valid && mailConfigured);
}
