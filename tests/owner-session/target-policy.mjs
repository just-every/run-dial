import {contract} from '../contract.mjs';
import assert from 'node:assert/strict';
import {assertTargetState,assertDisposableInputs} from '../../scripts/owner-session/target-policy.mjs';
import {selectOwned} from '../../scripts/owner-session/inventory-policy.mjs';
import {assertScreenshotSafe} from '../../scripts/owner-session/screenshot-policy.mjs';
import {receiptRawMime} from '../../scripts/owner-session/mime-proof.mjs';
import {dialPlan} from '../../scripts/deployment/plan.mjs';

const scope={account:'fixture-account',prefix:'proof-dial',ownerEmail:'qa@example.test',mailFrom:'noreply@example.test',mailProvider:'sendgrid'};
const origin='https://proof-dial.fixture.workers.dev';
const setup={version:1,prefix:scope.prefix,target:origin,ownerEmail:scope.ownerEmail,mailProvider:scope.mailProvider,mailFrom:scope.mailFrom};
const state={account:scope.account,prefix:scope.prefix,origin,ownerEmail:scope.ownerEmail,mailFrom:scope.mailFrom};
const plan=dialPlan({migrations:[]},setup),receipt={accountId:scope.account,worker:scope.prefix,origin,config:{vars:plan.vars}};

contract('BASE-SECRET-001','owner-session rejects foreign, non-HTTPS or receipt-divergent state',()=>{
 assert.equal(assertTargetState(state,receipt,scope),state);
 for(const patch of [{account:'other'},{prefix:'proof-other'},{origin:origin.replace('https:','http:')},{origin:origin+'/path'},{origin:origin.replace('.fixture.','.fixture.extra.')},{origin:origin.replace('.fixture.','.foreign.')}])assert.throws(()=>assertTargetState({...state,...patch},receipt,scope));
 for(const patch of [{accountId:'other'},{worker:'other'},{origin:'https://other.workers.dev'},{config:{vars:{...plan.vars,OWNER_EMAIL:'other@example.test'}}},{config:{vars:{...plan.vars,APP_URL:'https://other.workers.dev'}}}])assert.throws(()=>assertTargetState(state,{...receipt,...patch},scope));
});
contract('BASE-SECRET-001','native-derived owner-session plan stays inside the explicitly supplied resource and mail scope',()=>{
 assert.equal(assertDisposableInputs({setup,plan},state,scope),true);
 for(const mutate of [x=>{x.state.account='other';},x=>{x.plan.worker='other';},x=>{x.setup.prefix='other';},x=>{x.setup.target=origin.replace('https:','http:');},x=>{x.setup.ownerEmail='other@example.test';},x=>{x.setup.mailFrom='reply@example.test';},x=>{x.plan.vars.APP_URL='https://other.workers.dev';},x=>{x.plan.vars.MAIL_FROM='other@example.test';},x=>{x.plan.d1[0].name='unrelated-db';},x=>{x.plan.r2[0].name='unrelated-files';},x=>{x.plan.queues[0].name='unrelated-jobs';}]){
  const input=structuredClone({setup,plan,state});mutate(input);assert.throws(()=>assertDisposableInputs(input,input.state,scope));
 }
});
contract('BASE-SECRET-001','read-only inventory retains renamed receipt IDs and excludes foreign resources',()=>{
 for(const prefix of [undefined,'','/foreign'])assert.throws(()=>selectOwned({},[],prefix),/inventory-scope-required/);
 const known=[{resources:{d1:[{id:'known-db'}],queues:[{id:'known-q'}],r2:[{name:'known-bucket'}],durableObjects:[{id:'known-do'}]}}];
 const result=selectOwned({workers:[{id:scope.prefix},{id:'foreign-worker'}],d1:[{name:'renamed',uuid:'known-db'},{name:'foreign-db',uuid:'foreign'}],queues:[{queue_name:'renamed',queue_id:'known-q'}],r2:[{name:'known-bucket'}],namespaces:[{script:'renamed',id:'known-do',class:'BookingCoordinator'}]},known,scope.prefix);
 assert.deepEqual(result.workers,[{name:scope.prefix}]);assert.deepEqual(result.d1,[{name:'renamed',id:'known-db'}]);assert.equal(result.durableObjects[0].id,'known-do');assert.equal(result.queues.length,1);assert.equal(result.r2.length,1);
});
contract('BASE-SECRET-001','owner-session screenshots require the receipt origin and reject raw outboxes and visible capabilities',()=>{
 for(const path of ['/auth/confirm?token=synthetic-token','/app','/app/requests','/book/qa/proof','/book/qa/proof/request'])assert.equal(assertScreenshotSafe(origin+path,'Dial Confirm',origin),true);
 for(const path of ['/dev/outbox','/app/outbox','/signin'])assert.throws(()=>assertScreenshotSafe(origin+path,'Dial',origin),/document-not-approved/);
 for(const text of ['synthetic-token',origin+'/auth/confirm?token=synthetic-token','MIME-Version: 1.0\nContent-Type: multipart/alternative'])assert.throws(()=>assertScreenshotSafe(origin+'/auth/confirm?token=synthetic-token',text,origin),/sensitive-content/);
 assert.throws(()=>receiptRawMime({excerpt:'Message excerpt',rawUrl:'https://example.invalid/message'}),/raw-mime-unavailable/);
 assert.throws(()=>assertScreenshotSafe(origin+'/app','Dial',origin.replace('.fixture.','.foreign.')),/origin-not-approved/);
});
