import test from "node:test";
import assert from "node:assert/strict";
import { checkDoctor } from "./operations-command/fixture.mjs";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup } from "../scripts/deployment/setup-inputs.mjs";
import { validateSetup } from "../scripts/setup/configuration.mjs";
import { contract } from "./contract.mjs";
const configuration = {version:1,ownerEmail:"owner@fixture.test",prefix:"rer-seedproof-dial",target:"https://rer-seedproof-dial.fixture-account.workers.dev",mailProvider:"sendgrid",mailFrom:"sender@fixture.test"};
const operationsEnvironment = {ENVIRONMENT:"production",APP_URL:configuration.target,SESSION_SECRET:"synthetic-session".repeat(3),OWNER_EMAIL:configuration.ownerEmail,SETUP_TOKEN:"synthetic-setup".repeat(3),MAIL_PROVIDER:"sendgrid",MAIL_FROM:configuration.mailFrom,MAIL_API_KEY:"synthetic-provider-key"};
test("setup collects supplied owner identity and refuses overwrite and mismatched deployment target",async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"dial-setup-")));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=join(root,"setup.json");
  const args=["--owner-email","NewOwner@fixture.test","--prefix",configuration.prefix,"--target",configuration.target,"--mail-from",configuration.mailFrom,"--output",output];
  assert.equal((await setup(args)).deployed,false);
  const saved=JSON.parse(await readFile(output,"utf8"));assert.equal(saved.ownerEmail,"newowner@fixture.test");
  assert(!JSON.stringify(saved).includes("SESSION_SECRET"));
  await assert.rejects(setup(args),{code:"EEXIST"});
  for(const target of ["http://rer-seedproof-dial.fixture-account.workers.dev","https://other.fixture-account.workers.dev","https://rer-seedproof-dial.fixture-account.workers.dev/path"]) assert.throws(()=>validateSetup({...configuration,target}),/invalid-workers-dev-target/);
});
contract("NOTIFY-006", "doctor accepts an ordinary sender and refuses an absent provider credential", () => {
  const env = operationsEnvironment;
  checkDoctor(env, true);
  checkDoctor({ ...env, MAIL_API_KEY: "" }, false);
});
