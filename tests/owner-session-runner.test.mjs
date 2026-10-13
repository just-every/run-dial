import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { contract } from "./contract.mjs";

// Loaded before the real CLI: any accidental network or child dispatch fails.
const tripwire = `import net from 'node:net'; import http from 'node:http'; import https from 'node:https'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const deny=()=>{throw new Error('offline-network-or-process-attempt');}; globalThis.fetch=deny; net.Socket.prototype.connect=deny; http.request=deny; http.get=deny; https.request=deny; https.get=deny; cp.execFileSync=deny; cp.spawn=deny; cp.spawnSync=deny; syncBuiltinESMExports();`;
const expected = {
  archive: ["disposable/archive.mjs"], prepare: ["disposable/prepare.mjs"], setup: ["disposable/setup.mjs"],
  plan: ["disposable/controller.mjs", "plan"], review: ["disposable/controller.mjs", "review"],
  deploy: ["disposable/controller.mjs", "deploy"], health: ["disposable/controller.mjs", "health"],
  inventory: ["disposable/controller.mjs", "inventory"], "teardown-plan": ["disposable/controller.mjs", "teardown-plan"],
  teardown: ["disposable/controller.mjs", "teardown-delete"], empty: ["disposable/listing.mjs"],
  prerequisites: ["owner-session/prerequisites.mjs"], bootstrap: ["owner-session/signin.mjs", "bootstrap"],
  signin: ["owner-session/signin.mjs", "signin"], configure: ["owner-session/configure.mjs"],
  requests: ["owner-session/requests.mjs"], "install-support": ["owner-session/secrets.mjs", "install-support"],
  "reconcile-support": ["owner-session/reconcile-support.mjs"], "reconcile-setup": ["owner-session/reconcile-setup.mjs"],
  "remove-setup": ["owner-session/secrets.mjs", "remove-setup"], live: ["owner-session/lifecycle.mjs", "run"],
  "manual-delete": ["owner-session/lifecycle.mjs", "manual-delete"], "continue-manual": ["owner-session/lifecycle.mjs", "continue-manual"],
  observe: ["owner-session/observe.mjs"],
};
function run(args) {
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(tripwire)}`, "scripts/owner-session/run.mjs", ...args], {
    encoding: "utf8", env: { PATH: process.env.PATH },
  });
}
contract("BASE-SECRET-001", "owner-session dry-run uses the actual dispatcher with no network, subprocess or private workspace", () => {
  for (const [command, argv] of Object.entries(expected)) {
    const result = run(["--dry-run", command, "sensitive-test-argument"]);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    const plan = JSON.parse(result.stdout);
    assert.deepEqual(plan.dispatch, argv);
    assert.equal(plan.command, command);
    assert.equal(plan.argumentCount, 1);
    assert.equal(plan.networkCalls, 0);
    assert.equal(plan.deployed, false);
    assert.equal(plan.liveProof, false);
    assert.doesNotMatch(result.stdout + result.stderr, /sensitive-test-argument/);
  }
});
contract("BASE-SECRET-001", "owner-session rejects unknown commands and requires an explicit private workspace for execution", () => {
  for (const args of [["--dry-run", "untrusted-sensitive-command"], ["live"]]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).ok, false);
    assert.doesNotMatch(result.stdout + result.stderr, /untrusted-sensitive-command|offline-network-or-process-attempt/);
  }
});
