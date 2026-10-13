import { confirmAuthLink } from "./auth-client.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { startRuntime, origin } from "./operator-mail-order/runtime.mjs";
import { verifyRecipientGenerations } from "./operator-mail-order/generation.mjs";

test("OPER-002 native notification invocation and removal share one durable admission boundary", async (context) => {
  const runtime = await startRuntime(context);
  let cookie, inFlight;
  function call(path, body, method = body === undefined ? "GET" : "POST", expected = 200) {
    const pending = (async () => {
      const response = await fetch(origin + path, { method, redirect: "manual", headers: { Origin: origin, ...(cookie ? { cookie } : {}), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      assert.equal(response.status, expected, `HTTP ${method} ${path.split("?")[0]}`);
      return response;
    })();
    if (inFlight) { inFlight.push(pending); pending.catch(() => {}); }
    return pending;
  }
  const data = (...args) => {
    const pending = call(...args).then(response => response.json());
    if (inFlight) { inFlight.push(pending); pending.catch(() => {}); }
    return pending;
  };
  const sql = async (sql, values = []) => (await data("/__order/sql", { sql, values })).results;
  const fixture = await data("/__order/setup", {});
  const signin = await confirmAuthLink(fixture.link);
  assert.equal(signin.status, 303); cookie = signin.headers.get("set-cookie").split(";")[0];
  const email = fixture.other.email;
  let operatorId = fixture.other.id;
  const remove = () => call(`/api/app/operators/${operatorId}/remove`, undefined, "POST", 204);
  const invite = async () => {
    // Each independent notification scenario starts with fresh auth admission quota.
    await sql("DELETE FROM oa_limits");
    const previousId = operatorId;
    const invitation = await data("/api/app/operators", { email }, "POST", 201);
    assert.notEqual(invitation.operator.id, previousId, "erased native identity is never reactivated");
    operatorId = invitation.operator.id;
    const messages = await sql("SELECT message_json FROM order_calls WHERE json_extract(message_json, '$.to') = ? ORDER BY id DESC", [email]);
    const link = messages.map(row => JSON.parse(row.message_json).text?.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)?.[0]).find(Boolean);
    assert.ok(link, "the native invitation reached the provider");
    assert.equal((await confirmAuthLink(link)).status, 303, "the new operator consumes its genuine invitation");
    assert.equal((await sql("SELECT removed_at FROM operators WHERE id = ?", [operatorId]))[0].removed_at, null);
    return invitation;
  };
  const enqueue = async (key, role = "operator") => (await data("/__order/enqueue", { email, key, role })).id;
  const processOne = (id) => data("/__order/process", { id });
  const control = (stage, failure = 0) => sql("UPDATE order_control SET stage = ?, failure = ?, reached = 0, released = 0 WHERE singleton = 1", [stage, failure]);
  const release = () => sql("UPDATE order_control SET released = 1 WHERE singleton = 1");
  async function waitReached() {
    for (let i = 0; i < 400; i++) {
      if ((await sql("SELECT reached FROM order_control WHERE singleton = 1"))[0].reached) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    assert.fail("controlled D1/provider boundary was not reached");
  }
  const calls = async (key) => {
    const records = await sql("SELECT * FROM order_calls WHERE key = ?", [key]);
    for (const record of records) {
      assert.equal(record.source_present, 1, "a native durable source exists before every tested provider invocation");
      assert.equal(record.source_state, "processing");
    }
    return records;
  };
  const row = async (id) => (await sql("SELECT * FROM delivery_outbox WHERE id = ?", [id]))[0];
  const journal = (id) => sql("SELECT * FROM operator_mail_invocations WHERE outbox_id = ?", [id]);
  const scenario = (name, run) => context.test(name, async () => {
    inFlight = [];
    try { await run(); }
    finally {
      const pending = inFlight; inFlight = undefined;
      await release();
      await Promise.allSettled(pending);
      await control(null);
      // A failed assertion must not leave the next independent behavior paused
      // or accidentally using the already erased native identity.
      if (!(await sql("SELECT id FROM oa_operators WHERE id = ?", [operatorId])).length) await invite();
    }
  });

  await scenario("removal commits while the actual pre-dispatch authorization SELECT response is delayed", async () => {
    const key = "connection:resend:unhealthy:1:operator:" + operatorId;
    const id = await enqueue(key, null);
    await control("worker");
    const sending = processOne(id); await waitReached();
    await remove();
    assert.deepEqual(await sql("SELECT id FROM oa_operators WHERE id = ?", [operatorId]), []);
    await release();
    assert.equal((await sending).result, "failed");
    assert.equal((await calls(key)).length, 0, "stale false never admits a post-removal invocation");
    assert.equal(await row(id), undefined, "removal erases local personal mail");
    assert.deepEqual(await journal(id), []);
    await control(null); await invite();
  });

  await scenario("the final SELECT response inside the shared gate cannot be overtaken by successful removal", async () => {
    const key = "connection:resend:unhealthy:2:operator:" + operatorId;
    const id = await enqueue(key);
    await control("gate");
    const sending = processOne(id); await waitReached();
    let removalDone = false;
    const removal = remove().then(() => { removalDone = true; });
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(removalDone, false); assert.equal((await calls(key)).length, 0);
    assert.equal((await sql("SELECT removed_at FROM operators WHERE id = ?", [operatorId]))[0].removed_at, null);
    await release();
    assert.equal((await sending).result, "succeeded"); await removal;
    const invoked = await calls(key); assert.equal(invoked.length, 1); assert.equal(invoked[0].recipient_removed, null);
    assert.equal(invoked[0].invocation_state, "invoking");
    assert.equal(invoked[0].provider_outcome, "succeeded");
    assert.equal(invoked[0].provider_message_id, `synthetic:${key}`);
    assert.deepEqual(await journal(id), [], "removal erases the local invocation ledger");
    assert.equal(await row(id), undefined);
    await control(null); await invite();
  });

  await scenario("already invoked mail keeps its ambiguous outcome while removal waits for the bounded provider call", async () => {
    const key = "operator-order-ambiguous"; const id = await enqueue(key);
    await control("provider", 1);
    const sending = processOne(id); await waitReached();
    assert.equal((await calls(key)).length, 1);
    let removalDone = false;
    const removal = remove().then(() => { removalDone = true; });
    await new Promise((done) => setTimeout(done, 100)); assert.equal(removalDone, false);
    await release(); await sending; await removal;
    const observed = (await calls(key))[0];
    assert.equal(observed.recipient_removed, null);
    assert.equal(observed.invocation_state, "invoking");
    assert.equal(observed.provider_outcome, "provider_timeout");
    const attempts = await sql("SELECT * FROM delivery_attempts WHERE outbox_id = ?", [id]);
    assert.deepEqual(attempts, [], "personal delivery attempts are erased with the identity");
    assert.deepEqual(await journal(id), []);
    assert.equal(await row(id), undefined, "removal erases local personal mail");
    await control(null); await invite();
    assert.equal((await processOne(id)).result, "not_due"); assert.equal((await calls(key)).length, 1);
  });

  await scenario("a real Worker interruption leaves durable unknown effect authority that age and retries cannot reclaim", async () => {
    const key = "operator-order-interrupted"; const id = await enqueue(key);
    await control("provider");
    const interrupted = processOne(id).catch(() => ({ interrupted: true })); await waitReached();
    assert.equal((await journal(id))[0].state, "invoking");
    await runtime.restart(); await interrupted;
    await control(null);
    await sql("UPDATE delivery_outbox SET updated_at = '2000' WHERE id = ?", [id]);
    await data("/__order/due", {});
    assert.equal((await calls(key)).length, 1);
    assert.equal((await row(id)).last_error_code, "operator_mail_outcome_unknown");
    assert.equal((await journal(id))[0].state, "invoking", "unknown is not rewritten as failed or unsent");
    assert.equal((await calls(key))[0].provider_outcome, "invoking", "process loss leaves the external effect unresolved");
    await remove(); await invite();
    assert.equal((await processOne(id)).result, "not_due");
    assert.equal((await calls(key)).length, 1);
    const fresh = await enqueue("operator-order-new-after-reinvite");
    assert.equal((await processOne(fresh)).result, "succeeded");
  });

  await scenario("a durable receipt recovers an interrupted command without invoking the provider again", async () => {
    const key = "operator-order-receipt"; const id = await enqueue(key);
    assert.equal((await processOne(id)).result, "succeeded");
    await sql("UPDATE delivery_outbox SET state = 'processing', updated_at = '2000' WHERE id = ?", [id]);
    await runtime.restart(); await data("/__order/due", {});
    assert.equal((await calls(key)).length, 1);
    assert.equal((await row(id)).state, "succeeded");
    assert.equal((await journal(id))[0].provider_message_id, `synthetic:${key}`);
  });

  await scenario("interruption after durable admission but before invocation is unknown, never assumed unsent", async () => {
    const key = "operator-order-admission-interrupted"; const id = await enqueue(key);
    await control("admission");
    const interrupted = processOne(id).catch(() => ({ interrupted: true })); await waitReached();
    assert.equal((await journal(id))[0].state, "invoking"); assert.equal((await calls(key)).length, 0);
    await runtime.restart(); await interrupted; await control(null);
    await sql("UPDATE delivery_outbox SET updated_at = '2000' WHERE id = ?", [id]);
    await data("/__order/due", {});
    assert.equal((await row(id)).last_error_code, "operator_mail_outcome_unknown");
    assert.equal((await calls(key)).length, 0);
  });

  await verifyRecipientGenerations({ context: { test: scenario }, data, sql, email, getOperatorId: () => operatorId, remove, invite, control, release, waitReached, processOne, calls });

  await scenario("independent invitee mail and new invitations remain eligible while genuine invitee overlap holds removal", async () => {
    await remove();
    const id = await enqueue("operator-order-independent-invitee", "invitee");
    assert.equal((await processOne(id)).result, "succeeded");
    const publicCalls = await calls("operator-order-independent-invitee");
    assert.equal(publicCalls.length, 1); assert.equal(publicCalls[0].recipient_present, 0);
    const before = (await sql("SELECT count(*) AS count FROM order_calls WHERE json_extract(message_json, '$.to') = ?", [email]))[0].count;
    const invitation = await invite();
    assert.equal(invitation.invitation, "queued");
    const after = (await sql("SELECT count(*) AS count FROM order_calls WHERE json_extract(message_json, '$.to') = ?", [email]))[0].count;
    assert.equal(after, before + 1, "the fresh invitation invokes the actual adapter once");
    const composition = { inviteeName: "Real operator overlap", inviteeEmail: email, inviteeTimezone: "UTC", note: "New invitee action after reenrollment", windows: [{ date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), startMinute: 780, endMinute: 840 }] };
    const review = await data("/api/public/events/dial-host/intro/request/review", composition, "POST", 201);
    await data(`/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(review.nonce)}`, composition, "POST", 201);
    await call(`/api/app/operators/${operatorId}/remove`, undefined, "POST", 409);
    assert.equal((await sql("SELECT status FROM oa_operators WHERE id = ?", [operatorId]))[0].status, "active");
    assert.equal((await sql("SELECT count(*) AS count FROM availability_requests WHERE invitee_email = ?", [email]))[0].count, 1, "the real overlapping request survives the explicit removal hold");
  });
});
