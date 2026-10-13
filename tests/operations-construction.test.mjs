import assert from "node:assert/strict";
import { contract } from "./contract.mjs";
import { cliRepresentable } from "./operations-command/fixture.mjs";
import { invalidConfigurationNames, validateConfiguration } from "../scripts/operations-config.mjs";
import { checkOperations, complete, foundation, nativeConstruction, ownerEmail } from "./operations-construction/fixture.mjs";

function rejected(cases, name, nativeCode) {
  for (const env of cases) {
    assert.equal(nativeConstruction(env), nativeCode, "actual auth getter rejects the parser-accepted input");
    assert.deepEqual(invalidConfigurationNames(env), [name]);
    assert.throws(() => validateConfiguration(env), /values suppressed/);
    if (cliRepresentable(env)) checkOperations(env, false);
  }
}

function accepted(env) {
  assert.equal(nativeConstruction(env), "accepted");
  assert.deepEqual(invalidConfigurationNames(env), []);
  assert.equal(checkOperations(env, true), true);
}

for (const name of ["SESSION_SECRET", "SETUP_TOKEN"]) {
  contract("BASE-SECRET-002", `doctor refuses ${name} above the native construction limit`, () => {
    rejected([{ ...complete, [name]: "c".repeat(1025) }], name, "invalid_configuration");
  });
}

contract("BASE-SECRET-002", "doctor accepts both native auth secret boundaries", () => {
  for (const name of ["SESSION_SECRET", "SETUP_TOKEN"]) {
    for (const length of [32, 1024]) accepted({ ...complete, [name]: "c".repeat(length) });
  }
});

contract("BASE-SECRET-002", "doctor refuses the first owner mailbox above the native length limit", () => {
  assert.equal(ownerEmail(255).length, 255);
  rejected([{ ...complete, OWNER_EMAIL: ownerEmail(255) }], "OWNER_EMAIL", "invalid_email");
});

contract("BASE-SECRET-002", "doctor accepts the longest native owner mailbox", () => {
  assert.equal(ownerEmail(254).length, 254);
  accepted({ ...complete, OWNER_EMAIL: ownerEmail(254) });
});

for (const provider of ["sendgrid", "resend"]) {
  contract("BASE-SECRET-002", `doctor refuses oversized active ${provider} credentials rejected during auth construction`, () => {
    rejected([{ ...complete, MAIL_PROVIDER: provider, MAIL_API_KEY: "k".repeat(4097) }], "MAIL_API_KEY", "invalid_api_key");
  });

  contract("BASE-SECRET-002", `doctor refuses whitespace and controls in active ${provider} credentials`, () => {
    const separators = [" ", "\t", "\r", "\n", "\u00a0", "\u2003", "\u2028", "\u2029", "\uFEFF",
      ...Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)), String.fromCharCode(127)];
    rejected([...new Set(separators)].map(separator => ({
      ...complete, MAIL_PROVIDER: provider, MAIL_API_KEY: `fixture${separator}credential`,
    })), "MAIL_API_KEY", "invalid_api_key");
  });

  contract("BASE-SECRET-002", `doctor accepts native ${provider} credential boundaries`, () => {
    for (const length of [1, 4096]) accepted({ ...complete, MAIL_PROVIDER: provider, MAIL_API_KEY: "k".repeat(length) });
  });
}

for (const environment of ["development", "preview"]) {
  contract("BASE-SECRET-002", `doctor refuses remote HTTP origins rejected by native ${environment} auth`, () => {
    rejected([{ ...complete, ENVIRONMENT: environment, APP_URL: "http://remote.construction.example.test" }], "APP_URL", "invalid_configuration");
  });
}

contract("BASE-SECRET-002", "doctor accepts non-production loopback HTTP and remote HTTPS origins", () => {
  for (const ENVIRONMENT of ["development", "preview"]) {
    for (const APP_URL of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787", "https://remote.construction.example.test"])
      accepted({ ...complete, ENVIRONMENT, APP_URL });
  }
  accepted(complete);
});

contract("BASE-SECRET-002", "inactive development credentials remain parser-only inputs", () => {
  for (const MAIL_API_KEY of [undefined, "k".repeat(4097), "unused credential\tvalue"]) {
    const env = { ...complete, ENVIRONMENT: "development", APP_URL: "http://localhost:8787", MAIL_PROVIDER: "development" };
    if (MAIL_API_KEY !== undefined) env.MAIL_API_KEY = MAIL_API_KEY;
    else delete env.MAIL_API_KEY;
    accepted(env);
  }
});

contract("BASE-SECRET-002", "foundation-only inputs retain native validation while required sign-in mail blocks readiness", () => {
  for (const env of [foundation, { ...foundation, SESSION_SECRET: "c".repeat(1024) }, { ...foundation, UNKNOWN_BINDING: "ignored construction fixture" }]) {
    assert.deepEqual(invalidConfigurationNames(env), []);
    assert.equal(checkOperations(env, false), false);
  }
  const oversized = { ...foundation, SESSION_SECRET: "c".repeat(1025) };
  assert.deepEqual(invalidConfigurationNames(oversized), ["SESSION_SECRET"]);
  assert.equal(checkOperations(oversized, false), false);
});
