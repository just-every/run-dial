import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../scripts/deploy.mjs";
import { prepare } from "../scripts/prepare.mjs";
import { hash } from "../modules/deploy-kit/validation.mjs";

test("reviewed inert plan binds setup/artifact identity; tampering fails before provider calls",async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"dial-plan-")));t.after(()=>rm(root,{recursive:true,force:true}));
  const code="export default {};";
  const artifact={version:1,source:{sha:"a".repeat(40),tree:"b".repeat(40)},run:{id:"130",attempt:"1"},main:"index.js",modules:[{path:"index.js",sha256:hash(code),base64:Buffer.from(code).toString("base64")}],assets:[],migrations:[]};
  const artifactBytes=JSON.stringify(artifact);
  const setup={version:1,ownerEmail:"operator@fixture.test",prefix:"rer-seedproof-dial",target:"https://rer-seedproof-dial.fixture-account.workers.dev",mailProvider:"sendgrid",mailFrom:"sender@fixture.test"};
  const env={RER_DIAL_SETUP:join(root,"setup.json"),RER_DEPLOY_ARTIFACT:join(root,"artifact.json"),RER_DEPLOY_PLAN:join(root,"plan.json"),RER_DEPLOY_RECEIPT:join(root,"receipt.json"),RER_DEPLOY_SOURCE_SHA:artifact.source.sha,RER_DEPLOY_RUN_ID:"130",RER_DEPLOY_RUN_ATTEMPT:"1",RER_DEPLOY_ARTIFACT_SHA256:hash(artifactBytes)};
  await writeFile(env.RER_DIAL_SETUP,JSON.stringify(setup));await writeFile(env.RER_DEPLOY_ARTIFACT,artifactBytes);
  const result=await main(["plan"],env);assert.equal(result.deployed,false);
  const plan=JSON.parse(await readFile(env.RER_DEPLOY_PLAN));assert.equal(plan.vars.OWNER_EMAIL,setup.ownerEmail);assert(!JSON.stringify(plan).includes("secret-value"));
  await assert.rejects(main(["deploy"],{...env,RER_DEPLOY_PLAN_SHA256:"f".repeat(64)}),/reviewed-plan-mismatch/);
  await assert.rejects(main(["plan"],{...env,RER_DEPLOY_SOURCE_SHA:"b".repeat(40)}),/artifact-custody-mismatch/);
  const changed={...plan,vars:{...plan.vars,OWNER_EMAIL:"changed@fixture.test"}};const bytes=JSON.stringify(changed);await writeFile(env.RER_DEPLOY_PLAN,bytes);
  await assert.rejects(main(["deploy"],{...env,RER_DEPLOY_PLAN_SHA256:hash(bytes)}),/reviewed-plan-mismatch/);
});
test("prepare refuses provider credentials and Node injection before any source/build work",async()=>{
  await assert.rejects(prepare({CF_THROWAWAY_API_TOKEN:"synthetic"}),/prepare-credential-environment-forbidden/);
  await assert.rejects(prepare({NODE_OPTIONS:"--inspect"}),/prepare-node-injection-forbidden/);
  await assert.rejects(prepare({}),/prepare-isolation-required/);
});
