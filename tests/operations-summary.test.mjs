import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { checkDoctor, operationsCommand } from './operations-command/fixture.mjs';

const complete = {
  ENVIRONMENT: 'production', APP_URL: 'https://dial.example.test',
  SESSION_SECRET: 'test-only-session-value-'.repeat(3), OWNER_EMAIL: 'owner@example.test',
  SETUP_TOKEN: 'test-only-setup-value-'.repeat(3), MAIL_PROVIDER: 'sendgrid',
  MAIL_FROM: 'no-reply@example.test', MAIL_API_KEY: 'test-only-provider-value',
};

contract('OPER-001', 'fresh operations check and describe use the maintained RER public commands before configuration', () => {
  const compatibility = operationsCommand({}, 'check', { entry: 'scripts/operations.mjs' });
  const native = operationsCommand({}, 'check');
  assert.equal(compatibility.status, 0);
  assert.equal(native.status, 0);
  assert.equal(compatibility.outcome.ok, true);
  assert.deepEqual(compatibility.outcome, native.outcome);
  const description = operationsCommand({}, 'describe', { entry: 'scripts/operations.mjs' });
  const nativeDescription = operationsCommand({}, 'describe');
  assert.equal(description.status, 0);
  // `rer describe` adds the repository commands (global/cli/describe.mjs); the project entry describes the project alone.
  const { repositoryCommands, ...nativeProject } = nativeDescription.output;
  assert.ok(repositoryCommands.dev);
  assert.deepEqual(description.output, nativeProject);
  assert.ok(description.output.verbs.setup);
  assert.ok(description.output.verbs.doctor);
});

contract('OPER-001', 'doctor distinguishes missing configuration from complete local prerequisites', () => {
  const missing = checkDoctor({}, false);
  assert.ok(missing.output.missingInputs.includes('APP_URL'));
  assert.ok(missing.output.sources.APP_URL);
  const completeResult = checkDoctor(complete, true);
  assert.equal(completeResult.output.missingInputs.length, 0);
});

contract('BASE-SECRET-001', 'doctor names missing origin without exposing supplied secrets', () => {
  const env = { ...complete };
  delete env.APP_URL;
  const result = checkDoctor(env, false);
  assert.ok(result.output.missingInputs.includes('APP_URL'));
});

contract('BASE-SECRET-002', 'doctor rejects invalid supplied secrets even with complete private settings and tools', () => {
  checkDoctor({ ...complete, SESSION_SECRET: 'test-only-short-secret' }, false);
});
