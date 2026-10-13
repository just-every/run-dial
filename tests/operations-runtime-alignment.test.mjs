import assert from "node:assert/strict";
import { checkDoctor } from "./operations-command/fixture.mjs";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
import { invalidConfigurationNames } from "../scripts/operations-config.mjs";

const root = new URL("../", import.meta.url);
const compiled = await build({ entryPoints: [new URL("src/core/shared/runtime-env.ts", root).pathname], bundle: true, write: false, platform: "node", format: "esm" });
const { parseRuntimeEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const foundation = {
  ENVIRONMENT: "production", APP_URL: "https://dial.example.test",
  SESSION_SECRET: "test-only-session-value-at-least-thirty-two-characters",
};
const active = {
  ...foundation, OWNER_EMAIL: "owner@example.test", SETUP_TOKEN: "test-only-setup-value-at-least-thirty-two-characters",
  MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "test-only-api-value", MAIL_FROM: "noreply@example.test",
};
const legacy = {
  ...foundation, RESEND_API_KEY: "test-only-legacy-api-value", RESEND_WEBHOOK_SECRET: "test-only-legacy-webhook-value",
  RESEND_FROM_EMAIL: "no-reply@example.test",
};
const malformedSenders = [
  "noreply@example!.test", "noreply@-example.test", "noreply@example..test", "noreply@example_test.test", "noreply@example.1",
];

function check(env, invalidNames, mailConfigured = true) {
  const result = checkDoctor(env, invalidNames.length === 0 && mailConfigured);
  assert.deepEqual(invalidConfigurationNames(env), invalidNames);
  for (const key of ["APP_URL", "SESSION_SECRET", "OWNER_EMAIL", "SETUP_TOKEN", "MAIL_API_KEY", "MAIL_FROM", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"])
    if (env[key]) assert.equal((result.stdout + result.stderr).includes(env[key]), false, "supplied values stay private");
  return result;
}

contract("BASE-SECRET-002", "doctor refuses an explicitly blank provider even with only foundation inputs or valid legacy credentials", () => {
  for (const configuration of [foundation, legacy, active]) {
    const env = { ...configuration, MAIL_PROVIDER: "" };
    assert.throws(() => parseRuntimeEnvironment(env), /Invalid runtime configuration: MAIL_PROVIDER/);
    check(env, ["MAIL_PROVIDER"]);
  }
});

contract("NOTIFY-006", "doctor refuses malformed active sender domains rejected by the actual runtime in each explicit mail mode", () => {
  for (const configuration of [active, { ...active, MAIL_PROVIDER: "resend" }, { ...active, ENVIRONMENT: "development", APP_URL: "http://127.0.0.1:8787", MAIL_PROVIDER: "development" }]) {
    for (const MAIL_FROM of malformedSenders) {
      const env = { ...configuration, MAIL_FROM };
      assert.throws(() => parseRuntimeEnvironment(env), /Invalid runtime configuration: MAIL_FROM/);
      const result = check(env, ["MAIL_FROM"]);
      assert.match(result.stderr, /MAIL_FROM.*noreply@.*no-reply@/);
    }
  }
});

contract("NOTIFY-006", "doctor refuses malformed legacy sender domains rejected by the actual runtime without requiring owner bootstrap inputs", () => {
  for (const RESEND_FROM_EMAIL of malformedSenders) {
    const env = { ...legacy, RESEND_FROM_EMAIL };
    assert.throws(() => parseRuntimeEnvironment(env), /Invalid runtime configuration: RESEND_FROM_EMAIL/);
    const result = check(env, ["RESEND_FROM_EMAIL"]);
    assert.match(result.stderr, /RESEND_FROM_EMAIL.*noreply@.*no-reply@/);
  }
});

contract("BASE-SECRET-002", "doctor applies runtime email grammar to supplied optional fields without treating absent fields as missing", () => {
  for (const name of ["OWNER_EMAIL", "MAIL_FROM", "RESEND_FROM_EMAIL"]) {
    const env = { ...foundation, [name]: "" };
    assert.throws(() => parseRuntimeEnvironment(env), new RegExp(`Invalid runtime configuration: ${name}`));
    check(env, [name]);
  }
  const invalidOwner = { ...active, OWNER_EMAIL: "owner@example!.test" };
  assert.throws(() => parseRuntimeEnvironment(invalidOwner), /Invalid runtime configuration: OWNER_EMAIL/);
  check(invalidOwner, ["OWNER_EMAIL"]);
  for (const [env, mailConfigured] of [[foundation, false], [legacy, true]]) {
    assert.doesNotThrow(() => parseRuntimeEnvironment(env));
    check(env, [], mailConfigured);
  }
});

contract("NOTIFY-006", "doctor validates supplied inactive legacy grammar while restricting no-reply policy to the active sender", () => {
  const invalid = { ...legacy, ...active, RESEND_FROM_EMAIL: "noreply@example!.test" };
  assert.throws(() => parseRuntimeEnvironment(invalid), /Invalid runtime configuration: RESEND_FROM_EMAIL/);
  check(invalid, ["RESEND_FROM_EMAIL"]);
  for (const MAIL_FROM of ["noreply@sub-domain.example.test", "No-Reply@EXAMPLE.test"]) {
    const env = { ...legacy, ...active, RESEND_FROM_EMAIL: "help@example.test", MAIL_FROM };
    assert.doesNotThrow(() => parseRuntimeEnvironment(env));
    const result = check(env, []);
    assert.doesNotMatch(result.stderr, /Set RESEND_FROM_EMAIL/);
  }
});
