import assert from "node:assert/strict";
import { checkDoctor } from "../operations-command/fixture.mjs";
import { build } from "esbuild";

const root = new URL("../../", import.meta.url);
const compiled = await build({
  stdin: {
    contents: 'export { OperatorsService } from "./src/core/features/operators/service.ts"; export { parseRuntimeEnvironment } from "./src/core/shared/runtime-env.ts";',
    resolveDir: root.pathname,
  },
  bundle: true, write: false, platform: "node", format: "esm",
});
const { OperatorsService, parseRuntimeEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

export const foundation = {
  ENVIRONMENT: "production", APP_URL: "https://construction.example.test",
  SESSION_SECRET: "construction-fixture-session-".repeat(2),
};
export const complete = {
  ...foundation, OWNER_EMAIL: "operator@construction.example.test",
  SETUP_TOKEN: "construction-fixture-setup-".repeat(2), MAIL_PROVIDER: "sendgrid",
  MAIL_API_KEY: "construction-fixture-key", MAIL_FROM: "no-reply@construction.example.test",
};

export function ownerEmail(length) {
  return `${"o".repeat(64)}@${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(length - 198)}.test`;
}

// This exercises the actual lazy getter, including Dial's default Base mail
// construction. Guards forbid SQL and delivery; no application fixture is used.
export function nativeConstruction(env) {
  let runtime;
  try { runtime = parseRuntimeEnvironment(env); }
  catch { assert.fail("construction fixture must pass the maintained runtime parser"); }
  let databaseCalls = 0;
  let networkCalls = 0;
  const db = {
    prepare() { databaseCalls++; throw new Error("unexpected fixture database use"); },
    batch() { databaseCalls++; throw new Error("unexpected fixture database use"); },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { networkCalls++; throw new Error("unexpected fixture network use"); };
  try {
    const operators = new OperatorsService(db, runtime);
    const auth = operators.auth;
    assert.equal(typeof auth.requestMagicLink, "function");
    assert.equal(operators.auth, auth, "getter retains the native auth instance");
    return "accepted";
  } catch (error) {
    if (["invalid_configuration", "invalid_email", "invalid_api_key", "api_key_required"].includes(error.code)) return error.code;
    assert.fail("unexpected native construction failure; details suppressed");
  } finally {
    globalThis.fetch = originalFetch;
    assert.equal(databaseCalls, 0, "construction performs no database work");
    assert.equal(networkCalls, 0, "construction makes no provider request");
  }
}

export function checkOperations(env, ready) {
  return checkDoctor(env, ready).output.ok;
}
