import assert from "node:assert/strict";
import { checkDoctor } from "./operations-command/fixture.mjs";
import { contract } from "./contract.mjs";
import { invalidConfigurationNames } from "../scripts/operations-config.mjs";

const configuration = {
  PATH: process.env.PATH, ENVIRONMENT: "production", APP_URL: "https://dial.example.test",
  SESSION_SECRET: "test-session-secret-at-least-thirty-two-characters",
  OWNER_EMAIL: "operator@example.test", SETUP_TOKEN: "test-setup-token-at-least-thirty-two-characters",
  MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "test-private-mail-api-key",
};
const legacyConfiguration = {
  PATH: configuration.PATH, ENVIRONMENT: configuration.ENVIRONMENT, APP_URL: configuration.APP_URL,
  SESSION_SECRET: configuration.SESSION_SECRET,
  RESEND_API_KEY: "test-private-resend-api-key", RESEND_WEBHOOK_SECRET: "test-private-resend-webhook-secret",
};
function checkConfiguration(env) {
  const invalid = invalidConfigurationNames(env);
  const result = checkDoctor(env, invalid.length === 0);
  for (const key of ["MAIL_FROM", "RESEND_FROM_EMAIL", "UNKNOWN_FROM_EMAIL"]) {
    if (env[key]) assert.ok(!(result.stdout + result.stderr).includes(env[key]));
  }
  return { ...result, invalid };
}
function assertLocalOnly(output) {
  assert.equal(output.scope, "local-inputs-only");
}

function check(MAIL_FROM) {
  const result = checkConfiguration({ ...configuration, MAIL_FROM });
  assert.ok(!result.stdout.includes(MAIL_FROM));
  assert.ok(!result.stderr.includes(MAIL_FROM));
  return result;
}
contract("NOTIFY-006", "doctor refuses reply-capable senders with value-free remediation", () => {
  for (const sender of ["help@example.test", "noreply+alias@example.test", "other-noreply@example.test"]) {
    const result = check(sender);
    assert.equal(result.status, 3);
    assert.equal(result.output.ok, false);
    assert.deepEqual(result.invalid, ["MAIL_FROM"]);
    assert.match(result.stderr, /MAIL_FROM.*noreply@.*no-reply@/);
    assert.match(result.stderr, /set|use/i);
    assertLocalOnly(result.output);
  }
});
contract("NOTIFY-006", "doctor accepts both no-reply local parts without claiming provider readiness", () => {
  for (const sender of ["noreply@example.test", "no-reply@example.test", "No-Reply@EXAMPLE.test"]) {
    const result = check(sender);
    assert.equal(result.status, 0);
    assert.equal(result.output.ok, true);
    assert.deepEqual(result.invalid, []);
    assertLocalOnly(result.output);
  }
});
contract("NOTIFY-006", "doctor refuses reply-capable legacy senders with value-free remediation", () => {
  for (const sender of ["help@example.test", "noreply+alias@example.test", "other-noreply@example.test"]) {
    const result = checkConfiguration({ ...legacyConfiguration, RESEND_FROM_EMAIL: sender });
    assert.equal(result.status, 3);
    assert.equal(result.output.ok, false);
    assert.deepEqual(result.invalid, ["RESEND_FROM_EMAIL"]);
    assert.match(result.stderr, /RESEND_FROM_EMAIL.*noreply@.*no-reply@/);
    assert.match(result.stderr, /set|use/i);
    assertLocalOnly(result.output);
  }
});
contract("NOTIFY-006", "doctor accepts both legacy no-reply local parts without claiming provider readiness", () => {
  for (const sender of ["noreply@example.test", "no-reply@example.test", "No-Reply@EXAMPLE.test", "NOREPLY@EXAMPLE.test"]) {
    const result = checkConfiguration({ ...legacyConfiguration, RESEND_FROM_EMAIL: sender });
    assert.equal(result.status, 0);
    assert.equal(result.output.ok, true);
    assert.deepEqual(result.invalid, []);
    assertLocalOnly(result.output);
  }
});
contract("NOTIFY-006", "doctor requires an exact no-reply local part and a valid address on each active sender path", () => {
  for (const [env, key] of [[configuration, "MAIL_FROM"], [legacyConfiguration, "RESEND_FROM_EMAIL"]]) {
    for (const sender of ["no_reply@example.test", "noreply.example@example.test", "no-reply+alias@example.test", "noreply@extra@example.test", "noreply@example", "noreply@example.test\n"]) {
      const result = checkConfiguration({ ...env, [key]: sender });
      assert.equal(result.status, 3);
      assert.equal(result.output.ok, false);
      assert.deepEqual(result.invalid, [key]);
      assert.match(result.stderr, new RegExp(`${key}.*noreply@.*no-reply@`));
      assertLocalOnly(result.output);
    }
  }
  assert.equal(check("NOREPLY@EXAMPLE.test").status, 0);
});
contract("NOTIFY-006", "doctor checks the sender selected by the runtime when both namespaces are present", () => {
  const legacy = { ...legacyConfiguration, RESEND_FROM_EMAIL: "help@example.test" };
  const active = checkConfiguration({ ...legacy, ...configuration, MAIL_FROM: "no-reply@example.test" });
  assert.equal(active.status, 0);
  assert.equal(active.output.ok, true);
  assert.deepEqual(active.invalid, []);
  assertLocalOnly(active.output);

  const invalid = checkConfiguration({ ...legacyConfiguration, RESEND_FROM_EMAIL: "no-reply@example.test", ...configuration, MAIL_FROM: "help@example.test" });
  assert.equal(invalid.status, 3);
  assert.equal(invalid.output.ok, false);
  assert.deepEqual(invalid.invalid, ["MAIL_FROM"]);
  assert.match(invalid.stderr, /MAIL_FROM.*noreply@.*no-reply@/);
  assertLocalOnly(invalid.output);
});
contract("NOTIFY-006", "doctor never substitutes an unknown sender namespace for either supported sender", () => {
  for (const [env, key] of [[configuration, "MAIL_FROM"], [legacyConfiguration, "RESEND_FROM_EMAIL"]]) {
    const invalid = checkConfiguration({ ...env, [key]: "help@example.test", UNKNOWN_FROM_EMAIL: "noreply@example.test" });
    assert.equal(invalid.status, 3);
    assert.equal(invalid.output.ok, false);
    assert.deepEqual(invalid.invalid, [key]);
    assertLocalOnly(invalid.output);
    const valid = checkConfiguration({ ...env, [key]: "no-reply@example.test", UNKNOWN_FROM_EMAIL: "help@example.test" });
    assert.equal(valid.status, 0);
    assert.equal(valid.output.ok, true);
    assert.deepEqual(valid.invalid, []);
    assertLocalOnly(valid.output);
  }
});
