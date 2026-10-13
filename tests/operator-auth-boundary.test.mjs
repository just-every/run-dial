import assert from "node:assert/strict";
import { contract } from "./contract.mjs";
import { confirmAuthLink } from "./auth-client.mjs";
import { origin, startRuntime } from "./operator-management/runtime.mjs";

contract("AUTH-001", "direct Base administrative aliases cannot mutate authority and fixture capture never returns stale or unrelated mail", async context => {
  const runtime = await startRuntime(context);
  const call = (path, body, cookie) => fetch(origin + path, {
    method: body === undefined ? "GET" : "POST", redirect: "manual",
    headers: { Origin: origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const capture = async (email, cookie) => {
    const response = await call("/__test/signin", { email }, cookie);
    assert.equal(response.status, 200);
    return (await response.json()).link;
  };
  await call("/__test/setup", {});
  const first = await capture("setup@example.test");
  const signed = await confirmAuthLink(first);
  assert.equal(signed.status, 303);
  const cookie = signed.headers.get("set-cookie").split(";")[0];
  const newer = await capture("setup@example.test", cookie);
  assert.ok(newer && newer !== first, "repeated issue returns a new Base capture");
  assert.equal(await capture("unknown@example.test", cookie), undefined, "unknown recipient cannot obtain another recipient's capture");
  const email = "pending-boundary@example.test";
  const invited = await call("/api/app/operators", { email }, cookie);
  assert.equal(invited.status, 201);
  const invitation = await invited.json();
  assert.equal(invitation.invitation, "not_deliverable", "fixture sign-in plumbing leaves the unconfigured application provider intact");
  const target = invitation.operator.id;
  const invitationLink = await capture(email, cookie);
  assert.ok(invitationLink && invitationLink !== newer, "invitation capture belongs to the requested identity");
  const joined = await confirmAuthLink(invitationLink);
  assert.equal(joined.status, 303);
  const oldCookie = joined.headers.get("set-cookie").split(";")[0];
  assert.equal((await (await call("/api/app/session", undefined, oldCookie)).json()).operator.id, target);
  const link = await capture(email, cookie);
  assert.ok(link && link !== invitationLink, "the active operator also has an unused native capability");
  const authority = () => runtime.query("SELECT 'operator' AS kind,id,status,version,NULL AS ended FROM oa_operators UNION ALL SELECT 'cancellation',operator_id,NULL,operator_version,NULL FROM oa_invitation_cancellations UNION ALL SELECT 'session',id,NULL,operator_version,revoked_at FROM oa_sessions UNION ALL SELECT 'token',id,kind,operator_version,revoked_at FROM oa_tokens ORDER BY kind,id");
  // Queued mail of either recipient role is local personal data at this address.
  // These rows have no invitee record; genuine overlap is held for privacy erasure.
  await runtime.sql(`INSERT INTO delivery_outbox (id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) VALUES
    ('pending-operator','mail_send','pending-operator','{"to":"${email}","recipientRole":"operator"}','pending',0,'2000','2000','2000'),
    ('pending-invitee','mail_send','pending-invitee','{"to":"${email}","recipientRole":"invitee"}','pending',0,'2000','2000','2000')`);
  const mailState = () => runtime.query("SELECT id,state,last_error_code,json_extract(payload_json,'$.operatorAccessRevoked') AS revoked FROM delivery_outbox WHERE id LIKE 'pending-%' ORDER BY id");
  const queued = await mailState();
  const before = JSON.stringify(await authority());
  for (const [path, body] of [
    ["/auth/invite/cancel", { operatorId: target }],
    ["/auth/invite", { email: "bypass@example.test", role: "owner" }],
    ["/auth/operator/status", { operatorId: target, status: "inactive" }],
    ["/auth/operator/role", { operatorId: target, role: "operator" }],
  ]) {
    const denied = await call(path, body, cookie);
    assert.equal(denied.status, 404);
    assert.equal(await denied.text(), "Not found");
    assert.equal(JSON.stringify(await authority()) === before, true, "denied alias leaves authority, tokens, sessions and cancellation ledger unchanged");
  }
  assert.deepEqual(await mailState(), queued, "denied aliases leave queued work unchanged");
  assert.equal((await fetch(link, { redirect: "manual" })).status, 200, "denied cancellation leaves its capability live");
  const removePath = `/api/app/operators/${target}/remove`;
  assert.equal((await call(removePath, {}, cookie)).status, 204);
  assert.deepEqual(await mailState(), [], "operator erasure deletes old operator and invitee queued mail at the address");
  const erasedAuthority = () => runtime.query(`SELECT 'operator' AS kind,id FROM oa_operators WHERE id='${target}'
    UNION ALL SELECT 'session',id FROM oa_sessions WHERE operator_id='${target}'
    UNION ALL SELECT 'token',id FROM oa_tokens WHERE operator_id='${target}' OR issuer_id='${target}'
    UNION ALL SELECT 'external',operator_id FROM oa_external_identities WHERE operator_id='${target}'
    UNION ALL SELECT 'cancellation',operator_id FROM oa_invitation_cancellations WHERE operator_id='${target}'`);
  assert.deepEqual(await erasedAuthority(), [], "ordinary removal erases native identity, capabilities and cancellation ledger");
  assert.deepEqual(await runtime.query(`SELECT id FROM rer_mail_development_outbox WHERE EXISTS (SELECT 1 FROM json_each(message,'$.to') WHERE value='${email}')`), [], "local native auth captures are erased");
  assert.equal((await call("/api/app/session", undefined, oldCookie)).status, 401);
  assert.equal((await confirmAuthLink(link)).status, 400);
  assert.equal((await confirmAuthLink(invitationLink)).status, 400);
  assert.equal(await capture(email, cookie), undefined, "removed recipient cannot retrieve its old capture");
  const afterRemoval = JSON.stringify(await authority());
  assert.equal((await call(removePath, {}, cookie)).status, 204);
  assert.equal(JSON.stringify(await authority()) === afterRemoval, true, "repeat removal safely leaves surviving authority unchanged");
  assert.deepEqual(await erasedAuthority(), []);
  assert.deepEqual(await mailState(), []);
  assert.ok(!(await (await call("/api/app/operators", undefined, cookie)).json()).operators.some(row => row.id === target));
  // Independent activity created after erasure is new work, unlike the old
  // queued invitee mail above. Reenrollment must not delete or revive either.
  await runtime.sql(`INSERT INTO delivery_outbox (id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) VALUES
    ('new-invitee','mail_send','new-invitee','{"to":"${email}","recipientRole":"invitee"}','pending',0,'2000','2000','2000')`);
  const newMail = () => runtime.query("SELECT id,state,payload_json FROM delivery_outbox WHERE id='new-invitee'");
  const independent = await newMail();
  assert.equal(independent.length, 1);
  const reissued = await call("/api/app/operators", { email }, cookie);
  assert.equal(reissued.status, 201);
  const replacement = (await reissued.json()).operator.id;
  assert.notEqual(replacement, target, "reinvitation creates a fresh native identity");
  assert.deepEqual(await erasedAuthority(), []);
  assert.deepEqual(await mailState(), [], "reinvitation cannot recreate erased mail");
  assert.equal(JSON.stringify(await newMail()) === JSON.stringify(independent), true, "reenrollment preserves newly queued independent invitee work");
  const current = await capture(email, cookie);
  assert.ok(current && current !== link && current !== invitationLink);
  assert.equal((await call("/api/app/session", undefined, oldCookie)).status, 401, "new identity cannot revive old session");
  assert.equal((await confirmAuthLink(link)).status, 400);
  assert.equal((await confirmAuthLink(invitationLink)).status, 400);
  const reenrolled = await confirmAuthLink(current);
  assert.equal(reenrolled.status, 303);
  const replacementCookie = reenrolled.headers.get("set-cookie").split(";")[0];
  assert.equal((await (await call("/api/app/session", undefined, replacementCookie)).json()).operator.id, replacement, "only the newly issued capability authenticates the replacement identity");
  assert.deepEqual(await erasedAuthority(), []);
  assert.deepEqual(await runtime.query("SELECT operator_id FROM oa_invitation_cancellations"), []);
});
