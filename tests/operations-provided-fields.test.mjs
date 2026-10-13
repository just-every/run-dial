import assert from "node:assert/strict";
import { checkDoctor, cliRepresentable } from "./operations-command/fixture.mjs";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
import { invalidConfigurationNames, validateConfiguration } from "../scripts/operations-config.mjs";

const root = new URL("../", import.meta.url);
const compiled = await build({ entryPoints: [new URL("src/core/shared/runtime-env.ts", root).pathname], bundle: true, write: false, platform: "node", format: "esm" });
const { parseRuntimeEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const foundation = {
  ENVIRONMENT: "production", APP_URL: "https://dial.example.test",
  SESSION_SECRET: "test-only-session-value-at-least-thirty-two-characters",
};
const owner = {
  OWNER_EMAIL: "owner@example.test", SETUP_TOKEN: "test-only-setup-value-at-least-thirty-two-characters",
  MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "test-only-mail-api-key", MAIL_FROM: "noreply@example.test",
};
const legacy = {
  RESEND_API_KEY: "test-only-legacy-api-key", RESEND_FROM_EMAIL: "no-reply@example.test",
  RESEND_WEBHOOK_SECRET: "test-only-legacy-webhook-secret",
};
const calendar = {
  GOOGLE_OAUTH_CLIENT_ID: "test-only-google-client-id", GOOGLE_OAUTH_CLIENT_SECRET: "test-only-google-client-secret",
  CALENDAR_WEBHOOK_SECRET: "test-only-calendar-webhook-at-least-thirty-two-characters",
};
const complete = { ...foundation, ...owner, MAIL_WEBHOOK_KEY: "test-only-mail-webhook-key", ...legacy, ...calendar };
const optionalNames = [
  "OWNER_EMAIL", "SETUP_TOKEN", "MAIL_PROVIDER", "MAIL_API_KEY", "MAIL_FROM", "MAIL_WEBHOOK_KEY",
  "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "CALENDAR_WEBHOOK_SECRET",
  "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET",
];
const nonStringMarker = "test-only-non-string-value-must-stay-private";

function check(env, valid, mailConfigured = true) {
  return checkDoctor(env, valid && mailConfigured).output;
}

function rejected(env, name, typed = false) {
  assert.throws(() => parseRuntimeEnvironment(env), error => error.message.includes(name), `runtime names ${name}`);
  assert.ok(invalidConfigurationNames(env).includes(name), `declared validation names ${name}`);
  if (typed && !cliRepresentable(env)) {
    assert.throws(() => validateConfiguration(env), error => !error.message.includes(nonStringMarker) && /values suppressed/.test(error.message));
  } else check(env, false);
}

contract("BASE-SECRET-002", "every supplied optional runtime field rejects a blank value in complete and foundation-only CLI inputs", () => {
  for (const name of optionalNames) {
    for (const env of [foundation, complete]) rejected({ ...env, [name]: "" }, name);
  }
  const local = { ...foundation, ...owner, ENVIRONMENT: "development", APP_URL: "http://127.0.0.1:8787", MAIL_PROVIDER: "development", MAIL_API_KEY: "" };
  rejected(local, "MAIL_API_KEY");
});

contract("BASE-SECRET-002", "required runtime fields reject blank or malformed values in the actual runtime and CLI", () => {
  for (const name of Object.keys(foundation)) rejected({ ...complete, [name]: "" }, name);
  rejected({ ...complete, ENVIRONMENT: "invalid-environment" }, "ENVIRONMENT");
  rejected({ ...complete, APP_URL: "test-only-invalid-origin" }, "APP_URL");
});

contract("BASE-SECRET-001", "native runtime and declared validation reject non-string bindings without disclosing their values", () => {
  for (const name of [...Object.keys(foundation), ...optionalNames]) {
    for (const value of [null, false, 0, { private: nonStringMarker }, [nonStringMarker]]) {
      rejected({ ...complete, [name]: value }, name, true);
    }
  }
});

contract("BASE-SECRET-002", "runtime and CLI enforce exact secret length boundaries without inventing stricter provider grammars", () => {
  for (const name of ["SESSION_SECRET", "SETUP_TOKEN", "CALENDAR_WEBHOOK_SECRET"]) {
    rejected({ ...complete, [name]: "test-only-short-secret-value-xx" }, name);
    const env = { ...complete, [name]: "test-only-exact-secret-value-xxx" };
    assert.equal(env[name].length, 32);
    assert.doesNotThrow(() => parseRuntimeEnvironment(env));
    assert.deepEqual(invalidConfigurationNames(env), []);
    check(env, true);
  }
  for (const name of ["MAIL_API_KEY", "MAIL_WEBHOOK_KEY", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET"]) {
    const env = { ...complete, [name]: "x" };
    assert.doesNotThrow(() => parseRuntimeEnvironment(env));
    assert.deepEqual(invalidConfigurationNames(env), []);
    check(env, true);
  }
  const env = { ...complete, MAIL_WEBHOOK_KEY: " " };
  assert.doesNotThrow(() => parseRuntimeEnvironment(env));
  assert.deepEqual(invalidConfigurationNames(env), []);
  check(env, true);
});

contract("BASE-SECRET-002", "optional bindings retain native validation while missing sign-in mail blocks readiness", () => {
  const local = { ...foundation, ...owner, ENVIRONMENT: "development", APP_URL: "http://localhost:8787", MAIL_PROVIDER: "development" };
  delete local.MAIL_API_KEY;
  for (const [env, mailConfigured] of [[foundation, false], [{ ...foundation, ...legacy }, true], [{ ...foundation, ...calendar }, false], [{ ...foundation, ...owner }, true], [local, true]]) {
    assert.doesNotThrow(() => parseRuntimeEnvironment(env));
    assert.deepEqual(invalidConfigurationNames(env), []);
    check(env, true, mailConfigured);
  }
  const env = { ...foundation, UNKNOWN_FROM_EMAIL: "help@example.test", UNKNOWN_BINDING: { private: nonStringMarker } };
  assert.deepEqual(parseRuntimeEnvironment(env), foundation);
  assert.deepEqual(invalidConfigurationNames(env), []);
  assert.doesNotThrow(() => validateConfiguration(env)); // Unknown typed bindings are a runtime input, not an OS CLI argument.
  const absent = { ...foundation, ...Object.fromEntries(optionalNames.map(name => [name, undefined])) };
  assert.doesNotThrow(() => parseRuntimeEnvironment(absent));
  assert.deepEqual(invalidConfigurationNames(absent), []);
});
