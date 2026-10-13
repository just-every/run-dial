import { test } from "node:test";
import { checkDoctor } from "./operations-command/fixture.mjs";
const env = { ENVIRONMENT: "production", APP_URL: "https://dial.example.test", SESSION_SECRET: "synthetic-test-secret-that-is-long-enough" };
test("doctor checks required mail configuration and rejects private malformed origins", () => {
  checkDoctor(env, false);
  const configured = { ...env, OWNER_EMAIL: "owner@example.test", SETUP_TOKEN: "test-only-setup-token-".repeat(2),
    MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "test-only-mail-key", MAIL_FROM: "no-reply@example.test" };
  checkDoctor(configured, true);
  checkDoctor({ ...configured, SESSION_SECRET: "do-not-print-this", APP_URL: "https://user:private@dial.example.test" }, false);
});
test("doctor refuses invalid canonical origins and incomplete provider groups", () => {
  const configured = { ...env, OWNER_EMAIL: "owner@example.test", SETUP_TOKEN: "test-only-setup-token-".repeat(2),
    MAIL_PROVIDER: "sendgrid", MAIL_API_KEY: "test-only-mail-key", MAIL_FROM: "no-reply@example.test" };
  for (const APP_URL of ["http://dial.example.test", "file:///tmp/secret", "https://dial.example.test/path", "https://dial.example.test/?token=x", "https://dial.example.test/#x"])
    checkDoctor({ ...configured, APP_URL }, false);
  checkDoctor({ ...configured, RESEND_API_KEY: "synthetic" }, false);
  checkDoctor({ ...configured, GOOGLE_OAUTH_CLIENT_ID: "synthetic" }, false);
});
