import assert from "node:assert/strict";
import { contract } from "./contract.mjs";
import { cliRepresentable } from "./operations-command/fixture.mjs";
import { invalidConfigurationNames, validateConfiguration } from "../scripts/operations-config.mjs";
import { checkOperations, explicit, foundation, legacy, nativeMail, parseRuntimeEnvironment } from "./operations-legacy-mail/fixture.mjs";

function rejected(env) {
  assert.equal(nativeMail(env), "invalid_api_key", "actual parser and mail factory reject the selected legacy credential");
  if (cliRepresentable(env)) checkOperations(env, false);
  assert.deepEqual(invalidConfigurationNames(env), ["RESEND_API_KEY"]);
  assert.throws(() => validateConfiguration(env), /^Error: Invalid local configuration; values suppressed$/);
}

function accepted(env, nativeResult = "accepted") {
  assert.equal(nativeMail(env), nativeResult);
  checkOperations(env, true, nativeResult !== "absent");
  assert.deepEqual(invalidConfigurationNames(env), []);
  assert.doesNotThrow(() => validateConfiguration(env));
}

contract("BASE-SECRET-002", "doctor rejects an oversized selected legacy Resend key without MAIL_PROVIDER", () => {
  rejected({ ...legacy, RESEND_API_KEY: "l".repeat(4097) });
});

contract("BASE-SECRET-002", "doctor rejects whitespace and controls in selected legacy Resend keys", () => {
  const separators = [" ", "\t", "\r", "\n", "\u00a0", "\u2003", "\u2028", "\u2029", "\uFEFF",
    ...Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)), String.fromCharCode(127)];
  for (const separator of new Set(separators)) rejected({ ...legacy, RESEND_API_KEY: `legacy${separator}fixture` });
});

contract("BASE-SECRET-002", "doctor accepts selected legacy Resend credential boundaries without requiring owner bootstrap", () => {
  for (const length of [1, 4096]) accepted({ ...legacy, RESEND_API_KEY: "l".repeat(length) });
  accepted(legacy);
});

for (const provider of ["sendgrid", "resend"]) {
  contract("BASE-SECRET-002", `doctor keeps supplied inactive legacy keys parser-only with explicit ${provider}`, () => {
    for (const RESEND_API_KEY of ["l".repeat(4097), "unused legacy\tcredential"])
      accepted({ ...explicit, MAIL_PROVIDER: provider, RESEND_API_KEY, RESEND_FROM_EMAIL: "help@legacy-mail.example.test" });
    const invalidActive = { ...explicit, MAIL_PROVIDER: provider, MAIL_API_KEY: "invalid active credential" };
    assert.equal(nativeMail(invalidActive), "invalid_api_key");
    checkOperations(invalidActive, false);
    assert.deepEqual(invalidConfigurationNames(invalidActive), ["MAIL_API_KEY"]);
  });
}

contract("BASE-SECRET-002", "development mail construction ignores supplied inactive credential construction limits", () => {
  accepted({ ...explicit, ENVIRONMENT: "development", APP_URL: "http://localhost:8787", MAIL_PROVIDER: "development",
    MAIL_API_KEY: "inactive explicit credential", RESEND_API_KEY: "l".repeat(4097) });
});

contract("BASE-SECRET-002", "supplied inactive legacy keys still obey runtime field grammar", () => {
  for (const RESEND_API_KEY of ["", null, false, 42]) {
    const env = { ...explicit, RESEND_API_KEY };
    assert.throws(() => parseRuntimeEnvironment(env), /Invalid runtime configuration: RESEND_API_KEY/);
    if (cliRepresentable(env)) checkOperations(env, false);
    assert.deepEqual(invalidConfigurationNames(env), ["RESEND_API_KEY"]);
    assert.throws(() => validateConfiguration(env), /values suppressed/);
  }
});

contract("BASE-SECRET-002", "foundation-only absence keeps native mail unconfigured and blocks required sign-in readiness", () => {
  accepted(foundation, "absent");
  accepted({ ...foundation, UNKNOWN_MAIL_API_KEY: "unused unknown credential", UNKNOWN_MAIL_PROVIDER: "resend" }, "absent");
  accepted({ ...legacy, UNKNOWN_MAIL_API_KEY: "unused unknown credential" });
});
